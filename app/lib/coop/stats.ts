import "server-only";

/**
 * HallPass — co-op session metrics, read from PostHog.
 *
 * Co-op games run peer to peer, so our database cannot see a session; the P2P
 * SDK reports them through the page shell as `coop_*` events (see
 * `app/lib/coop-telemetry.ts`) and this reads them back. Deliberately no Neon
 * table: the numbers are counts and durations, and PostHog already holds them.
 *
 * PostHog is a 30-DAY window here like every analytics panel, and counts DEVICES
 * (browser profiles), not people. Definitions live in `config.ts`.
 *
 * FAIL-SOFT: each query is wrapped so one failure blanks one panel, and an
 * unconfigured key reads as `configured: false` rather than as zero sessions.
 */

import { hogqlNamed, isStatsConfigured } from "@/app/lib/stats";
import { toCount, toText } from "@/app/lib/hogql-rows";
import { fillDays } from "@/app/lib/insights";
import { COOP_WINDOW_DAYS } from "./config";

export type CoopDay = { date: string; rooms: number; sessions: number };

export type CoopGame = {
  slug: string;
  rooms: number;
  sessions: number;
  /** Mean length of sessions that reported an end, in seconds. `null` when none did. */
  avgSeconds: number | null;
};

export type CoopStats = {
  rooms: number;
  sessions: number;
  /** Sessions whose host reported a clean end. */
  ended: number;
  /** Joins by players who were not the host. */
  joins: number;
  devices: number;
  avgSeconds: number | null;
  medianSeconds: number | null;
  /** Summed `duration_s × peak_players`, in player-seconds. */
  playerSeconds: number;
  daily: CoopDay[];
  games: CoopGame[];
  configured: boolean;
};

const EMPTY: CoopStats = {
  rooms: 0,
  sessions: 0,
  ended: 0,
  joins: 0,
  devices: 0,
  avgSeconds: null,
  medianSeconds: null,
  playerSeconds: 0,
  daily: [],
  games: [],
  configured: false,
};

const TAG = "posthog-coop";
const WINDOW = `INTERVAL ${COOP_WINDOW_DAYS} DAY`;
const EVENTS = `('coop_room_created', 'coop_session_started', 'coop_session_ended', 'coop_player_joined')`;

/** A panel query that must never blank the whole page. */
function safe<T>(p: Promise<T[]>): Promise<T[]> {
  return p.catch(() => [] as T[]);
}

/** PostHog averages over no rows come back as null/NaN/0; only a real mean counts. */
function toSeconds(value: unknown, haveRows: boolean): number | null {
  if (!haveRows || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type TotalsRow = {
  rooms: unknown;
  sessions: unknown;
  ended: unknown;
  joins: unknown;
  devices: unknown;
  avg_s: unknown;
  median_s: unknown;
  player_s: unknown;
};
type DayRow = { date: unknown; rooms: unknown; sessions: unknown };
type GameRow = { slug: unknown; rooms: unknown; sessions: unknown; ended: unknown; avg_s: unknown };

export async function getCoopStats(): Promise<CoopStats> {
  if (!isStatsConfigured()) return { ...EMPTY };

  const [totals, daily, games] = await Promise.all([
    safe(
      hogqlNamed<TotalsRow>(
        `
        SELECT
          countIf(event = 'coop_room_created') AS rooms,
          countIf(event = 'coop_session_started') AS sessions,
          countIf(event = 'coop_session_ended') AS ended,
          countIf(event = 'coop_player_joined') AS joins,
          count(DISTINCT distinct_id) AS devices,
          avgIf(toFloat(properties.duration_s), event = 'coop_session_ended') AS avg_s,
          medianIf(toFloat(properties.duration_s), event = 'coop_session_ended') AS median_s,
          sumIf(toFloat(properties.duration_s) * toFloat(properties.peak_players), event = 'coop_session_ended') AS player_s
        FROM events
        WHERE event IN ${EVENTS} AND timestamp >= now() - ${WINDOW}
      `,
        TAG,
      ),
    ),
    safe(
      hogqlNamed<DayRow>(
        `
        SELECT toString(toDate(timestamp)) AS date,
               countIf(event = 'coop_room_created') AS rooms,
               countIf(event = 'coop_session_started') AS sessions
        FROM events
        WHERE event IN ('coop_room_created', 'coop_session_started')
          AND timestamp >= now() - ${WINDOW}
        GROUP BY date
        ORDER BY date ASC
      `,
        TAG,
      ),
    ),
    safe(
      hogqlNamed<GameRow>(
        `
        SELECT properties.game_slug AS slug,
               countIf(event = 'coop_room_created') AS rooms,
               countIf(event = 'coop_session_started') AS sessions,
               countIf(event = 'coop_session_ended') AS ended,
               avgIf(toFloat(properties.duration_s), event = 'coop_session_ended') AS avg_s
        FROM events
        WHERE event IN ${EVENTS} AND timestamp >= now() - ${WINDOW}
        GROUP BY slug
        ORDER BY sessions DESC, rooms DESC
        LIMIT 10
      `,
        TAG,
      ),
    ),
  ]);

  const t = totals[0];
  const ended = toCount(t?.ended);
  return {
    rooms: toCount(t?.rooms),
    sessions: toCount(t?.sessions),
    ended,
    joins: toCount(t?.joins),
    devices: toCount(t?.devices),
    avgSeconds: toSeconds(t?.avg_s, ended > 0),
    medianSeconds: toSeconds(t?.median_s, ended > 0),
    playerSeconds: toCount(t?.player_s),
    daily: fillDays(
      daily.map((r) => ({ date: toText(r.date), rooms: toCount(r.rooms), sessions: toCount(r.sessions) })),
      COOP_WINDOW_DAYS,
      new Date(),
      (date) => ({ date, rooms: 0, sessions: 0 }),
    ),
    games: games
      .filter((g) => toText(g.slug) !== "")
      .map((g) => ({
        slug: toText(g.slug),
        rooms: toCount(g.rooms),
        sessions: toCount(g.sessions),
        avgSeconds: toSeconds(g.avg_s, toCount(g.ended) > 0),
      })),
    configured: true,
  };
}
