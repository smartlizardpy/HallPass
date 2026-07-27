/**
 * HallPass — the achievement store.
 *
 * A `createAchievementStore(sql)` factory, like `scoreboard/store.ts`,
 * `social/store.ts` and `reviews/store.ts`: the write path is a single multi-CTE
 * statement, and the fake-tagged-template seam is the only way to test its
 * branches without a database.
 *
 * WHAT MAKES THIS FILE DIFFERENT from the other three stores: every other write
 * here takes ONE thing and decides ONE outcome. An unlock call takes a BATCH —
 * a game that finishes a level crosses several thresholds at once — and each
 * entry needs its own answer ("did THIS one just unlock?"), because that answer
 * is what the SDK turns into a toast. Getting it wrong shows the player a
 * celebration for something they earned last week.
 *
 * SQL SAFETY: the `neon()` tagged template parameterises VALUES only and does
 * not reliably splice fragments. A batch is therefore NOT built by concatenating
 * N `VALUES` tuples — the whole batch travels as TWO PARALLEL BOUND ARRAYS and
 * is zipped back into rows server-side by
 * `unnest($1::text[], $2::int[]) WITH ORDINALITY`, the same idiom
 * `reorderMedia()` in `app/lib/game-media.ts` uses to turn one bound array into
 * an ordered relation. `WITH ORDINALITY` also preserves the caller's entry
 * order, so results zip back against the request without a client-side sort.
 *
 * ONE STATEMENT PER MUTATION, forced by the driver: `neon()` is SQL-over-HTTP
 * with one stateless request per call, so a transaction cannot span two of them.
 * Reading "was it already unlocked?" and then writing would be two requests with
 * a real TOCTOU window in between — and the window is not theoretical here,
 * because a beacon-shaped API means the same player is frequently mid-flight on
 * two calls at once. The pre-update state is captured in a CTE (`before`) that
 * shares the statement's snapshot, and joined to the write's `RETURNING`.
 *
 * PROGRESS IS ABSOLUTE, NEVER A DELTA. The SDK reports "the player is at 57",
 * not "add 3", and the upsert takes `GREATEST(existing, incoming)`. That single
 * choice is what makes a beacon safe to retry: duplicated, out-of-order and
 * replayed calls are all idempotent, and a counter can neither double-count nor
 * walk backwards. A delta API cannot have that property at all without an
 * exactly-once transport, which a `sendBeacon` from a game iframe is not.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  ACHIEVEMENT_PLAYER_RATE_LIMIT,
  MAX_ACHIEVEMENTS_PER_GAME,
  MAX_BATCH_SIZE,
  isAchievementKey,
  type UnlockReason,
} from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/**
 * What a not-yet-earned secret achievement is called on the client.
 *
 * A placeholder rather than omission: the player should see that there IS
 * something left to find — that is the entire point of a secret achievement —
 * without being told what it is.
 */
const SECRET_NAME = "Secret achievement";

/** Default page size for the profile's "recently earned" strip. */
const DEFAULT_EARNED_LIMIT = 50;

/**
 * Hard ceiling on `earnedForPlayer`. Unlike a game's catalogue (bounded by
 * `MAX_ACHIEVEMENTS_PER_GAME`), a player's earned list spans every game and so
 * has no natural bound — a caller passing `limit: 1e6` would otherwise turn a
 * profile render into a table scan.
 */
const MAX_EARNED_LIMIT = 200;

/**
 * Largest value that fits `player_achievements.progress` (INTEGER).
 *
 * Clamping in JS is not paranoia: a game reporting `Number.MAX_SAFE_INTEGER`
 * (or a float that rounds past 2^31) makes Postgres raise 22003 for the whole
 * statement, which turns one game's arithmetic bug into a failed batch for every
 * other entry in it. Clamping degrades that to a meaningless-but-harmless number.
 */
const MAX_PROGRESS = 2_147_483_647;

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

/** One provisioned achievement, unredacted — admin surfaces only. */
export type AchievementDef = {
  id: number;
  slug: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  /** `> 1` makes this a progress achievement; `1` is a plain unlock. */
  target: number;
  secret: boolean;
  position: number;
};

/**
 * One achievement as seen BY a player — the shape that ships to the browser.
 *
 * Deliberately has no `id`: the numeric primary key is an implementation detail
 * of the catalogue, and `key` is the only identifier a game or a client ever
 * needs. Keeping it out means no client surface can grow a dependency on it,
 * the same reasoning that keeps `players.id` out of `PublicProfile`.
 */
export type PlayerAchievement = {
  key: string;
  /** Redacted to {@link SECRET_NAME} while a secret achievement is unearned. */
  name: string;
  /** Redacted to `""` while a secret achievement is unearned. */
  description: string;
  icon: string;
  points: number;
  target: number;
  secret: boolean;
  /** Absolute, clamped to `target` for display so a bar cannot overfill. */
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
};

/** An earned achievement across all games, for the profile page. */
export type EarnedAchievement = {
  /** Included so the caller can link to `/game/<slug>` without a second read. */
  slug: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  unlockedAt: string;
};

/** Per-entry outcome of one {@link createAchievementStore.record} call. */
export type UnlockResult = {
  key: string;
  /**
   * NEWLY earned by THIS call. This is the toast signal, so it must be exactly
   * right: it is true only when the achievement was unearned before the
   * statement ran AND is earned after it.
   */
  unlocked: boolean;
  /** Held before this call — the caller should stay silent. */
  alreadyUnlocked: boolean;
  /** Absolute progress after the write. */
  progress: number;
  target: number;
};

export function createAchievementStore(sql: Sql) {
  function mapDef(row: Row): AchievementDef {
    return {
      id: toInt(row.id),
      slug: String(row.slug),
      key: String(row.key),
      name: String(row.name),
      description: row.description == null ? "" : String(row.description),
      icon: row.icon == null ? "🏅" : String(row.icon),
      points: toInt(row.points),
      target: Math.max(1, toInt(row.target)),
      secret: Boolean(row.secret),
      position: toInt(row.position),
    };
  }

  /**
   * Map a catalogue row joined to a player's row, REDACTING unearned secrets.
   *
   * The redaction lives here, in JS, rather than as a `CASE` in the query, for
   * one reason: every read path in this file funnels through this function, so
   * one implementation covers all of them and a future read cannot forget it.
   * A DB-side `CASE` would also be untestable through the fake-`sql` seam — the
   * fake returns canned rows and never evaluates SQL — and an untested privacy
   * control is one that silently stops working.
   *
   * Points are NOT redacted, deliberately. Hiding them would be theatre: the
   * page already shows the total, so a player can recover any single value by
   * subtraction. The count and the weight are not the secret; the NAME is.
   */
  function mapPlayerAchievement(row: Row): PlayerAchievement {
    const unlockedAt = toIsoOrNull(row.unlocked_at);
    const unlocked = unlockedAt !== null;
    const secret = Boolean(row.secret);
    const hide = secret && !unlocked;
    const target = Math.max(1, toInt(row.target));
    return {
      key: String(row.key),
      name: hide ? SECRET_NAME : String(row.name),
      description: hide
        ? ""
        : row.description == null
          ? ""
          : String(row.description),
      icon: row.icon == null ? "🏅" : String(row.icon),
      points: toInt(row.points),
      target,
      secret,
      // Clamped for display only. The stored value can exceed `target` (a game
      // may report 120 kills against a target of 100, and an admin may later
      // LOWER a target under players who already passed it); a progress bar
      // rendered from an unclamped number overflows its track.
      progress: Math.min(target, Math.max(0, toInt(row.progress))),
      unlocked,
      unlockedAt,
    };
  }

  return {
    /**
     * Every provisioned achievement for one game, in display order.
     *
     * `LIMIT MAX_ACHIEVEMENTS_PER_GAME` is a read-side backstop, not the
     * enforcement point — provisioning enforces the cap. It is here because the
     * database has no CHECK that can count sibling rows, so a bad import or a
     * hand-run INSERT could exceed it, and the store page must stay a bounded
     * render either way.
     */
    async catalogue(slug: string): Promise<AchievementDef[]> {
      const rows = await sql`
        SELECT id, slug, key, name, description, icon, points, target, secret, position
        FROM achievements
        WHERE slug = ${slug}
        ORDER BY position ASC, id ASC
        LIMIT ${MAX_ACHIEVEMENTS_PER_GAME}
      `;
      return rows.map(mapDef);
    },

    /**
     * One game's achievements as seen by one player (or by nobody), plus the
     * points split — in ONE query.
     *
     * `playerId` may be null, and it is bound as a NULL PARAMETER rather than
     * branched into a second template. That works because `pa.player_id = NULL`
     * evaluates to NULL, never true, so the LEFT JOIN keeps every catalogue row
     * with all-NULL player columns — which decodes to exactly "locked, progress
     * 0", the signed-out view. No fragment is spliced and no branch can drift
     * from the other, which is why this differs from `selectTopRows`: there the
     * two shapes are different SQL, here they are the same SQL with a different
     * value.
     *
     * Both totals are summed in JS from rows that were fetched anyway, rather
     * than as window functions, because the alternative buys nothing: the row
     * set is already bounded and already in memory.
     */
    async forPlayer(
      slug: string,
      playerId: string | null,
    ): Promise<{
      achievements: PlayerAchievement[];
      earnedPoints: number;
      totalPoints: number;
    }> {
      const rows = await sql`
        SELECT a.key, a.name, a.description, a.icon, a.points, a.target, a.secret,
               COALESCE(pa.progress, 0)::int AS progress,
               pa.unlocked_at
        FROM achievements a
        LEFT JOIN player_achievements pa
          ON pa.achievement_id = a.id AND pa.player_id = ${playerId}
        WHERE a.slug = ${slug}
        ORDER BY a.position ASC, a.id ASC
        LIMIT ${MAX_ACHIEVEMENTS_PER_GAME}
      `;

      const achievements = rows.map(mapPlayerAchievement);
      let earnedPoints = 0;
      let totalPoints = 0;
      for (const achievement of achievements) {
        totalPoints += achievement.points;
        if (achievement.unlocked) earnedPoints += achievement.points;
      }
      return { achievements, earnedPoints, totalPoints };
    },

    /**
     * Everything one player has EARNED, across every game, newest first.
     *
     * No redaction branch: an earned secret is no longer a secret, and the
     * `unlocked_at IS NOT NULL` predicate means an unearned one cannot appear
     * here at all. That is why this read can join the catalogue's `name`
     * straight through where {@link forPlayer} cannot.
     *
     * The tiebreak on `a.id` matters more than it looks: a batch unlock stamps
     * several rows with the SAME `now()` (one statement, one transaction
     * timestamp), so ordering on `unlocked_at` alone is non-deterministic
     * exactly when a player earns a cluster — the case most likely to be
     * screenshotted.
     */
    async earnedForPlayer(
      playerId: string,
      limit: number = DEFAULT_EARNED_LIMIT,
    ): Promise<EarnedAchievement[]> {
      const capped = Math.min(
        MAX_EARNED_LIMIT,
        Math.max(1, Math.floor(Number(limit) || DEFAULT_EARNED_LIMIT)),
      );
      const rows = await sql`
        SELECT a.slug, a.key, a.name, a.description, a.icon, a.points, pa.unlocked_at
        FROM player_achievements pa
        JOIN achievements a ON a.id = pa.achievement_id
        WHERE pa.player_id = ${playerId} AND pa.unlocked_at IS NOT NULL
        ORDER BY pa.unlocked_at DESC, a.id DESC
        LIMIT ${capped}
      `;
      return rows.map((row) => ({
        slug: String(row.slug),
        key: String(row.key),
        name: String(row.name),
        description: row.description == null ? "" : String(row.description),
        icon: row.icon == null ? "🏅" : String(row.icon),
        points: toInt(row.points),
        unlockedAt: toIso(row.unlocked_at),
      }));
    },

    /**
     * Total earned points, all games.
     *
     * Feeds `badges.ts`, which otherwise derives everything from rows it can see
     * for itself. This is the one input it cannot derive — see the migration's
     * header for why game achievements are the single justified exception to the
     * "badges are derived, never stored" rule — so it arrives as a scalar rather
     * than as a stored badge.
     */
    async pointsForPlayer(playerId: string): Promise<number> {
      const rows = await sql`
        SELECT COALESCE(sum(a.points), 0)::int AS points
        FROM player_achievements pa
        JOIN achievements a ON a.id = pa.achievement_id
        WHERE pa.player_id = ${playerId} AND pa.unlocked_at IS NOT NULL
      `;
      return toInt((rows[0] ?? {}).points);
    },

    /**
     * `key -> percentage of this game's players who earned it`, 0-100, rounded.
     *
     * THE DENOMINATOR IS THE INTERESTING DECISION. It is "distinct players with
     * ANY row for this game's achievements" — i.e. everyone who has ever made
     * progress here — not "players who launched the game" (nothing records
     * that reliably for embedded games) and not "players who earned at least one
     * achievement" (which would make every rarity a fraction of the successful,
     * so the hardest achievement in a game could read 100%).
     *
     * Divide-by-zero is handled INSIDE the CASE rather than by skipping the row:
     * a brand-new game must return `0` for every key so the caller can render
     * "0% of players" instead of a hole in the list. Postgres would raise 22012
     * for `x / 0`, which would 500 the store page on the day a game ships — the
     * exact moment the denominator is guaranteed to be zero.
     */
    async rarity(slug: string): Promise<Record<string, number>> {
      const rows = await sql`
        WITH game AS (
          SELECT id, key, position FROM achievements WHERE slug = ${slug}
        ),
        denom AS (
          SELECT count(DISTINCT pa.player_id) AS n
          FROM player_achievements pa
          WHERE pa.achievement_id IN (SELECT id FROM game)
        )
        SELECT g.key,
               CASE
                 WHEN (SELECT n FROM denom) = 0 THEN 0
                 ELSE round(
                   100.0 * (
                     SELECT count(DISTINCT pa2.player_id)
                     FROM player_achievements pa2
                     WHERE pa2.achievement_id = g.id AND pa2.unlocked_at IS NOT NULL
                   ) / (SELECT n FROM denom)
                 )::int
               END AS pct
        FROM game g
        ORDER BY g.position ASC, g.id ASC
      `;
      const out: Record<string, number> = {};
      for (const row of rows) {
        out[String(row.key)] = Math.min(100, Math.max(0, toInt(row.pct)));
      }
      return out;
    },

    /**
     * Record a batch of unlocks/progress for one player — ONE statement.
     *
     * This is the hard part and the whole reason this file exists. The CTEs, in
     * the order they matter:
     *
     *   input    — the batch, zipped from two bound arrays by `unnest(...)
     *              WITH ORDINALITY`. NEVER a spliced `VALUES` list.
     *   recent   — the per-player rate limit, counted over
     *              `player_achievements.updated_at`. PER PLAYER, NEVER PER IP: a
     *              school NATs its whole network to one address. Note it counts
     *              ROWS TOUCHED, not calls — which is the right unit, because a
     *              20-entry batch costs twenty times what a one-entry batch does.
     *   resolved — keys to ids via the `(slug, key)` unique index. An unmatched
     *              key simply produces no row, which is what makes an unknown key
     *              a harmless no-op instead of an error. `COALESCE(i.progress,
     *              a.target)` is where "unlock with no number" becomes "reach the
     *              target": a bare `unlock("first-blood")` must EARN the thing,
     *              and the target is the only place that number can come from.
     *   before   — the pre-update state, read in the SAME SNAPSHOT as the write.
     *              This is what makes `unlocked` (newly earned) reportable at
     *              all. `RETURNING` cannot answer it: it hands back the row
     *              AFTER the upsert, by which point "already earned" and "just
     *              earned" look identical.
     *   ins      — the upsert.
     *
     * Two clauses in the `DO UPDATE` are load-bearing and must not be
     * "simplified":
     *
     *   `progress = GREATEST(player_achievements.progress, EXCLUDED.progress)`
     *   makes a retried, duplicated or out-of-order beacon incapable of
     *   regressing a counter. `before` cannot cover this, because the live row
     *   the conflict resolves against may be NEWER than this statement's
     *   snapshot when two of the player's calls overlap.
     *
     *   `unlocked_at = COALESCE(player_achievements.unlocked_at, EXCLUDED.unlocked_at)`
     *   never re-stamps something already earned. Without the COALESCE, every
     *   later progress beacon would move the timestamp, and "recently earned"
     *   ordering on the profile would silently reshuffle itself forever — a bug
     *   with no error, no log line, and no obvious cause.
     *
     * The stamp is computed in the INSERT's source, from `resolved` joined to
     * `before`, so it accounts for progress the player ALREADY had. Computing it
     * from the incoming value alone would miss the case where an admin lowers a
     * target under players who are already past it; computing it in the
     * `DO UPDATE` would need a sub-SELECT back into `achievements` to find the
     * target, which is exactly the kind of clever that breaks quietly.
     */
    async record(input: {
      slug: string;
      /**
       * Nullable on purpose. The route checks the session too, but typing this
       * as `string` would make a forgotten check fail as a foreign-key violation
       * (a 500 the player reads as "the game is broken") instead of as a clean
       * `signed-out`. One place owns the whole reason enumeration.
       */
      playerId: string | null;
      entries: { key: string; progress?: number | null }[];
    }): Promise<{ ok: boolean; reason?: UnlockReason; results: UnlockResult[] }> {
      const { slug, playerId, entries } = input;

      // Achievements are inherently identity-bound: there is no anonymous row to
      // attach one to, and inventing a local-only one would create a trophy case
      // that silently evaporates when the player clears site data.
      if (!playerId) return { ok: false, reason: "signed-out", results: [] };
      if (!slug) return { ok: false, reason: "no-game", results: [] };
      if (entries.length === 0 || entries.length > MAX_BATCH_SIZE) {
        return { ok: false, reason: "bad-request", results: [] };
      }

      /**
       * DEDUPE BEFORE BINDING — this is not an optimisation, it is a
       * correctness requirement. `INSERT ... SELECT ... ON CONFLICT DO UPDATE`
       * raises 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second
       * time") if the source produces two rows with the same conflict key, so a
       * batch that mentions one key twice would fail ENTIRELY — taking every
       * other entry with it — rather than merging.
       *
       * Merge rule: a bare unlock (no `progress`) beats an explicit number,
       * because "unlock this" is the stronger statement; otherwise the larger
       * number wins, matching the absolute-progress semantics of the write.
       * Malformed keys and non-finite numbers are dropped here rather than sent,
       * since a key that cannot satisfy `ACHIEVEMENT_KEY_RE` also cannot satisfy
       * the `achievements_key_format` CHECK and so can never match a row.
       */
      const merged = new Map<string, number | null>();
      for (const entry of entries) {
        if (!isAchievementKey(entry.key)) continue;
        let incoming: number | null;
        if (entry.progress == null) {
          incoming = null;
        } else if (!Number.isFinite(entry.progress)) {
          continue;
        } else {
          incoming = Math.min(
            MAX_PROGRESS,
            Math.max(0, Math.floor(entry.progress)),
          );
        }
        if (!merged.has(entry.key)) {
          merged.set(entry.key, incoming);
          continue;
        }
        const held = merged.get(entry.key) ?? null;
        merged.set(
          entry.key,
          held === null || incoming === null
            ? null
            : Math.max(held, incoming),
        );
      }
      // Every key was malformed: the game's own bug, not a provisioning gap, so
      // it reads as `bad-request` rather than `unknown-achievement`.
      if (merged.size === 0) {
        return { ok: false, reason: "bad-request", results: [] };
      }

      const keys = [...merged.keys()];
      const progresses = [...merged.values()];

      const rows = await sql`
        WITH input AS (
          SELECT x.key, x.progress, x.ord
          FROM unnest(${keys}::text[], ${progresses}::int[])
               WITH ORDINALITY AS x(key, progress, ord)
        ),
        recent AS (
          SELECT count(*) AS n
          FROM player_achievements
          WHERE player_id = ${playerId}
            AND updated_at >= now() - make_interval(0,0,0,0,0,0,${ACHIEVEMENT_PLAYER_RATE_LIMIT.windowSeconds})
        ),
        resolved AS (
          SELECT a.id, a.key, a.target, i.ord,
                 COALESCE(i.progress, a.target) AS incoming
          FROM input i
          JOIN achievements a ON a.slug = ${slug} AND a.key = i.key
        ),
        before AS (
          SELECT r.id,
                 COALESCE(pa.progress, 0) AS prev_progress,
                 pa.unlocked_at           AS prev_unlocked_at
          FROM resolved r
          LEFT JOIN player_achievements pa
            ON pa.achievement_id = r.id AND pa.player_id = ${playerId}
        ),
        ins AS (
          INSERT INTO player_achievements (player_id, achievement_id, progress, unlocked_at)
          SELECT ${playerId}, r.id,
                 GREATEST(r.incoming, b.prev_progress),
                 CASE
                   WHEN b.prev_unlocked_at IS NOT NULL THEN b.prev_unlocked_at
                   WHEN GREATEST(r.incoming, b.prev_progress) >= r.target THEN now()
                 END
          FROM resolved r
          JOIN before b ON b.id = r.id
          WHERE (SELECT n FROM recent) < ${ACHIEVEMENT_PLAYER_RATE_LIMIT.maxPerWindow}
          ON CONFLICT (player_id, achievement_id) DO UPDATE
            SET progress    = GREATEST(player_achievements.progress, EXCLUDED.progress),
                unlocked_at = COALESCE(player_achievements.unlocked_at, EXCLUDED.unlocked_at),
                updated_at  = now()
          RETURNING achievement_id, progress, unlocked_at
        )
        SELECT rc.n::int                                  AS recent,
               r.key                                      AS key,
               r.target::int                              AS target,
               (b.prev_unlocked_at IS NOT NULL)           AS already_unlocked,
               (w.unlocked_at IS NOT NULL)                AS unlocked,
               COALESCE(w.progress, b.prev_progress)::int AS progress
        FROM recent rc
        LEFT JOIN resolved r ON true
        LEFT JOIN before b ON b.id = r.id
        LEFT JOIN ins w ON w.achievement_id = r.id
        ORDER BY r.ord
      `;

      // `recent` is an unqualified `count(*)`, so it always yields exactly one
      // row — which is why the outer query joins OUT of it. That guarantees at
      // least one row back even when every key was unknown, and without it
      // "rate-limited" and "nothing resolved" would be indistinguishable (both
      // return zero data rows) and the caller would be told the wrong thing.
      const first: Row = rows[0] ?? {};
      if (toInt(first.recent) >= ACHIEVEMENT_PLAYER_RATE_LIMIT.maxPerWindow) {
        return { ok: false, reason: "rate-limited", results: [] };
      }

      const results: UnlockResult[] = rows
        .filter((row) => row.key != null)
        .map((row) => {
          const alreadyUnlocked = Boolean(row.already_unlocked);
          return {
            key: String(row.key),
            // NEWLY earned: earned now AND not earned before. The second half is
            // the whole point — without it every later beacon re-fires the toast.
            unlocked: Boolean(row.unlocked) && !alreadyUnlocked,
            alreadyUnlocked,
            progress: Math.max(0, toInt(row.progress)),
            target: Math.max(1, toInt(row.target)),
          };
        });

      // NOT an error, and deliberately still `ok`. A game that ships a new
      // achievement before an admin provisions it must keep working for the keys
      // that DO exist, so unknown keys are simply absent from `results` and the
      // reason is only set when there was nothing to record at all — where it is
      // a diagnostic for the developer, not a failure for the player.
      if (results.length === 0) {
        return { ok: true, reason: "unknown-achievement", results: [] };
      }
      return { ok: true, results };
    },
  };
}

export type AchievementStore = ReturnType<typeof createAchievementStore>;
