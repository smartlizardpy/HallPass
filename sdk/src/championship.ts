/**
 * HallPass SDK — named boards, run tokens and championship outcomes (1.5.0).
 *
 * Everything here is additive to v1: a game that never passes `board`, never
 * calls `runStart` and never asks `supports()` behaves exactly as on 1.4.
 *
 * WHY THE PARENT IS TOLD. A game may submit and move on without reading the
 * result (Last Bell does). For a championship that is not good enough: a
 * signed-out player would believe a run counted. So on HallPass's own origin
 * the SDK also posts the outcome to the page hosting the game, which shows it
 * in HallPass's own words. Same-origin only, and addressed to that origin, so
 * nothing leaves HallPass.
 */

import { isSameOrigin } from "./challenge";
import type { ChampionshipReason, ChampionshipSignal } from "./contract";

/** Features `supports()` answers `true` for. Append-only. */
export const FEATURES: readonly string[] = ["leaderboard.boards", "leaderboard.meta", "runs"];

/** The same answer as an object, for games that feature-detect by property. */
export const CAPABILITIES = Object.freeze({
  leaderboard: Object.freeze({ boards: true, meta: true }),
  runs: true,
});

export function supports(feature: unknown): boolean {
  return typeof feature === "string" && FEATURES.includes(feature);
}

const BOARD_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** A valid board id, or `null`. */
export function boardId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return BOARD_RE.test(v) ? v : null;
}

/** The largest `meta` the SDK will send (JSON characters). The server enforces its own limit too. */
export const META_MAX = 4096;

/** A small plain object to send as `meta`, or `undefined` to send none. */
export function boundMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  try {
    const json = JSON.stringify(meta);
    return json.length <= META_MAX ? (JSON.parse(json) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const REASONS: ReadonlySet<string> = new Set<ChampionshipReason>([
  "signed-out",
  "closed",
  "no-run",
  "expired",
  "rejected",
  "rate-limited",
  "unavailable",
]);

/** The championship reason in an error body, if it is one. */
export function championshipReason(data: unknown): ChampionshipReason | null {
  const r = data && typeof data === "object" ? (data as { reason?: unknown }).reason : undefined;
  return typeof r === "string" && REASONS.has(r) ? (r as ChampionshipReason) : null;
}

export const SIGNAL_TYPE = "hallpass:championship";

/**
 * Tell the HallPass page hosting this game what happened. Only when the game
 * runs on the API's own origin inside a frame; addressed to that origin.
 * Never throws.
 */
export function signalParent(api: string, signal: Omit<ChampionshipSignal, "type">): void {
  try {
    if (typeof window === "undefined" || window.parent === window || !isSameOrigin(api)) return;
    const message: ChampionshipSignal = { type: SIGNAL_TYPE, ...signal };
    window.parent.postMessage(message, new URL(api).origin);
  } catch {
    // A sandboxed or detached frame: the game still has the result itself.
  }
}
