/**
 * Co-op session telemetry: how many rooms are made, how many reach two
 * players, how long they last. Game traffic is peer to peer, so the HallPass
 * server cannot see any of it; the SDK can.
 *
 * The SDK imports no analytics library. It posts a small message to the page
 * that hosts the game, and the HallPass shell (`app/lib/coop-telemetry.ts`)
 * validates it against a whitelist and records it in PostHog, honouring the
 * device's analytics opt-out. Nothing identifying is sent: counts, a duration
 * and one of a fixed set of end reasons. No names, no peer ids, no room codes.
 *
 * Off on the `local` transport (development), when the game is not framed (so
 * there is no shell to hear it) and when the game passes `telemetry: false`.
 * Never throws: a failed report must not touch a game.
 */

import type { CloseReason } from "./types";

/** `data.source` of every message; mirrored by `app/lib/coop-telemetry.ts`. */
export const TELEMETRY_SOURCE = "hallpass-p2p-telemetry";

export type TelemetryEvent =
  | { event: "room_created"; props: { max_players: number } }
  | { event: "session_started"; props: { players: number } }
  | { event: "session_ended"; props: { duration_s: number; peak_players: number; reason: CloseReason } }
  | { event: "player_joined"; props: { players: number } };

export type TelemetrySink = (report: TelemetryEvent) => void;

export const noTelemetry: TelemetrySink = () => {};

/** Post reports to the framing page; a no-op when there is none. */
export function parentTelemetry(gameId: string): TelemetrySink {
  return (report) => {
    try {
      if (typeof window === "undefined" || window.parent === window) return;
      window.parent.postMessage({ source: TELEMETRY_SOURCE, gameId, ...report }, location.origin);
    } catch {
      /* Telemetry is best effort. */
    }
  };
}

/** Which sink a connection uses. */
export function chooseTelemetry(
  option: boolean | TelemetrySink | undefined,
  transport: "hallpass" | "local",
  gameId: string,
): TelemetrySink {
  if (typeof option === "function") return option;
  if (option === false || transport === "local") return noTelemetry;
  return parentTelemetry(gameId);
}
