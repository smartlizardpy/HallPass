/**
 * HallPass — the server-side streak store.
 *
 * A `createStreakStore(sql)` factory, like `social/store.ts` and
 * `notifications/store.ts`, so the SQL can be exercised against a fake tagged
 * template. It is free of `server-only` for that reason; `index.ts` binds it to
 * the real connection.
 *
 * ONE STATEMENT PER MUTATION. The Neon HTTP driver has no cross-statement
 * transactions, so the advance rule from `server-core.ts` is a single upsert and
 * the nudge claim is a single conditional update. Interpolated values are bound
 * parameters; nothing here splices a SQL fragment.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { REMINDER_HOUR, REMINDER_MIN_STREAK } from "./server-core";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const toInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export type RecordedDay =
  | { advanced: true; current: number; longest: number }
  | { advanced: false };

/** One player who is due a reminder, as the "who is due" query reports them. */
export type DuePlayer = {
  playerId: string;
  current: number;
  /** The player's own calendar day right now, `YYYY-MM-DD`. */
  localDay: string;
};

export function createStreakStore(sql: Sql) {
  /**
   * Report that `playerId` played on `day` (their own calendar day).
   *
   * The `WHERE` on the conflict branch is what makes a repeat or an older day a
   * no-op: the row is simply not touched, so `RETURNING` is empty and the caller
   * learns the streak did not advance. Otherwise the next day grows the run and
   * anything later restarts it — `server-core.ts#applyDay`, in SQL. Every SET
   * expression reads the OLD row, which is why the run expression is repeated
   * rather than referenced.
   */
  async function recordDay(
    playerId: string,
    day: string,
    tzOffsetMin: number,
  ): Promise<RecordedDay> {
    const rows = await sql`
      INSERT INTO player_streaks (player_id, current_streak, longest_streak, last_day, tz_offset_min)
      VALUES (${playerId}, 1, 1, ${day}::date, ${tzOffsetMin})
      ON CONFLICT (player_id) DO UPDATE SET
        current_streak = CASE
          WHEN ${day}::date = player_streaks.last_day + 1
          THEN player_streaks.current_streak + 1 ELSE 1 END,
        longest_streak = GREATEST(player_streaks.longest_streak, CASE
          WHEN ${day}::date = player_streaks.last_day + 1
          THEN player_streaks.current_streak + 1 ELSE 1 END),
        last_day = ${day}::date,
        tz_offset_min = ${tzOffsetMin},
        updated_at = now()
      WHERE ${day}::date > player_streaks.last_day
      RETURNING current_streak, longest_streak
    `;
    const row = rows[0] as Row | undefined;
    if (!row) return { advanced: false };
    return {
      advanced: true,
      current: toInt(row.current_streak),
      longest: toInt(row.longest_streak),
    };
  }

  /**
   * Players due a streak-at-risk reminder at `now`, at most `limit`.
   *
   * The same rule as `server-core.ts#isNudgeDue`, in SQL so the cap applies to
   * players who are really due rather than to a scan the filter then thins. The
   * local time is `now` shifted by each player's own offset. A player with no
   * push subscription is not selected: a bell-only nudge would have to be opened
   * on the site to be seen, which is what it exists to prompt.
   */
  async function dueForReminder(now: Date, limit: number): Promise<DuePlayer[]> {
    const rows = await sql`
      WITH cand AS (
        SELECT s.player_id, s.current_streak, s.last_day, s.last_nudged_day,
          ((${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
            + make_interval(mins => s.tz_offset_min::int)) AS local_now
        FROM player_streaks s
        WHERE s.current_streak >= ${REMINDER_MIN_STREAK}
          AND s.last_day >= ((${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date - 2)
      )
      SELECT c.player_id, c.current_streak, (c.local_now::date)::text AS local_day
      FROM cand c
      WHERE c.last_day = c.local_now::date - 1
        AND extract(hour FROM c.local_now) = ${REMINDER_HOUR}
        AND (c.last_nudged_day IS NULL OR c.last_nudged_day <> c.local_now::date)
        AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.player_id = c.player_id)
      ORDER BY c.player_id
      LIMIT ${limit}
    `;
    return rows.map((row: Row) => ({
      playerId: String(row.player_id),
      current: toInt(row.current_streak),
      localDay: String(row.local_day),
    }));
  }

  /**
   * Claim today's reminder for a player. True means THIS call claimed it and
   * should send; false means somebody (an overlapping run) already did.
   *
   * Claimed BEFORE sending, so a failure costs one missed nudge rather than a
   * repeat: for a reminder, twice is worse than never.
   */
  async function claimNudge(playerId: string, localDay: string): Promise<boolean> {
    const rows = await sql`
      UPDATE player_streaks
      SET last_nudged_day = ${localDay}::date
      WHERE player_id = ${playerId}
        AND last_nudged_day IS DISTINCT FROM ${localDay}::date
      RETURNING 1 AS claimed
    `;
    return rows.length > 0;
  }

  return { recordDay, dueForReminder, claimNudge };
}

export type StreakStore = ReturnType<typeof createStreakStore>;
