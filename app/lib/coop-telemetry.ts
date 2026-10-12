/**
 * HallPass — co-op session telemetry, shell side.
 *
 * Co-op games talk peer to peer, so the server never sees a session: it sees
 * the handshake and nothing else. The P2P SDK (running inside the game's
 * iframe) knows when a room is made, reaches two players and ends, and tells the
 * page that hosts it with a `postMessage`. `CoopTelemetry` (mounted once in the
 * root layout) feeds that message through {@link parseCoopMessage} and, when it
 * is acceptable, into PostHog as `coop_*` events. Nothing is stored in Neon.
 *
 * WHY THE SHELL AND NOT THE GAME. The shell already owns PostHog, the device's
 * analytics opt-out and the device id `game_started` uses, so co-op numbers line
 * up with plays and an opted-out device sends nothing. The SDK imports no
 * analytics library.
 *
 * WHY A WHITELIST. Any same-origin script can post this message, so every event
 * name, property name and value is checked here and anything else is dropped:
 * a game cannot use it to write arbitrary events or free text into PostHog.
 * Values are small integers or one of a fixed set of words — no names, no ids.
 *
 * The shape is mirrored by `sdk/p2p/src/telemetry.ts`; `coop-telemetry.test.ts`
 * pins the two together.
 */

/** `data.source` on every message the SDK posts. */
export const COOP_MESSAGE_SOURCE = "hallpass-p2p-telemetry";

/** SDK event name → PostHog event name. */
export const COOP_EVENTS = {
  room_created: "coop_room_created",
  session_started: "coop_session_started",
  session_ended: "coop_session_ended",
  player_joined: "coop_player_joined",
} as const;

export type CoopEventName = keyof typeof COOP_EVENTS;

/** `CloseReason` of the SDK, i.e. why a room ended. */
const END_REASONS: ReadonlySet<string> = new Set(["left", "kicked", "host-left", "timeout", "error"]);

/** A day: nothing legitimate runs longer, and it bounds a forged value. */
const MAX_DURATION_S = 24 * 3600;

type IntRange = readonly [min: number, max: number];

const PROPS: Record<CoopEventName, Record<string, IntRange | ReadonlySet<string>>> = {
  room_created: { max_players: [1, 8] },
  session_started: { players: [2, 8] },
  session_ended: { duration_s: [0, MAX_DURATION_S], peak_players: [2, 8], reason: END_REASONS },
  player_joined: { players: [2, 8] },
};

/** Game slugs are lowercase words and hyphens (`app/lib/games.ts`). */
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface CoopCapture {
  event: (typeof COOP_EVENTS)[CoopEventName];
  props: Record<string, string | number> & { game_slug: string };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Turn a `message` event's data into the PostHog capture it stands for, or
 * `null` when it is not ours, malformed or out of range. Every property of the
 * whitelist is REQUIRED: a partial event would skew averages, so it is dropped.
 */
export function parseCoopMessage(data: unknown): CoopCapture | null {
  if (!isRecord(data) || data.source !== COOP_MESSAGE_SOURCE) return null;
  const { event, gameId, props } = data;
  if (typeof event !== "string" || !Object.hasOwn(COOP_EVENTS, event)) return null;
  if (typeof gameId !== "string" || !GAME_ID.test(gameId)) return null;
  if (!isRecord(props)) return null;

  const spec = PROPS[event as CoopEventName];
  const out: Record<string, string | number> = {};
  for (const [key, rule] of Object.entries(spec)) {
    const value = props[key];
    if (rule instanceof Set) {
      if (typeof value !== "string" || !rule.has(value)) return null;
      out[key] = value;
    } else {
      const [min, max] = rule as IntRange;
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
      out[key] = value;
    }
  }
  return {
    event: COOP_EVENTS[event as CoopEventName],
    props: { game_slug: gameId, ...out },
  };
}
