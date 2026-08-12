/**
 * HallPass — the challenges store.
 *
 * A `createChallengeStore(sql)` factory, like `social/store.ts`,
 * `tracker/store.ts` and `reviews/store.ts`: the factory takes the
 * tagged-template function so the module stays free of `server-only` and the
 * fake-`sql` seam in `store.test.ts` can assert the SHAPE of every statement
 * without a database.
 *
 * ── ONE STATEMENT PER MUTATION, forced by the driver ───────────────────────
 * `neon()` is SQL-over-HTTP: one stateless request per tagged-template call, so
 * a `BEGIN` here and a `COMMIT` there are not the same transaction. Every gate
 * and every write below therefore evaluates against ONE snapshot inside ONE
 * statement — the same discipline `sendRequest` follows, and for a sharper
 * reason here: a block checked in a separate round trip is a block that can be
 * raced by the write it is supposed to stop.
 *
 * ── THE CREATE PATH RETURNS ITS DIAGNOSTICS ────────────────────────────────
 * The tracker's "empty result set is the outcome code" idiom is not enough for
 * this surface. "You are not friends", "you have no score on this board yet" and
 * "you challenged them an hour ago" are three different things to tell somebody,
 * and collapsing them into `null` would produce a popup that says only that
 * nothing happened. So {@link createChallengeStore.create} selects its gate
 * results ALONGSIDE the inserted id, and the caller maps them to a
 * `ChallengeReason`. Still one round trip.
 *
 * ── WHAT THE SCORE TO BEAT IS ──────────────────────────────────────────────
 * Derived in SQL as the challenger's OWN BEST score on that board — `max` on a
 * `desc` board, `min` on an `asc` one — never supplied by the caller. That makes
 * "you have no score here" fall out of the same query as everything else, and it
 * makes it impossible to dare somebody to beat a number you never scored.
 *
 * ── NEVER PUT A BARE PARAMETER CASE INSIDE make_interval() ─────────────────
 * `make_interval(secs => $1)` works: there is exactly one `make_interval`, so an
 * unknown-typed parameter coerces to its `double precision` argument.
 * `make_interval(secs => CASE WHEN … THEN $1 … ELSE $3 END)` DOES NOT. Postgres
 * resolves the CASE's own type first, and a CASE whose every branch is an
 * untyped parameter resolves to `text` — for which no implicit cast to
 * `double precision` exists. The call then fails to resolve entirely:
 *
 *     ERROR 42883: function make_interval(secs => text) does not exist
 *
 * The Neon HTTP driver sends no type OIDs, so every parameter arrives unknown
 * and this fires on every call in production. It is also invisible to the tests
 * below, which assert SQL TEXT rather than execute it, and `42883` is not one of
 * the codes `isMissingColumnError` matches — so it would surface only as a 503
 * and a picker saying "Challenges are unavailable at the moment."
 *
 * The cooldown branches below are therefore written as three OR'd conditions,
 * each with its own single-parameter `make_interval`, which is the same shape
 * `beta/store.ts` and `social/store.ts` already use.
 *
 * ── BLOCKS ARE FILTERED AT READ TIME, NOT CLEANED UP ON BLOCK ──────────────
 * `007_social_graph.sql` notes that blocking DELETES the friendship, which is
 * why "friends who play this" needs no block filter. Challenges are not
 * friendship rows, so that reasoning does not carry: block somebody and their
 * open challenge would otherwise sit in the inbox with their name and avatar on
 * it — the precise thing a block is for preventing.
 *
 * Every read therefore carries a `player_blocks` filter, and `accept` carries the
 * same gate. Read-side rather than deleting the rows inside `blockPlayer`
 * because it needs no cross-module write, no backfill for blocks that already
 * exist, and — the deciding one — it cannot be forgotten by a future write path
 * the way a clean-up step can.
 *
 * ── ONE MIRRORED PREDICATE, NAMED ──────────────────────────────────────────
 * {@link createChallengeStore.resolveForScore} restates `beats()` from
 * `resolve.ts` in SQL, because resolution has to be a single UPDATE. That is the
 * only copy of the rule, it is marked at the site, and `resolve.test.ts` is what
 * makes the original trustworthy. Change one and change the other.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { SortDir } from "@/sdk/src/contract";
import { orderPair } from "@/app/lib/social/pair";
import {
  CHALLENGE_DISMISSED_COOLDOWN_SECONDS,
  CHALLENGE_LIST_LIMIT,
  CHALLENGE_RESEND_COOLDOWN_SECONDS,
  CHALLENGE_RESOLVED_COOLDOWN_SECONDS,
  CHALLENGE_SENDER_RATE_LIMIT,
  LINK_CLAIM_RATE_LIMIT,
  MAX_OPEN_SENT_CHALLENGES,
} from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/**
 * `BIGINT` arrives from the HTTP driver as a string (the int8 parser leaves it
 * one so 2^53 cannot silently round). Every id and score goes through here.
 */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  return value == null ? null : toIso(value);
}

function toStrOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

/** `desc` unless the board explicitly says otherwise — matching `boards.sort`'s default. */
function toSort(value: unknown): SortDir {
  return String(value) === "asc" ? "asc" : "desc";
}

/**
 * The other player on a challenge, in the shape that is safe to send to a
 * browser.
 *
 * Shaped like `social/store.ts`'s `PublicProfile` and carrying `public_id`
 * rather than `players.id` for the reason `007_social_graph.sql` spells out:
 * `players.id` is the Google subject, a stable cross-service identifier for a
 * minor, and it must never reach another player's browser.
 */
export type ChallengeParty = {
  id: string;
  username: string | null;
  displayName: string;
  image: string | null;
};

/** What a challenge says about the board it is played on. */
type BoardFacts = {
  boardId: string;
  /** `null` for a board not linked to a game — the UI falls back to the title. */
  gameSlug: string | null;
  boardTitle: string;
  scoreLabel: string;
  sort: SortDir;
};

/** A challenge somebody sent ME. */
export type IncomingChallenge = BoardFacts & {
  id: number;
  from: ChallengeParty;
  targetScore: number;
  createdAt: string;
  acceptedAt: string | null;
};

/** A challenge I sent. Dismissed ones are NOT here — see `listOutgoing`. */
export type OutgoingChallenge = BoardFacts & {
  id: number;
  to: ChallengeParty;
  targetScore: number;
  createdAt: string;
  acceptedAt: string | null;
  resolvedAt: string | null;
  resolvedScore: number | null;
};

/**
 * What `/c/<code>` is allowed to know about the person who posted it.
 *
 * DELIBERATELY NOT {@link ChallengeParty}, and this is a safety boundary rather
 * than a convenience. That type carries `image`, which for a Google-only
 * product is frequently a real photograph of the account holder — and the
 * account holders are children. A challenge link is a page ENGINEERED to be
 * pasted into a public chat and rendered as a preview card cached on other
 * people's devices, so the photograph must not be in the payload at all.
 *
 * Enforcing it in the type rather than in the template is the point: a template
 * that simply chooses not to render a field is one edit away from rendering it.
 * `public_id` is absent for the same reason — nothing on this page needs to
 * identify the owner to a stranger, only to name them.
 *
 * See `challenge-sharing-design.md` §7.
 */
export type LinkOwner = {
  username: string | null;
  displayName: string;
};

/** A link as the world sees it at `/c/<code>`. */
export type PublicLink = BoardFacts & {
  id: number;
  code: string;
  owner: LinkOwner;
  targetScore: number;
  revokedAt: string | null;
};

/** A link as its OWNER sees it, with the payoff numbers attached. */
export type OwnedLink = BoardFacts & {
  id: number;
  code: string;
  targetScore: number;
  /** Presses of "Beat it", not page views. */
  opens: number;
  /** Signed-in people who took it up. */
  claims: number;
  /** How many of those beat the score. */
  beaten: number;
  revokedAt: string | null;
  createdAt: string;
};

/** Everything `mintLink` learned, whether or not it wrote a row. */
export type MintLinkOutcome = {
  /** The share code — the existing one when refreshing, else the new one. */
  code: string | null;
  targetScore: number | null;
  gameSlug: string | null;
  boardTitle: string;
  boardExists: boolean;
  hasScore: boolean;
};

/** Everything `claimLink` learned. */
export type ClaimLinkOutcome = {
  id: number | null;
  targetScore: number | null;
  linkFound: boolean;
  isRevoked: boolean;
  /** The owner opened their own link. Not an error — just nothing to claim. */
  isSelf: boolean;
  isBlocked: boolean;
  overRateLimit: boolean;
};

/** One row `resolveForScore` just closed, for the "you won" surfaces. */
export type ResolvedChallenge = {
  id: number;
  /** Internal id — this one stays server-side; it is who to notify. */
  challengerId: string;
  targetScore: number;
  boardId: string;
};

/** Everything `create` learned, whether or not it wrote a row. */
export type CreateOutcome = {
  /** The challenge id, or `null` when a gate refused it. */
  id: number | null;
  targetScore: number | null;
  /**
   * Both names, the board's game and its title, selected in the SAME statement.
   *
   * `toDisplayName` and `gameSlug` confirm the send back to the picker.
   * `fromDisplayName` and `boardTitle` are what the push notification needs —
   * "Ozan challenged you", "Beat their score on Duskfall" — and fetching them
   * separately would be two more round trips on the send path for text the
   * statement was already positioned to read.
   */
  toDisplayName: string;
  fromDisplayName: string;
  gameSlug: string | null;
  boardTitle: string;
  boardExists: boolean;
  isFriend: boolean;
  isBlocked: boolean;
  hasScore: boolean;
  isCooling: boolean;
  overRateLimit: boolean;
  overOpenCap: boolean;
};

/**
 * Handle, else `@username`, else "Player".
 *
 * Reproduces `PublicProfile`'s rule rather than importing it, keeping the
 * factory seam free of a cross-store dependency. The Google `name` is
 * deliberately never a fallback — it is the person's real name on most accounts.
 */
function displayNameFrom(handle: unknown, username: unknown): string {
  const h = handle == null ? null : String(handle).trim();
  const u = username == null ? null : String(username);
  return h || (u ? `@${u}` : "Player");
}

/**
 * The public columns of the other player, joined and aliased identically
 * everywhere so one mapper serves every read.
 */
function mapParty(row: Row, prefix: string): ChallengeParty {
  return {
    id: String(row[`${prefix}_public_id`]),
    username: toStrOrNull(row[`${prefix}_username`]),
    displayName: displayNameFrom(row[`${prefix}_handle`], row[`${prefix}_username`]),
    image: toStrOrNull(row[`${prefix}_image`]),
  };
}

function mapBoard(row: Row): BoardFacts {
  return {
    boardId: String(row.board_id),
    gameSlug: toStrOrNull(row.game_slug),
    boardTitle: String(row.board_title ?? ""),
    scoreLabel: String(row.score_label ?? "Score"),
    sort: toSort(row.sort),
  };
}

export function createChallengeStore(sql: Sql) {
  return {
    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /**
     * Open challenges aimed at me, newest first. Served by `challenges_inbox_idx`.
     *
     * Open only: a resolved challenge has nothing left to do and a dismissed one
     * is gone by the reader's own choice.
     */
    async listIncoming(me: string): Promise<IncomingChallenge[]> {
      const rows = (await sql`
        SELECT c.id, c.target_score, c.created_at, c.accepted_at,
               c.board_id, b.game_slug, b.title AS board_title,
               b.score_label, b.sort,
               p.public_id AS from_public_id, p.username AS from_username,
               p.handle AS from_handle, p.image AS from_image
          FROM challenges c
          JOIN boards  b ON b.id = c.board_id
          JOIN players p ON p.id = c.challenger_id
         WHERE c.target_id = ${me}
           AND c.resolved_at IS NULL AND c.dismissed_at IS NULL
           AND NOT EXISTS (
                 SELECT 1 FROM player_blocks pb
                  WHERE (pb.blocker_id = ${me} AND pb.blocked_id = c.challenger_id)
                     OR (pb.blocker_id = c.challenger_id AND pb.blocked_id = ${me})
               )
         ORDER BY c.id DESC
         LIMIT ${CHALLENGE_LIST_LIMIT}
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        from: mapParty(row, "from"),
        targetScore: toInt(row.target_score),
        createdAt: toIso(row.created_at),
        acceptedAt: toIsoOrNull(row.accepted_at),
        ...mapBoard(row),
      }));
    },

    /**
     * Challenges I sent — open ones and the ones they BEAT, newest first.
     *
     * DISMISSED ROWS ARE EXCLUDED, and that is a product decision rather than a
     * filter for tidiness. `social/config.ts` deletes a declined friend request
     * instead of storing the status because "children decline by accident
     * constantly"; telling a child that a specific friend binned their challenge
     * is the same unkindness with a different table behind it. The row stays so
     * the cooldown holds; the sender simply sees it stop being pending.
     *
     * `kind = 'friend'` ONLY, and both halves of that matter.
     *
     * A `link` row would be dropped by `JOIN players ON p.id = c.target_id`
     * anyway — its target is NULL, so the inner join never matches — but that
     * is an accident of the join rather than a decision, and one `LEFT JOIN`
     * away from silently listing invitations as challenges with no recipient.
     * The predicate states the intent.
     *
     * A `link_claim` WOULD match, and excluding it is the real decision: one
     * link passed around a class produces a row per person, and a flat list is
     * the wrong shape for that. {@link createChallengeStore.listLinks} answers
     * it grouped, which is how a link's takers should be read.
     */
    async listOutgoing(me: string): Promise<OutgoingChallenge[]> {
      const rows = (await sql`
        SELECT c.id, c.target_score, c.created_at, c.accepted_at,
               c.resolved_at, c.resolved_score,
               c.board_id, b.game_slug, b.title AS board_title,
               b.score_label, b.sort,
               p.public_id AS to_public_id, p.username AS to_username,
               p.handle AS to_handle, p.image AS to_image
          FROM challenges c
          JOIN boards  b ON b.id = c.board_id
          JOIN players p ON p.id = c.target_id
         WHERE c.kind = 'friend'
           AND c.challenger_id = ${me}
           AND c.dismissed_at IS NULL
           AND NOT EXISTS (
                 SELECT 1 FROM player_blocks pb
                  WHERE (pb.blocker_id = ${me} AND pb.blocked_id = c.target_id)
                     OR (pb.blocker_id = c.target_id AND pb.blocked_id = ${me})
               )
         ORDER BY c.id DESC
         LIMIT ${CHALLENGE_LIST_LIMIT}
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        to: mapParty(row, "to"),
        targetScore: toInt(row.target_score),
        createdAt: toIso(row.created_at),
        acceptedAt: toIsoOrNull(row.accepted_at),
        resolvedAt: toIsoOrNull(row.resolved_at),
        resolvedScore: row.resolved_score == null ? null : toInt(row.resolved_score),
        ...mapBoard(row),
      }));
    },

    /**
     * Open challenges aimed at me on any board belonging to `gameSlug` — the
     * store-page chip.
     *
     * By GAME rather than by board because that is what the page knows, and a
     * game may carry several boards. The chip says "Ozan challenged you here";
     * the row still means one specific board.
     */
    async listForGame(me: string, gameSlug: string): Promise<IncomingChallenge[]> {
      const rows = (await sql`
        SELECT c.id, c.target_score, c.created_at, c.accepted_at,
               c.board_id, b.game_slug, b.title AS board_title,
               b.score_label, b.sort,
               p.public_id AS from_public_id, p.username AS from_username,
               p.handle AS from_handle, p.image AS from_image
          FROM challenges c
          JOIN boards  b ON b.id = c.board_id
          JOIN players p ON p.id = c.challenger_id
         WHERE c.target_id = ${me}
           AND b.game_slug = ${gameSlug}
           AND c.resolved_at IS NULL AND c.dismissed_at IS NULL
           AND NOT EXISTS (
                 SELECT 1 FROM player_blocks pb
                  WHERE (pb.blocker_id = ${me} AND pb.blocked_id = c.challenger_id)
                     OR (pb.blocker_id = c.challenger_id AND pb.blocked_id = ${me})
               )
         ORDER BY c.id DESC
         LIMIT ${CHALLENGE_LIST_LIMIT}
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        from: mapParty(row, "from"),
        targetScore: toInt(row.target_score),
        createdAt: toIso(row.created_at),
        acceptedAt: toIsoOrNull(row.accepted_at),
        ...mapBoard(row),
      }));
    },

    // -----------------------------------------------------------------------
    // Create
    // -----------------------------------------------------------------------

    /**
     * Send a challenge — the most involved statement in the feature.
     *
     * One statement, six gates, all against one snapshot:
     *   board     the board exists at all
     *   friend    an ACCEPTED friendship, in either stored direction
     *   blocked   either way; enforced atomically with the write, not before it
     *   best      the challenger's own best score, which is also the dare
     *   cooling   the per-pair-per-board cooldown, read off the EXISTING ROW —
     *             free after a win, an hour after a nag, a day after a refusal
     *   recent /  the sender-side rate limit and in-flight cap
     *   open_sent
     *
     * `ins` selects `FROM best`, so no score means no row inserted without any
     * gate having to say so. `ON CONFLICT … DO UPDATE` is what makes re-sending
     * REPLACE rather than stack, and it clears every lifecycle stamp so a
     * rematch starts genuinely fresh rather than inheriting a stale `accepted_at`.
     *
     * The trailing SELECT reports every gate whether or not the insert fired,
     * which is what lets the popup say something true instead of "nothing
     * happened".
     */
    async create(input: {
      challengerId: string;
      targetId: string;
      boardId: string;
    }): Promise<CreateOutcome> {
      const { challengerId, targetId, boardId } = input;
      const { lo, hi } = orderPair(challengerId, targetId);
      const rows = (await sql`
        WITH board AS (
          SELECT id, sort, game_slug, title FROM boards WHERE id = ${boardId}
        ),
        target AS (
          SELECT handle, username FROM players WHERE id = ${targetId}
        ),
        challenger AS (
          SELECT handle, username FROM players WHERE id = ${challengerId}
        ),
        friend AS (
          SELECT 1 FROM friendships
           WHERE player_a = ${lo} AND player_b = ${hi} AND status = 'accepted'
        ),
        blocked AS (
          SELECT 1 FROM player_blocks
           WHERE (blocker_id = ${challengerId} AND blocked_id = ${targetId})
              OR (blocker_id = ${targetId} AND blocked_id = ${challengerId})
           LIMIT 1
        ),
        best AS (
          SELECT CASE WHEN board.sort = 'asc' THEN min(s.score) ELSE max(s.score) END AS score
            FROM scores s
            JOIN board ON board.id = s.board_id
           WHERE s.player_id = ${challengerId}
           GROUP BY board.sort
        ),
        -- BOTH COUNTERS ARE kind = 'friend', WHICH THEY DID NOT USED TO BE.
        -- Before links existed, every row whose challenger was this player was
        -- something they had chosen to send, so an unqualified count was the
        -- right one. A link_claim breaks that: its challenger is the LINK
        -- OWNER, but the row is created by whoever took the link up. Counting
        -- them here would mean a popular link filled its own owner's send quota
        -- and then locked them out of challenging their actual friends — a
        -- punishment for the feature working. The quota bounds what one account
        -- PUSHES at people, and a claim is pulled.
        recent AS (
          SELECT count(*) AS n FROM challenges
           WHERE kind = 'friend'
             AND challenger_id = ${challengerId}
             AND created_at >= now() - make_interval(secs => ${CHALLENGE_SENDER_RATE_LIMIT.windowSeconds})
        ),
        open_sent AS (
          SELECT count(*) AS n FROM challenges
           WHERE kind = 'friend'
             AND challenger_id = ${challengerId}
             AND resolved_at IS NULL AND dismissed_at IS NULL
        ),
        cooling AS (
          SELECT 1 FROM challenges
           WHERE kind = 'friend'
             AND challenger_id = ${challengerId}
             AND target_id = ${targetId}
             AND board_id = ${boardId}
             AND (
               -- Beaten: a free rematch. The cooldown is 0, so this is never
               -- true for a row already written; the branch exists to STOP the
               -- other two applying, not to block anything.
               (resolved_at IS NOT NULL
                  AND resolved_at >= now() - make_interval(secs => ${CHALLENGE_RESOLVED_COOLDOWN_SECONDS}))
               -- Refused: measured from the DISMISSAL, not from when it was
               -- sent. Measuring from created_at would let somebody who sat on
               -- a challenge for a day dismiss it and be re-challenged at once,
               -- because the cooldown would have elapsed before the event it is
               -- supposed to follow.
               OR (resolved_at IS NULL AND dismissed_at IS NOT NULL
                  AND dismissed_at >= now() - make_interval(secs => ${CHALLENGE_DISMISSED_COOLDOWN_SECONDS}))
               -- Still open: the anti-nag window, which does run from when it
               -- was sent.
               OR (resolved_at IS NULL AND dismissed_at IS NULL
                  AND created_at >= now() - make_interval(secs => ${CHALLENGE_RESEND_COOLDOWN_SECONDS}))
             )
        ),
        ins AS (
          INSERT INTO challenges (kind, board_id, challenger_id, target_id, target_score)
          SELECT 'friend', ${boardId}, ${challengerId}, ${targetId}, best.score
            FROM best
           WHERE best.score IS NOT NULL
             AND EXISTS     (SELECT 1 FROM friend)
             AND NOT EXISTS (SELECT 1 FROM blocked)
             AND NOT EXISTS (SELECT 1 FROM cooling)
             AND (SELECT n FROM recent)    < ${CHALLENGE_SENDER_RATE_LIMIT.maxPerWindow}
             AND (SELECT n FROM open_sent) < ${MAX_OPEN_SENT_CHALLENGES}
          ON CONFLICT (challenger_id, target_id, board_id) WHERE kind = 'friend'
          DO UPDATE SET target_score   = EXCLUDED.target_score,
                        created_at     = now(),
                        accepted_at    = NULL,
                        resolved_at    = NULL,
                        resolved_score = NULL,
                        dismissed_at   = NULL
          RETURNING id, target_score
        )
        SELECT (SELECT id FROM ins)                       AS id,
               (SELECT target_score FROM ins)             AS target_score,
               (SELECT handle    FROM target)             AS to_handle,
               (SELECT username  FROM target)             AS to_username,
               (SELECT handle    FROM challenger)         AS from_handle,
               (SELECT username  FROM challenger)         AS from_username,
               (SELECT game_slug FROM board)              AS game_slug,
               (SELECT title     FROM board)              AS board_title,
               EXISTS (SELECT 1 FROM board)               AS board_exists,
               EXISTS (SELECT 1 FROM friend)              AS is_friend,
               EXISTS (SELECT 1 FROM blocked)             AS is_blocked,
               EXISTS (SELECT 1 FROM best WHERE score IS NOT NULL) AS has_score,
               EXISTS (SELECT 1 FROM cooling)             AS is_cooling,
               (SELECT n FROM recent)                     AS recent_n,
               (SELECT n FROM open_sent)                  AS open_n
      `) as Row[];

      const row = rows[0] ?? {};
      return {
        id: row.id == null ? null : toInt(row.id),
        targetScore: row.target_score == null ? null : toInt(row.target_score),
        toDisplayName: displayNameFrom(row.to_handle, row.to_username),
        fromDisplayName: displayNameFrom(row.from_handle, row.from_username),
        gameSlug: toStrOrNull(row.game_slug),
        boardTitle: String(row.board_title ?? ""),
        boardExists: row.board_exists === true,
        isFriend: row.is_friend === true,
        isBlocked: row.is_blocked === true,
        hasScore: row.has_score === true,
        isCooling: row.is_cooling === true,
        overRateLimit:
          toInt(row.recent_n) >= CHALLENGE_SENDER_RATE_LIMIT.maxPerWindow,
        overOpenCap: toInt(row.open_n) >= MAX_OPEN_SENT_CHALLENGES,
      };
    },

    // -----------------------------------------------------------------------
    // Links
    // -----------------------------------------------------------------------

    /**
     * Mint or refresh this player's share link for one board.
     *
     * ONE LINK PER (owner, board), upserted — so pressing "share" a second time
     * does NOT hand out a rival URL. The point is that the owner can post one
     * link and keep posting the same one: the score under it moves up as they
     * improve, which is what "beat my best" should mean, while each taker keeps
     * the number they were shown (see {@link createChallengeStore.claimLink}).
     *
     * THE CODE IS ONLY REPLACED WHEN THE LINK WAS REVOKED. Refreshing a live
     * link keeps its code, because the owner may already have posted it and a
     * silently-rotated URL would break every copy of it. Refreshing a REVOKED
     * one mints a fresh code, because revoking has to be permanent for the URL
     * that was revoked — un-revoking the old code would resurrect a link
     * somebody deliberately killed after regretting where they put it.
     *
     * The score is derived in SQL as the owner's own best, exactly as `create`
     * does, so no caller can post a link to a number they never scored.
     *
     * `code` is a PARAMETER rather than generated here: the factory stays free
     * of `crypto` so it tests deterministically, matching how
     * `api/v1/me/friend-code` generates before it writes.
     */
    async mintLink(input: {
      ownerId: string;
      boardId: string;
      code: string;
    }): Promise<MintLinkOutcome> {
      const { ownerId, boardId, code } = input;
      const rows = (await sql`
        WITH board AS (
          SELECT id, sort, game_slug, title FROM boards WHERE id = ${boardId}
        ),
        best AS (
          SELECT CASE WHEN board.sort = 'asc' THEN min(s.score) ELSE max(s.score) END AS score
            FROM scores s
            JOIN board ON board.id = s.board_id
           WHERE s.player_id = ${ownerId}
           GROUP BY board.sort
        ),
        ins AS (
          INSERT INTO challenges (kind, board_id, challenger_id, target_score, code)
          SELECT 'link', ${boardId}, ${ownerId}, best.score, ${code}
            FROM best
           WHERE best.score IS NOT NULL
          ON CONFLICT (challenger_id, board_id) WHERE kind = 'link'
          DO UPDATE SET target_score = EXCLUDED.target_score,
                        -- Keep a live link's code; replace a revoked one's.
                        code = CASE WHEN challenges.revoked_at IS NULL
                                    THEN challenges.code
                                    ELSE EXCLUDED.code END,
                        revoked_at = NULL
          RETURNING code, target_score
        )
        SELECT (SELECT code         FROM ins)   AS code,
               (SELECT target_score FROM ins)   AS target_score,
               (SELECT game_slug    FROM board) AS game_slug,
               (SELECT title        FROM board) AS board_title,
               EXISTS (SELECT 1 FROM board)     AS board_exists,
               EXISTS (SELECT 1 FROM best WHERE score IS NOT NULL) AS has_score
      `) as Row[];

      const row = rows[0] ?? {};
      return {
        code: toStrOrNull(row.code),
        targetScore: row.target_score == null ? null : toInt(row.target_score),
        gameSlug: toStrOrNull(row.game_slug),
        boardTitle: String(row.board_title ?? ""),
        boardExists: row.board_exists === true,
        hasScore: row.has_score === true,
      };
    },

    /**
     * The `/c/<code>` read. `null` when no such link exists.
     *
     * Returns a revoked link rather than hiding it, so the landing can say the
     * challenge is over instead of pretending the URL was never real — a dead
     * link followed from a chat should explain itself.
     *
     * Selects NO avatar and NO `public_id`; see {@link LinkOwner}.
     */
    async getLinkByCode(code: string): Promise<PublicLink | null> {
      const rows = (await sql`
        SELECT c.id, c.code, c.target_score, c.revoked_at,
               c.board_id, b.game_slug, b.title AS board_title,
               b.score_label, b.sort,
               p.username AS owner_username, p.handle AS owner_handle
          FROM challenges c
          JOIN boards  b ON b.id = c.board_id
          JOIN players p ON p.id = c.challenger_id
         WHERE c.kind = 'link' AND c.code = ${code}
         LIMIT 1
      `) as Row[];

      const row = rows[0];
      if (!row) return null;
      return {
        id: toInt(row.id),
        code: String(row.code),
        owner: {
          username: toStrOrNull(row.owner_username),
          displayName: displayNameFrom(row.owner_handle, row.owner_username),
        },
        targetScore: toInt(row.target_score),
        revokedAt: toIsoOrNull(row.revoked_at),
        ...mapBoard(row),
      };
    },

    /**
     * Count a press of "Beat it" by somebody who is not signed in.
     *
     * The signed-in path bumps the same counter inside
     * {@link createChallengeStore.claimLink}, so this is the anonymous half
     * only. Guarded on `revoked_at IS NULL` so a dead link's number cannot be
     * driven up by whoever still has the URL.
     *
     * Returns nothing and is called fail-soft: a counter is never worth
     * standing between a player and a game.
     */
    async noteLinkOpen(code: string): Promise<void> {
      await sql`
        UPDATE challenges SET opens = opens + 1
         WHERE kind = 'link' AND code = ${code} AND revoked_at IS NULL
      `;
    },

    /**
     * Take a link up: record this player as one of its takers, and count the press.
     *
     * ── WHY THIS IS NOT `create()` ─────────────────────────────────────────
     * `create` requires an accepted friendship, and that gate is the whole
     * anti-harassment posture of `friend` challenges. A link has no such gate by
     * design — the entire feature is being challenged by somebody you may not
     * know yet — so this is a SEPARATE method rather than a flag on that one.
     * Written apart so nobody can reach the friendless path by passing a
     * different `kind` to a function whose contract promises friends only.
     *
     * What replaces the friendship gate: the claimer initiated it (§7 of the
     * design doc), blocks are still honoured in both directions, and the
     * claimer carries their own rate limit.
     *
     * ── THE SNAPSHOT DOES NOT MOVE UNDER SOMEBODY MID-ATTEMPT ──────────────
     * `ON CONFLICT … DO UPDATE SET target_score = challenges.target_score` is a
     * deliberate no-op write. Taking a link up twice must not re-snapshot the
     * owner's improved score onto a claim already in flight — but the row still
     * has to come back, and `DO NOTHING` returns nothing, which would cost a
     * second round trip to tell "already claimed" from "refused". A no-op update
     * keeps the original number AND returns the row. It also preserves
     * `resolved_at`, so re-opening a link you already beat cannot un-win it.
     */
    async claimLink(input: {
      code: string;
      playerId: string;
    }): Promise<ClaimLinkOutcome> {
      const { code, playerId } = input;
      const rows = (await sql`
        WITH link AS (
          SELECT id, challenger_id, board_id, target_score, revoked_at
            FROM challenges
           WHERE kind = 'link' AND code = ${code}
           LIMIT 1
        ),
        blocked AS (
          SELECT 1 FROM player_blocks, link
           WHERE (blocker_id = ${playerId} AND blocked_id = link.challenger_id)
              OR (blocker_id = link.challenger_id AND blocked_id = ${playerId})
           LIMIT 1
        ),
        recent AS (
          SELECT count(*) AS n FROM challenges
           WHERE kind = 'link_claim'
             AND target_id = ${playerId}
             AND created_at >= now() - make_interval(secs => ${LINK_CLAIM_RATE_LIMIT.windowSeconds})
        ),
        bump AS (
          UPDATE challenges SET opens = opens + 1
           WHERE id = (SELECT id FROM link) AND revoked_at IS NULL
          RETURNING 1
        ),
        ins AS (
          INSERT INTO challenges
                 (kind, board_id, challenger_id, target_id, target_score, parent_id)
          SELECT 'link_claim', link.board_id, link.challenger_id, ${playerId},
                 link.target_score, link.id
            FROM link
           WHERE link.revoked_at IS NULL
             AND link.challenger_id <> ${playerId}
             AND NOT EXISTS (SELECT 1 FROM blocked)
             AND (SELECT n FROM recent) < ${LINK_CLAIM_RATE_LIMIT.maxPerWindow}
          ON CONFLICT (parent_id, target_id) WHERE kind = 'link_claim'
          DO UPDATE SET target_score = challenges.target_score
          RETURNING id, target_score
        )
        SELECT (SELECT id           FROM ins)  AS id,
               (SELECT target_score FROM ins)  AS target_score,
               EXISTS (SELECT 1 FROM link)     AS link_found,
               EXISTS (SELECT 1 FROM link WHERE revoked_at IS NOT NULL) AS is_revoked,
               EXISTS (SELECT 1 FROM link WHERE challenger_id = ${playerId}) AS is_self,
               EXISTS (SELECT 1 FROM blocked)  AS is_blocked,
               (SELECT n FROM recent)          AS recent_n
      `) as Row[];

      const row = rows[0] ?? {};
      return {
        id: row.id == null ? null : toInt(row.id),
        targetScore: row.target_score == null ? null : toInt(row.target_score),
        linkFound: row.link_found === true,
        isRevoked: row.is_revoked === true,
        isSelf: row.is_self === true,
        isBlocked: row.is_blocked === true,
        overRateLimit: toInt(row.recent_n) >= LINK_CLAIM_RATE_LIMIT.maxPerWindow,
      };
    },

    /**
     * Kill a link. Idempotent via `revoked_at IS NULL`, and scoped to the owner
     * so a code alone is not authority to revoke — anybody may hold the code.
     *
     * The row and the code SURVIVE. A deleted row would free the code to be
     * issued again, and a URL somebody killed must stay dead.
     */
    async revokeLink(input: { ownerId: string; code: string }): Promise<boolean> {
      const rows = (await sql`
        UPDATE challenges SET revoked_at = now()
         WHERE kind = 'link'
           AND code = ${input.code}
           AND challenger_id = ${input.ownerId}
           AND revoked_at IS NULL
        RETURNING id
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * This player's links, with the payoff attached — "14 opened, 3 beat you".
     *
     * The counts are correlated subqueries rather than a `GROUP BY` join,
     * because `beaten` is a filtered count of the same children and expressing
     * both in one aggregate needs a `FILTER` clause over an outer join that
     * reads worse for no gain at this cardinality. Both are served by
     * `challenges_link_children_idx`.
     */
    async listLinks(me: string): Promise<OwnedLink[]> {
      const rows = (await sql`
        SELECT c.id, c.code, c.target_score, c.opens, c.revoked_at, c.created_at,
               c.board_id, b.game_slug, b.title AS board_title,
               b.score_label, b.sort,
               (SELECT count(*) FROM challenges k
                 WHERE k.kind = 'link_claim' AND k.parent_id = c.id) AS claims,
               (SELECT count(*) FROM challenges k
                 WHERE k.kind = 'link_claim' AND k.parent_id = c.id
                   AND k.resolved_at IS NOT NULL) AS beaten
          FROM challenges c
          JOIN boards b ON b.id = c.board_id
         WHERE c.kind = 'link' AND c.challenger_id = ${me}
         ORDER BY c.id DESC
         LIMIT ${CHALLENGE_LIST_LIMIT}
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        code: String(row.code),
        targetScore: toInt(row.target_score),
        opens: toInt(row.opens),
        claims: toInt(row.claims),
        beaten: toInt(row.beaten),
        revokedAt: toIsoOrNull(row.revoked_at),
        createdAt: toIso(row.created_at),
        ...mapBoard(row),
      }));
    },

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Stamp `accepted_at` — the target pressed Play from the inbox.
     *
     * IDEMPOTENT VIA `accepted_at IS NULL`, so pressing Play three times keeps
     * the FIRST time rather than resetting the clock. Guarded on `target_id`
     * inside the statement rather than by checking ownership first, so there is
     * no window between the check and the write; the empty result set is how the
     * caller learns it was not theirs to accept.
     *
     * Returns `false` for an already-accepted row, which is not an error — the
     * caller treats "no change" and "accepted" alike.
     */
    async accept(me: string, id: number): Promise<boolean> {
      const rows = (await sql`
        UPDATE challenges c
           SET accepted_at = now()
         WHERE c.id = ${id}
           AND c.target_id = ${me}
           AND c.accepted_at IS NULL
           AND c.resolved_at IS NULL
           AND c.dismissed_at IS NULL
           AND NOT EXISTS (
                 SELECT 1 FROM player_blocks pb
                  WHERE (pb.blocker_id = ${me} AND pb.blocked_id = c.challenger_id)
                     OR (pb.blocker_id = c.challenger_id AND pb.blocked_id = ${me})
               )
        RETURNING c.id
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Stamp `dismissed_at` — the target binned it.
     *
     * The row is NEVER deleted: it is the cooldown record that stops the sender
     * asking again this afternoon, which is the whole reason challenges need no
     * equivalent of `friend_request_attempts`.
     *
     * Refuses a resolved row (`challenges_ending_chk` would reject it anyway) so
     * a win cannot be retroactively binned.
     */
    async dismiss(me: string, id: number): Promise<boolean> {
      const rows = (await sql`
        UPDATE challenges
           SET dismissed_at = now()
         WHERE id = ${id}
           AND target_id = ${me}
           AND resolved_at IS NULL
           AND dismissed_at IS NULL
        RETURNING id
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Close every open challenge this score just won, in ONE statement.
     *
     * ── THE MIRRORED PREDICATE ────────────────────────────────────────────
     * The `sort`/`score` comparison below is `beats()` from `resolve.ts`
     * restated in SQL, because resolution has to be a single UPDATE and a
     * JavaScript rule cannot run inside one. STRICT `>` / `<` — a tie does not
     * win. If `beats()` changes, this changes with it; `resolve.test.ts` is what
     * makes the original worth trusting.
     *
     * The window predicate is `isWithinWindow()`, likewise: lower bound
     * inclusive, upper bound EXCLUSIVE, and a NULL bound is no bound, which is
     * every `friend` challenge.
     *
     * NOTE WHAT THIS DOES *NOT* ALREADY DO. It needs no `kind` filter, but it
     * would NOT resolve a seasonal challenge as written: seasonal rows have
     * `target_id IS NULL` (the challenge is open to everyone) and this matches
     * `target_id = <player>`. Whoever builds that kind has to add the arm for
     * it, along with the per-player participation it implies — the seam here is
     * that the RULE needs no new branch, not that the query is already general.
     *
     * `accepted_at` is deliberately NOT consulted. Beating the score after
     * launching the game from the catalogue counts.
     */
    async resolveForScore(input: {
      playerId: string;
      boardId: string;
      score: number;
    }): Promise<ResolvedChallenge[]> {
      const { playerId, boardId, score } = input;
      const rows = (await sql`
        UPDATE challenges c
           SET resolved_at = now(), resolved_score = ${score}
          FROM boards b
         WHERE b.id = c.board_id
           AND c.board_id  = ${boardId}
           AND c.target_id = ${playerId}
           AND c.resolved_at  IS NULL
           AND c.dismissed_at IS NULL
           AND (c.starts_at IS NULL OR c.starts_at <= now())
           AND (c.ends_at   IS NULL OR c.ends_at   >  now())
           AND ((b.sort = 'asc'  AND ${score} < c.target_score)
             OR (b.sort <> 'asc' AND ${score} > c.target_score))
        RETURNING c.id, c.challenger_id, c.target_score, c.board_id
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        challengerId: String(row.challenger_id),
        targetScore: toInt(row.target_score),
        boardId: String(row.board_id),
      }));
    },

    /** How many open challenges are aimed at me — the tab's count badge. */
    async countIncoming(me: string): Promise<number> {
      const rows = (await sql`
        SELECT count(*) AS n FROM challenges
         WHERE target_id = ${me}
           AND resolved_at IS NULL AND dismissed_at IS NULL
      `) as Row[];
      return toInt(rows[0]?.n);
    },
  };
}

export type ChallengeStore = ReturnType<typeof createChallengeStore>;
