/**
 * HallPass — the social-graph store: friendships, blocks, usernames, plays.
 *
 * Built as a `createSocialStore(sql)` FACTORY, like `scoreboard/store.ts` and
 * unlike `players.ts`/`favorites.ts` which import the shared `sql` directly. That
 * deviation is deliberate: the friend-request state machine has far more branches
 * than a favourites toggle, it is the part most worth unit-testing, and the
 * fake-tagged-template seam is the only way to test SQL branch selection without
 * a live database. The type-only driver import keeps this module free of
 * `server-only`.
 *
 * SQL SAFETY, the load-bearing rule carried from every other store here: the
 * `neon()` tagged template parameterises interpolated VALUES; it does NOT reliably
 * splice raw SQL fragments. Nothing below interpolates a fragment — including the
 * interval arithmetic, which binds the seconds/days count as a VALUE inside
 * `make_interval()` exactly as `appendScore` does.
 *
 * ONE STATEMENT PER MUTATION. Every transition below is a single statement built
 * from data-modifying CTEs, for a reason specific to this driver: `neon()` speaks
 * SQL-over-HTTP with one stateless request per call, so there is no way to hold a
 * transaction across two of them. A check-then-write split over two calls has a
 * real window in between. Folding the gate and the write into one statement makes
 * each transition atomic, and lets the ban/block/cooldown checks be evaluated by
 * the same snapshot that performs the insert.
 *
 * The same honest caveat as `appendScore` applies: the RATE LIMIT is best-effort
 * under concurrency. Two simultaneous requests can both observe a count below the
 * cap. That is an accepted trade for a casual-abuse limiter.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  ACTIVITY_WINDOW_DAYS,
  FRIEND_REQUEST_PAIR_COOLDOWN_SECONDS,
  FRIEND_REQUEST_RATE_LIMIT,
  MAX_FRIENDS,
  MAX_OUTSTANDING_REQUESTS,
  SEARCH_MAX_RESULTS,
  USERNAME_RENAME_COOLDOWN_DAYS,
  USERNAME_TOMBSTONE_DAYS,
} from "./config";
import { orderPair } from "./pair";
import { foldToAscii } from "@/app/lib/username";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/** BIGINT and count(*) arrive as strings from the HTTP driver. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * A player as seen by ANOTHER player. `id` is the `public_id` UUID, never
 * `players.id` (the Google subject), and there is no `email` field by
 * construction — the same discipline that makes `PlayerIdentity` safe.
 */
export type PublicProfile = {
  id: string;
  username: string | null;
  displayName: string;
  image: string | null;
};

export type FriendRequest = PublicProfile & {
  /** ISO timestamp of when the request was sent. */
  requestedAt: string;
};

/** Outcome of attempting to send a friend request. */
export type SendResult =
  | "sent"
  | "accepted"
  | "already"
  | "cooldown"
  | "rate-limited"
  | "at-capacity"
  | "unavailable";


/**
 * Character map for folding a display name to ASCII inside Postgres.
 *
 * `translate()` rather than the `unaccent` extension: unaccent would be a new
 * database dependency, and a migration, for exactly one query. These two strings
 * MUST stay the same length in characters — Postgres pairs them positionally and
 * silently DELETES any source character with no partner, which would turn "Ateş"
 * into "Ate" rather than "Ates" and quietly break the very search this exists for.
 *
 * Lowercase only, because every use site wraps the column in `lower()` first.
 * Turkish comes first because it is the alphabet this site's players actually
 * type; the rest is common Latin coverage. It only has to agree with
 * `foldToAscii` on the characters people really use, not on all of Unicode.
 */
const HANDLE_FOLD_FROM = "şığüöçàáâãäåèéêëìíîïòóôõùúûñýÿ";
const HANDLE_FOLD_TO = "siguocaaaaaaeeeeiiiioooouuunyy";

export function createSocialStore(sql: Sql) {
  /**
   * Project a joined `players` row to the public shape.
   *
   * `publicDisplayName` semantics are reproduced here rather than imported so the
   * store stays free of a dependency on `players.ts` (which imports the shared
   * `sql` and would defeat the factory seam): handle, else "@username", else
   * "Player". The Google `name` is deliberately NOT a fallback — it is the
   * person's real name for most accounts.
   */
  function mapPublic(row: Row): PublicProfile {
    const handle = row.handle == null ? null : String(row.handle).trim();
    const username = row.username == null ? null : String(row.username);
    return {
      id: String(row.public_id),
      username,
      displayName: handle || (username ? `@${username}` : "Player"),
      image: row.image == null ? null : String(row.image),
    };
  }

  return {
    // -----------------------------------------------------------------------
    // Lookups
    // -----------------------------------------------------------------------

    /** Resolve a `public_id` UUID to the internal player id, or null. */
    async internalIdFromPublicId(publicId: string): Promise<string | null> {
      // Guarded in JS: a malformed UUID would make Postgres raise 22P02 rather
      // than return no rows, turning a bad request into a 500.
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          publicId,
        )
      ) {
        return null;
      }
      const rows = await sql`
        SELECT id FROM players WHERE public_id = ${publicId}::uuid
      `;
      return rows.length > 0 ? String(rows[0].id) : null;
    },

    async internalIdFromUsername(username: string): Promise<string | null> {
      const rows = await sql`
        SELECT id FROM players WHERE username = ${username}
      `;
      return rows.length > 0 ? String(rows[0].id) : null;
    },

    async internalIdFromFriendCode(code: string): Promise<string | null> {
      const rows = await sql`
        SELECT id FROM players WHERE friend_code = ${code}
      `;
      return rows.length > 0 ? String(rows[0].id) : null;
    },

    /**
     * Prefix search over usernames.
     *
     * THE WILDCARD HAZARD, which is the whole reason this is not a one-liner:
     * `_` is a LEGAL username character AND the SQL `LIKE` single-character
     * wildcard, and `%` is the multi-character one. The tagged template protects
     * against injection — the pattern is a bound value — but NOT against wildcard
     * SEMANTICS, so a search for `_` would match every username on the site and a
     * search for `%` would dump the entire namespace. Escaping them with an
     * explicit `ESCAPE` clause is the fix; the `'\'` there is literal SQL text,
     * not a spliced fragment, so the no-fragment rule holds.
     *
     * Excludes the caller, anyone either party has blocked, and private profiles.
     * There is deliberately NO pagination or offset — that is what stops the
     * result cap being turned into a namespace walk.
     */
    /**
     * Find people to befriend, by username OR display name.
     *
     * IT USED TO MATCH USERNAMES ONLY, and that made the feature unusable: not one
     * player on the site had claimed a username, because claiming was opt-in and
     * buried on the account page. So every search returned nothing, for everyone,
     * forever — and since a display name was never matched either, typing the name
     * you actually know somebody by could not work in principle.
     *
     * Matching the handle exposes nothing new. A handle is already printed next to
     * every score on every public leaderboard; it is the least private field on the
     * player record. What stays protected is everything this query still refuses to
     * return: private profiles, anyone either party has blocked, and the internal
     * id — callers get `public_id` only.
     *
     * ENUMERATION IS BOUNDED THE SAME WAY AS BEFORE: a session is required, the
     * caller must supply at least `SEARCH_MIN_CHARS`, at most `SEARCH_MAX_RESULTS`
     * come back, and there is no pagination — which is the part that actually stops
     * somebody walking the namespace.
     *
     * Handles match at a WORD BOUNDARY as well as at the start, because "Ata Can"
     * is one person and somebody looking for them will type either half. A full
     * substring match would also find "can" inside "Duncan", which turns a search
     * into a fishing expedition. Usernames stay prefix-only: they are a namespace,
     * not a name.
     *
     * `%` and `_` in the input are escaped before they reach the pattern. `_` is a
     * legal username character AND the LIKE single-character wildcard, so an
     * unescaped `_` would quietly match everybody.
     *
     * The handle comparison is case-insensitive and therefore cannot use the
     * prefix index. That is fine at this size and would need reconsidering at a
     * scale this site is nowhere near.
     */
    async searchPlayers(me: string, query: string): Promise<PublicProfile[]> {
      // Fold BOTH sides to plain ASCII so "Ateş" and "Ates" are the same search.
      // A Turkish keyboard produces "ş" without being asked, so a player typing a
      // friend's name the natural way was searching for a spelling the username
      // could not contain — usernames are ASCII by rule — and got nothing back.
      const folded = foldToAscii(query);
      const escaped = folded.replace(/([\\%_])/g, "\\$1");
      const startsWith = `${escaped}%`;
      const wordStart = `% ${escaped}%`;
      const rows = await sql`
        SELECT p.public_id, p.username, p.handle, p.image
        FROM players p
        WHERE (
                p.username LIKE ${startsWith} ESCAPE '\\'
             OR translate(lower(p.handle), ${HANDLE_FOLD_FROM}, ${HANDLE_FOLD_TO})
                  LIKE ${startsWith} ESCAPE '\\'
             OR translate(lower(p.handle), ${HANDLE_FOLD_FROM}, ${HANDLE_FOLD_TO})
                  LIKE ${wordStart} ESCAPE '\\'
              )
          AND p.id <> ${me}
          AND p.profile_visibility <> 'private'
          AND NOT EXISTS (
            SELECT 1 FROM player_blocks b
            WHERE (b.blocker_id = ${me} AND b.blocked_id = p.id)
               OR (b.blocker_id = p.id AND b.blocked_id = ${me})
          )
        ORDER BY
          -- Exact-ish matches first: a username hit is the most deliberate thing
          -- somebody can type, then a name that starts with the query, then one
          -- that merely contains it as a word.
          (p.username LIKE ${startsWith} ESCAPE '\\') DESC,
          (translate(lower(p.handle), ${HANDLE_FOLD_FROM}, ${HANDLE_FOLD_TO})
             LIKE ${startsWith} ESCAPE '\\') DESC,
          p.username ASC NULLS LAST,
          p.handle ASC
        LIMIT ${SEARCH_MAX_RESULTS}
      `;
      return rows.map(mapPublic);
    },

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /** Accepted friends, newest first. */
    async listFriends(me: string): Promise<PublicProfile[]> {
      const rows = await sql`
        SELECT p.public_id, p.username, p.handle, p.image
        FROM friendships f
        JOIN players p
          ON p.id = CASE WHEN f.player_a = ${me} THEN f.player_b ELSE f.player_a END
        WHERE f.status = 'accepted'
          AND (f.player_a = ${me} OR f.player_b = ${me})
        ORDER BY f.responded_at DESC NULLS LAST, f.created_at DESC
      `;
      return rows.map(mapPublic);
    },

    /** Requests sent TO me and awaiting my answer. */
    async listIncomingRequests(me: string): Promise<FriendRequest[]> {
      const rows = await sql`
        SELECT p.public_id, p.username, p.handle, p.image, f.created_at
        FROM friendships f
        JOIN players p
          ON p.id = CASE WHEN f.player_a = ${me} THEN f.player_b ELSE f.player_a END
        WHERE f.status = 'pending'
          AND (f.player_a = ${me} OR f.player_b = ${me})
          AND f.requested_by <> ${me}
        ORDER BY f.created_at DESC
      `;
      return rows.map((row) => ({
        ...mapPublic(row),
        requestedAt: toIso(row.created_at),
      }));
    },

    /** Requests I have sent that are still awaiting an answer. */
    async listOutgoingRequests(me: string): Promise<FriendRequest[]> {
      const rows = await sql`
        SELECT p.public_id, p.username, p.handle, p.image, f.created_at
        FROM friendships f
        JOIN players p
          ON p.id = CASE WHEN f.player_a = ${me} THEN f.player_b ELSE f.player_a END
        WHERE f.status = 'pending'
          AND (f.player_a = ${me} OR f.player_b = ${me})
          AND f.requested_by = ${me}
        ORDER BY f.created_at DESC
      `;
      return rows.map((row) => ({
        ...mapPublic(row),
        requestedAt: toIso(row.created_at),
      }));
    },

    /**
     * The caller's social state at a glance — one round trip, no row payload.
     *
     * `hasUsername` rides along with the counts rather than living on its own
     * endpoint because both consumers want the whole picture at once: the header
     * badge polls this on EVERY page, and the feature promo needs to know what
     * the player is still missing. Splitting it would double the requests on the
     * hottest client path to carry one boolean.
     */
    async counts(
      me: string,
    ): Promise<{ friends: number; incoming: number; hasUsername: boolean }> {
      const rows = await sql`
        SELECT
          (SELECT count(*)::int FROM friendships
            WHERE status = 'accepted' AND (player_a = ${me} OR player_b = ${me})) AS friends,
          (SELECT count(*)::int FROM friendships
            WHERE status = 'pending' AND requested_by <> ${me}
              AND (player_a = ${me} OR player_b = ${me}))                        AS incoming,
          (SELECT username IS NOT NULL FROM players WHERE id = ${me})            AS has_username
      `;
      const row = rows[0] ?? {};
      return {
        friends: toInt(row.friends),
        incoming: toInt(row.incoming),
        hasUsername: Boolean(row.has_username),
      };
    },

    /**
     * Which of my friends have recently played each of `slugs`.
     *
     * NO BLOCK FILTER IS NEEDED, and that is a property of the schema rather than
     * an oversight: blocking DELETES the friendship row, so an accepted friendship
     * and a block can never coexist.
     *
     * `slugs` is bound as a `text[]`, and the recency window binds its day count
     * inside `make_interval()` — neither is a spliced fragment. Served by
     * `player_plays_slug_idx`; with `MAX_FRIENDS` capped the fan-out is bounded.
     */
    async friendsPlaying(
      me: string,
      slugs: string[],
    ): Promise<{ slug: string; friend: PublicProfile; lastPlayed: string }[]> {
      if (slugs.length === 0) return [];
      const rows = await sql`
        SELECT pp.slug, pp.last_played, p.public_id, p.username, p.handle, p.image
        FROM friendships f
        JOIN players p
          ON p.id = CASE WHEN f.player_a = ${me} THEN f.player_b ELSE f.player_a END
        JOIN player_plays pp ON pp.player_id = p.id
        WHERE f.status = 'accepted'
          AND (f.player_a = ${me} OR f.player_b = ${me})
          AND pp.slug = ANY(${slugs}::text[])
          AND pp.last_played >= now() - make_interval(0, 0, 0, ${ACTIVITY_WINDOW_DAYS})
        ORDER BY pp.slug ASC, pp.last_played DESC
      `;
      return rows.map((row) => ({
        slug: String(row.slug),
        friend: mapPublic(row),
        lastPlayed: toIso(row.last_played),
      }));
    },

    /** Whether two players are accepted friends. */
    async areFriends(me: string, them: string): Promise<boolean> {
      const { lo, hi } = orderPair(me, them);
      const rows = await sql`
        SELECT 1 FROM friendships
        WHERE player_a = ${lo} AND player_b = ${hi} AND status = 'accepted'
      `;
      return rows.length > 0;
    },

    // -----------------------------------------------------------------------
    // Friend-request state machine
    // -----------------------------------------------------------------------

    /**
     * Send a friend request — the most involved statement in the feature.
     *
     * One statement, five gates, evaluated against one snapshot:
     *   blocked      either direction, so a block is enforced atomically with the
     *                write rather than in a check that could race it
     *   cooling      per-pair cooldown, which is what makes DELETE-on-decline safe
     *   recent       per-requester rate limit (distinct targets per window)
     *   outstanding  cap on requests in flight
     *   my_friends   friend cap
     *
     * The `log` CTE writes the attempt row and the `ins` CTE only fires
     * `WHERE EXISTS (SELECT 1 FROM log)`, so an attempt that fails a gate never
     * touches `friendships`. The cooldown upsert is guarded on `created_at` so a
     * REJECTED retry does not bump the timestamp and lock the caller out further.
     *
     * `ON CONFLICT ... DO UPDATE ... WHERE status='pending' AND requested_by <> me`
     * is what makes CROSSED REQUESTS auto-accept: if they already asked me, my
     * request completes the handshake in the same statement. When the conflict
     * fires but the WHERE fails (the row is already accepted, or it is my own
     * pending request), `RETURNING` yields no rows — which is how "already" is
     * distinguished from "sent" without a second query.
     */
    async sendRequest(me: string, them: string): Promise<SendResult> {
      const { lo, hi } = orderPair(me, them);
      const rows = await sql`
        WITH gate AS (
          SELECT
            (SELECT count(*) FROM player_blocks
              WHERE (blocker_id = ${me} AND blocked_id = ${them})
                 OR (blocker_id = ${them} AND blocked_id = ${me}))                    AS blocked,
            (SELECT count(*) FROM friend_request_attempts
              WHERE requester_id = ${me}
                AND created_at >= now() - make_interval(0,0,0,0,0,0,${FRIEND_REQUEST_RATE_LIMIT.windowSeconds})) AS recent,
            (SELECT count(*) FROM friend_request_attempts
              WHERE requester_id = ${me} AND target_id = ${them}
                AND created_at >= now() - make_interval(0,0,0,0,0,0,${FRIEND_REQUEST_PAIR_COOLDOWN_SECONDS}))    AS cooling,
            (SELECT count(*) FROM friendships
              WHERE status = 'pending' AND requested_by = ${me})                      AS outstanding,
            (SELECT count(*) FROM friendships
              WHERE status = 'accepted' AND (player_a = ${me} OR player_b = ${me}))   AS my_friends
        ),
        log AS (
          INSERT INTO friend_request_attempts (requester_id, target_id)
          SELECT ${me}, ${them} FROM gate
          WHERE blocked = 0 AND cooling = 0
            AND recent      < ${FRIEND_REQUEST_RATE_LIMIT.maxPerWindow}
            AND outstanding < ${MAX_OUTSTANDING_REQUESTS}
            AND my_friends  < ${MAX_FRIENDS}
          ON CONFLICT (requester_id, target_id) DO UPDATE
            SET created_at = now(),
                attempt_count = friend_request_attempts.attempt_count + 1
          RETURNING requester_id
        ),
        ins AS (
          INSERT INTO friendships (player_a, player_b, status, requested_by)
          SELECT ${lo}, ${hi}, 'pending', ${me}
          WHERE EXISTS (SELECT 1 FROM log)
          ON CONFLICT (player_a, player_b) DO UPDATE
            SET status = 'accepted', responded_at = now()
            WHERE friendships.status = 'pending' AND friendships.requested_by <> ${me}
          RETURNING status
        )
        SELECT (SELECT count(*) FROM log)::int  AS logged,
               (SELECT status FROM ins)         AS status,
               (SELECT blocked FROM gate)::int  AS blocked,
               (SELECT cooling FROM gate)::int  AS cooling,
               (SELECT recent  FROM gate)::int  AS recent,
               (SELECT outstanding FROM gate)::int AS outstanding,
               (SELECT my_friends  FROM gate)::int AS my_friends
      `;
      const row = rows[0] ?? {};
      if (toInt(row.logged) === 0) {
        // "unavailable" deliberately covers BOTH blocked and not-found. If those
        // differed, this endpoint would become a username-existence oracle that
        // bypasses the search endpoint's rate limit entirely.
        if (toInt(row.blocked) > 0) return "unavailable";
        if (toInt(row.cooling) > 0) return "cooldown";
        if (
          toInt(row.outstanding) >= MAX_OUTSTANDING_REQUESTS ||
          toInt(row.my_friends) >= MAX_FRIENDS
        ) {
          return "at-capacity";
        }
        return "rate-limited";
      }
      const status = row.status == null ? null : String(row.status);
      if (status === "accepted") return "accepted";
      if (status === "pending") return "sent";
      return "already";
    },

    /**
     * Accept a pending request.
     *
     * Guarded on `requested_by = them` rather than `<> me`, which is strictly
     * stronger and equally cheap: combined with `lo`/`hi` derived from
     * `orderPair(me, them)`, it structurally proves the caller is a member of the
     * pair, so a third party cannot accept someone else's request even with
     * guessed ids. Both parties' friend caps are re-checked in the same statement.
     */
    async acceptRequest(me: string, them: string): Promise<boolean> {
      const { lo, hi } = orderPair(me, them);
      const rows = await sql`
        WITH caps AS (
          SELECT
            (SELECT count(*) FROM friendships
              WHERE status='accepted' AND (player_a=${me}   OR player_b=${me}))   AS mine,
            (SELECT count(*) FROM friendships
              WHERE status='accepted' AND (player_a=${them} OR player_b=${them})) AS theirs
        ),
        upd AS (
          UPDATE friendships SET status='accepted', responded_at=now()
          WHERE player_a = ${lo} AND player_b = ${hi}
            AND status = 'pending' AND requested_by = ${them}
            AND (SELECT mine   FROM caps) < ${MAX_FRIENDS}
            AND (SELECT theirs FROM caps) < ${MAX_FRIENDS}
          RETURNING player_a
        )
        SELECT count(*)::int AS n FROM upd
      `;
      return toInt(rows[0]?.n) > 0;
    },

    /**
     * Remove any relationship with `them`: decline, cancel, or unfriend.
     *
     * ONE unconditional verb rather than three status-guarded ones. That is the
     * honest semantic of the user's intent ("remove this relationship") and is
     * strictly more robust than making the client pick the right one against a
     * view that may already be stale.
     *
     * Zero rows is NOT an error — callers report success either way. A 404 here
     * would tell the caller whether a relationship existed, which is information
     * about a resource they may not be entitled to know about.
     */
    async removeRelationship(me: string, them: string): Promise<boolean> {
      const { lo, hi } = orderPair(me, them);
      const rows = await sql`
        DELETE FROM friendships
        WHERE player_a = ${lo} AND player_b = ${hi}
        RETURNING player_a
      `;
      return rows.length > 0;
    },

    /**
     * Block `them`: drop any friendship and record the block, in one statement.
     *
     * Unblocking does NOT restore the friendship — re-friending needs a fresh
     * request. That is correct: unblocking means "I will consider you again", not
     * "we are friends again".
     */
    async blockPlayer(me: string, them: string): Promise<void> {
      const { lo, hi } = orderPair(me, them);
      await sql`
        WITH del AS (
          DELETE FROM friendships
          WHERE player_a = ${lo} AND player_b = ${hi}
          RETURNING player_a
        ),
        ins AS (
          INSERT INTO player_blocks (blocker_id, blocked_id)
          VALUES (${me}, ${them})
          ON CONFLICT (blocker_id, blocked_id) DO NOTHING
          RETURNING blocker_id
        )
        SELECT (SELECT count(*) FROM del)::int AS unfriended,
               (SELECT count(*) FROM ins)::int AS blocked
      `;
    },

    async unblockPlayer(me: string, them: string): Promise<void> {
      await sql`
        DELETE FROM player_blocks
        WHERE blocker_id = ${me} AND blocked_id = ${them}
      `;
    },

    async listBlocked(me: string): Promise<PublicProfile[]> {
      const rows = await sql`
        SELECT p.public_id, p.username, p.handle, p.image
        FROM player_blocks b
        JOIN players p ON p.id = b.blocked_id
        WHERE b.blocker_id = ${me}
        ORDER BY b.created_at DESC
      `;
      return rows.map(mapPublic);
    },

    /** Whether `me` has blocked `them`, or vice versa. */
    async isBlockedEitherWay(me: string, them: string): Promise<boolean> {
      const rows = await sql`
        SELECT 1 FROM player_blocks
        WHERE (blocker_id = ${me} AND blocked_id = ${them})
           OR (blocker_id = ${them} AND blocked_id = ${me})
        LIMIT 1
      `;
      return rows.length > 0;
    },

    // -----------------------------------------------------------------------
    // Usernames and friend codes
    // -----------------------------------------------------------------------

    /**
     * Claim or change a username, in one statement.
     *
     * Gates, all evaluated against one snapshot:
     *   tomb   the name is tombstoned by SOMEONE ELSE and still quarantined
     *   plays  anti-squatting, ON RENAMES ONLY — see below.
     *   cooldown  rename frequency
     *
     * THE PLAYS GATE NO LONGER APPLIES TO A FIRST CLAIM, and that is a deliberate
     * reversal. It was written as "the account must have played at least one
     * game", on the reasoning that a real user has a play row by construction
     * while a farm of throwaway Google accounts would have to simulate gameplay
     * per account.
     *
     * The premise was wrong. `player_plays` is only written for SIGNED-IN players
     * (`/api/v1/me/plays` returns `recorded:false` for guests), so at the moment
     * anybody first signs in their play count is exactly zero — including someone
     * who has been playing as a guest for months. Asking for a username during
     * sign-up therefore hit this gate for EVERY user, and it failed silently:
     * `upd` matches no row, the statement still succeeds, and the caller sees
     * "not claimed" with no reason that maps to anything a person could act on.
     *
     * The gate survives on RENAMES, where it still does useful work: an account
     * that has never played has no legitimate reason to cycle names, which is
     * exactly the shape of name-parking. And the real defence against account
     * farming was never this — it is that Google itself charges a phone
     * verification per account.
     *
     * The `hist` CTE tombstones the OLD name before `upd` takes the new one, so a
     * rename cannot free the previous name instantly.
     *
     * A unique violation on `username` surfaces as a driver error and the caller
     * maps it to "taken". That is the ONLY correct way to resolve the
     * check-then-claim race; a prior availability SELECT is advisory at best.
     */
    async claimUsername(
      playerId: string,
      next: string,
    ): Promise<{ claimed: boolean; tombstoned: boolean; plays: number }> {
      const rows = await sql`
        WITH me AS (
          SELECT id, username, username_changed_at,
                 (SELECT count(*) FROM player_plays WHERE player_id = ${playerId}) AS plays
          FROM players WHERE id = ${playerId}
        ),
        tomb AS (
          SELECT count(*) AS n FROM username_history
          WHERE username = ${next}
            AND released_at >= now() - make_interval(0, 0, 0, ${USERNAME_TOMBSTONE_DAYS})
            AND (player_id IS NULL OR player_id <> ${playerId})
        ),
        hist AS (
          INSERT INTO username_history (username, player_id)
          SELECT (SELECT username FROM me), ${playerId}
          WHERE (SELECT username FROM me) IS NOT NULL
            AND (SELECT n FROM tomb) = 0
            AND ((SELECT username_changed_at FROM me) IS NULL
                 OR (SELECT username_changed_at FROM me) < now() - make_interval(0, 0, 0, ${USERNAME_RENAME_COOLDOWN_DAYS}))
          ON CONFLICT (username) DO UPDATE
            SET player_id = EXCLUDED.player_id, released_at = now()
          RETURNING username
        ),
        upd AS (
          UPDATE players SET username = ${next}, username_changed_at = now()
          WHERE id = ${playerId}
            AND (SELECT n FROM tomb) = 0
            -- Plays are required to RENAME, never to claim a first name. See the
            -- docblock: at first sign-in everybody has zero, so requiring them
            -- here rejected every new player with no actionable reason.
            AND (username IS NULL OR (SELECT plays FROM me) > 0)
            AND (username IS NULL
                 OR username_changed_at IS NULL
                 OR username_changed_at < now() - make_interval(0, 0, 0, ${USERNAME_RENAME_COOLDOWN_DAYS}))
          RETURNING username
        )
        SELECT (SELECT count(*) FROM upd)::int AS claimed,
               (SELECT n FROM tomb)::int       AS tombstoned,
               (SELECT plays FROM me)::int     AS plays
      `;
      const row = rows[0] ?? {};
      return {
        claimed: toInt(row.claimed) > 0,
        tombstoned: toInt(row.tombstoned) > 0,
        plays: toInt(row.plays),
      };
    },

    /**
     * Set a friend code only if the player has none.
     *
     * Guarded on `friend_code IS NULL` so it is idempotent under concurrency:
     * zero rows back means someone else won the race and the caller re-reads
     * rather than overwriting a code the player may already have shared.
     *
     * Never called from `upsertPlayerOnLogin`: in Auth.js v5 a throwing `signIn`
     * is `AccessDenied`, so a collision-retry loop on the login hot path is a way
     * to lock people out of the site over a telemetry column.
     */
    async setFriendCodeIfAbsent(
      playerId: string,
      code: string,
    ): Promise<string | null> {
      const rows = await sql`
        UPDATE players
        SET friend_code = ${code}, friend_code_rotated_at = now()
        WHERE id = ${playerId} AND friend_code IS NULL
        RETURNING friend_code
      `;
      return rows.length > 0 ? String(rows[0].friend_code) : null;
    },

    /** Replace a player's friend code unconditionally (rotation). */
    async rotateFriendCode(playerId: string, code: string): Promise<void> {
      await sql`
        UPDATE players
        SET friend_code = ${code}, friend_code_rotated_at = now()
        WHERE id = ${playerId}
      `;
    },

    /** The caller's own social fields. Separate from `getPlayerById` on purpose. */
    async getOwnSocial(playerId: string): Promise<{
      username: string | null;
      friendCode: string | null;
      publicId: string;
      profileVisibility: string;
      usernameChangedAt: string | null;
    } | null> {
      const rows = await sql`
        SELECT username, friend_code, public_id, profile_visibility, username_changed_at
        FROM players WHERE id = ${playerId}
      `;
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        username: row.username == null ? null : String(row.username),
        friendCode: row.friend_code == null ? null : String(row.friend_code),
        publicId: String(row.public_id),
        profileVisibility: String(row.profile_visibility),
        usernameChangedAt:
          row.username_changed_at == null ? null : toIso(row.username_changed_at),
      };
    },

    async setProfileVisibility(
      playerId: string,
      visibility: "public" | "friends" | "private",
    ): Promise<void> {
      // `visibility` is a whitelisted union chosen in JS, never a caller string —
      // it is still bound as a VALUE, never spliced.
      await sql`
        UPDATE players SET profile_visibility = ${visibility} WHERE id = ${playerId}
      `;
    },

    // -----------------------------------------------------------------------
    // Plays
    // -----------------------------------------------------------------------

    /**
     * Record a play. One statement, one round trip, idempotent, no read-first.
     *
     * The UPSERT is what keeps this table flat: an append-only log at realistic
     * traffic would be millions of rows a year, whereas this converges to
     * players x distinct-games-played and then stops growing.
     */
    async recordPlay(playerId: string, slug: string): Promise<void> {
      await sql`
        INSERT INTO player_plays (player_id, slug, play_count, first_played, last_played)
        VALUES (${playerId}, ${slug}, 1, now(), now())
        ON CONFLICT (player_id, slug) DO UPDATE SET
          play_count  = player_plays.play_count + 1,
          last_played = now()
      `;
    },

    /**
     * Every count the badge rules need, in ONE round trip.
     *
     * Written as independent scalar subqueries rather than a pile of joins: each
     * one is answered by its own index (`player_plays` PK, `idx_scores_player`,
     * `game_reviews_player_idx`, the friendship partial indexes), and joining
     * them would multiply rows before aggregating. On the HTTP driver — one
     * request per statement, no pooling — collapsing this to a single query is
     * the difference between a profile view costing one round trip and seven.
     *
     * The rank-1 count is the only non-trivial part: `scores` has no stored rank,
     * so first place is "no score on this board beats mine". `DISTINCT ON` picks
     * each board's best row and the outer filter keeps the ones that are this
     * player's.
     */
    async badgeStats(playerId: string): Promise<{
      gamesPlayed: number;
      totalPlays: number;
      firstPlaces: number;
      boardsEntered: number;
      reviewsWritten: number;
      bestReviewHelpful: number;
      friends: number;
      accountAgeDays: number;
      achievementPoints: number;
    }> {
      const rows = await sql`
        SELECT
          (SELECT count(*)::int FROM player_plays WHERE player_id = ${playerId})            AS games_played,
          (SELECT COALESCE(sum(play_count), 0)::int FROM player_plays
            WHERE player_id = ${playerId})                                                  AS total_plays,
          (SELECT count(DISTINCT board_id)::int FROM scores WHERE player_id = ${playerId})   AS boards_entered,
          (SELECT count(*)::int FROM (
             SELECT DISTINCT ON (board_id) board_id, player_id
             FROM scores
             ORDER BY board_id, score DESC, created_at ASC, id ASC
           ) best WHERE best.player_id = ${playerId})                                       AS first_places,
          (SELECT count(*)::int FROM game_reviews
            WHERE player_id = ${playerId} AND status = 'visible')                           AS reviews_written,
          (SELECT COALESCE(max(helpful_count), 0)::int FROM game_reviews
            WHERE player_id = ${playerId} AND status = 'visible')                           AS best_review_helpful,
          (SELECT count(*)::int FROM friendships
            WHERE status = 'accepted' AND (player_a = ${playerId} OR player_b = ${playerId})) AS friends,
          (SELECT GREATEST(0, EXTRACT(DAY FROM now() - created_at))::int FROM players
            WHERE id = ${playerId})                                                          AS account_age_days,
          -- Game achievements are the ONE badge input that cannot be derived from
          -- rows the platform already has: only the game knows the player beat
          -- level 10. Summed here rather than counted so a hard achievement can
          -- be worth more than an easy one.
          (SELECT COALESCE(sum(a.points), 0)::int
             FROM player_achievements pa
             JOIN achievements a ON a.id = pa.achievement_id
            WHERE pa.player_id = ${playerId} AND pa.unlocked_at IS NOT NULL)                 AS achievement_points
      `;
      const row = rows[0] ?? {};
      return {
        gamesPlayed: toInt(row.games_played),
        totalPlays: toInt(row.total_plays),
        firstPlaces: toInt(row.first_places),
        boardsEntered: toInt(row.boards_entered),
        reviewsWritten: toInt(row.reviews_written),
        bestReviewHelpful: toInt(row.best_review_helpful),
        friends: toInt(row.friends),
        accountAgeDays: toInt(row.account_age_days),
        achievementPoints: toInt(row.achievement_points),
      };
    },

    /** A player's recently-played slugs, newest first. */
    async recentPlays(playerId: string, limit: number): Promise<string[]> {
      const rows = await sql`
        SELECT slug FROM player_plays
        WHERE player_id = ${playerId}
        ORDER BY last_played DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => String(row.slug));
    },
  };
}

export type SocialStore = ReturnType<typeof createSocialStore>;
