/**
 * HallPass — co-op session metrics: the numbers and the arithmetic, with no
 * database and no `server-only`, so both the query layer and the tests read one
 * set of definitions. `stats.ts` runs the queries; the events themselves come
 * from the P2P SDK via `app/lib/coop-telemetry.ts`.
 *
 * DEFINITIONS (the dashboard repeats these in words):
 *  - ROOM     a host opened a lobby (`coop_room_created`).
 *  - SESSION  a room that reached two connected players
 *             (`coop_session_started`). A lobby nobody joined is a room, not a
 *             session — the gap between the two is how many hosts wait for a
 *             friend who never comes.
 *  - LENGTH   the host's wall-clock time from the second player arriving to the
 *             room closing. Reported only when the host's page closes cleanly
 *             (`coop_session_ended`), so a crashed tab has a start and no end.
 *  - PLAYER-MINUTES  length × the most players the room held. An ESTIMATE: it
 *             assumes everyone stayed for the whole session.
 *  - DEVICES  distinct PostHog `distinct_id`s, i.e. browser profiles, not
 *             people — a school trolley shares them.
 */

export const COOP_WINDOW_DAYS = 30;

/** Share of rooms that became sessions, 0–100, or `null` with no rooms. */
export function conversionRate(rooms: number, sessions: number): number | null {
  if (rooms <= 0) return null;
  return Math.min(100, Math.round((sessions / rooms) * 100));
}

/**
 * Sessions whose end was never reported. Clamped at zero: at the window's edge
 * an end can land whose start fell before it.
 */
export function unfinishedSessions(sessions: number, ended: number): number {
  return Math.max(0, sessions - ended);
}

/** Player-minutes from summed `duration_s × peak_players` (player-seconds). */
export function playerMinutes(playerSeconds: number): number {
  return Math.round(playerSeconds / 60);
}

/** `45s`, `12m`, `1h 05m` — for a session length in seconds, or `—` when unknown. */
export function durationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
