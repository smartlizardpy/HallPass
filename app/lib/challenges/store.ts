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
         WHERE c.challenger_id = ${me}
           AND c.dismissed_at IS NULL
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
        recent AS (
          SELECT count(*) AS n FROM challenges
           WHERE challenger_id = ${challengerId}
             AND created_at >= now() - make_interval(secs => ${CHALLENGE_SENDER_RATE_LIMIT.windowSeconds})
        ),
        open_sent AS (
          SELECT count(*) AS n FROM challenges
           WHERE challenger_id = ${challengerId}
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
        UPDATE challenges
           SET accepted_at = now()
         WHERE id = ${id}
           AND target_id = ${me}
           AND accepted_at IS NULL
           AND resolved_at IS NULL
           AND dismissed_at IS NULL
        RETURNING id
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
     * inclusive, upper bound EXCLUSIVE, and a NULL bound is no bound — which is
     * every `friend` challenge, and is why this statement needs no `kind` filter
     * and would resolve a live seasonal challenge unchanged.
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
