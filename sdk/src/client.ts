/**
 * The live HallPass client — the real implementation of the `HallPass` interface
 * that `index.ts` installs at `window.HallPass`.
 *
 * Golden rule everywhere: every public method RESOLVES and NONE THROW. Each one
 * is wrapped so that a storage/network/serialisation failure degrades to a safe
 * value (`getScores → []`, `submitScore → { ok: false, reason: ... }`).
 *
 * Event model: there is exactly one SDK instance per page, so a single
 * module-level registry backs `on`/`off`. `emit` is exported so `index.ts` can
 * fire the `"ready"` event through the same registry, and is also passed into
 * `createClient` (defaulting to the exported one) so tests can observe events
 * with a spy.
 */

import type {
  EventName,
  GetScoresOptions,
  HallPass,
  LeaderboardResponse,
  Mode,
  ReadyState,
  ScoreEntry,
  SubmitOptions,
  SubmitResponse,
  SubmitResult,
} from "./contract";
import type { ResolvedConfig } from "./config";
import { ensureHandle, getHandle, setHandle } from "./handle";
import { getJSON, postJSON } from "./transport";
import { SDK_MAJOR } from "./version";

/** Event dispatcher signature. */
export type Emit = (event: EventName, payload: unknown) => void;

type Listener = (payload: unknown) => void;

/** Single-instance event registry shared by `on`/`off` and `emit`. */
const registry: Partial<Record<EventName, Listener[]>> = {};

/**
 * Last `"ready"` payload, cached so the one-shot `"ready"` event is STICKY: a
 * listener attached after bootstrap (via `on("ready", cb)`) is invoked
 * immediately with this value instead of missing the single emit.
 */
let lastReady: unknown;

/** Dispatch `payload` to every listener of `event`. Never throws. */
export function emit(event: EventName, payload: unknown): void {
  if (event === "ready") lastReady = payload;
  const listeners = registry[event];
  if (!listeners || !listeners.length) return;
  for (const cb of listeners.slice()) {
    try {
      cb(payload);
    } catch {
      // A misbehaving listener must never break the SDK.
    }
  }
}

/**
 * Build the live API object bound to a resolved config.
 * @param cfg   Resolved `{ game, api }`.
 * @param emitEvent Event sink (defaults to the module `emit`; overridable for tests).
 */
export function createClient(cfg: ResolvedConfig, emitEvent: Emit = emit): HallPass {
  // "inert" only when this environment has no usable fetch (e.g. a sandboxed
  // preview); otherwise "live". A reachable-but-failing network is NOT inert —
  // that surfaces as the "network" reason on individual calls.
  const mode: Mode = typeof fetch === "undefined" ? "inert" : "live";

  function leaderboardUrl(game: string): string {
    return cfg.api + "/api/v1/leaderboard/" + encodeURIComponent(game);
  }

  async function ready(opts?: { game?: string; api?: string }): Promise<ReadyState> {
    try {
      if (opts && typeof opts.game === "string" && opts.game.trim()) {
        cfg.game = opts.game.trim();
      }
      if (opts && typeof opts.api === "string" && opts.api.trim()) {
        cfg.api = opts.api.trim().replace(/\/+$/, "");
      }
      return {
        ready: true,
        game: cfg.game,
        handle: getHandle(),
        mode: api.mode,
      };
    } catch {
      return { ready: true, game: cfg.game, handle: null, mode: api.mode };
    }
  }

  async function submitScore(
    score: number,
    opts?: SubmitOptions,
  ): Promise<SubmitResult> {
    try {
      if (typeof score !== "number" || !isFinite(score)) {
        return fail("bad-score");
      }
      const game = cfg.game;
      if (!game) {
        return fail("no-game");
      }

      const handle = ensureHandle({
        handle: opts?.handle,
        promptHandle: opts?.promptHandle,
      });

      const res = await postJSON(leaderboardUrl(game), { score, handle });

      if (res.ok) {
        const body = res.data as Partial<SubmitResponse> | undefined;
        const rank = typeof body?.rank === "number" ? body.rank : undefined;
        const result: SubmitResult = { ok: true, rank };
        emitEvent("submitted", result);
        return result;
      }
      if (res.status === 429) {
        return fail("rate-limited", res.error);
      }
      if (res.status === 0) {
        return fail(
          api.mode === "inert" || res.error === "fetch unavailable"
            ? "inert"
            : "network",
          res.error,
        );
      }
      return fail("http", res.error);
    } catch {
      return fail("network");
    }

    function fail(reason: SubmitResult["reason"], error?: string): SubmitResult {
      const result: SubmitResult = { ok: false, reason };
      if (error) result.error = error;
      emitEvent("error", result);
      return result;
    }
  }

  async function getScores(opts?: GetScoresOptions): Promise<ScoreEntry[]> {
    try {
      const game = (opts && opts.game && opts.game.trim()) || cfg.game;
      if (!game) {
        emitEvent("scores", []);
        return [];
      }

      const limit = clampLimit(opts?.limit);
      const period = opts?.period ?? "all";
      const url =
        leaderboardUrl(game) +
        "?limit=" +
        limit +
        "&period=" +
        encodeURIComponent(period);

      const res = await getJSON(url);
      const scores = res.ok ? extractScores(res.data) : [];
      emitEvent("scores", scores);
      return scores;
    } catch {
      emitEvent("scores", []);
      return [];
    }
  }

  const api: HallPass = {
    version: SDK_MAJOR,
    mode,
    ready,
    submitScore,
    getScores,
    getHandle: () => getHandle(),
    setHandle: (handle: string) => setHandle(handle),
    on(event: EventName, cb: (payload: unknown) => void): HallPass {
      try {
        if (typeof cb === "function") {
          (registry[event] || (registry[event] = [])).push(cb);
          // "ready" is sticky: a listener added after bootstrap still gets it.
          if (event === "ready" && lastReady !== undefined) {
            try {
              cb(lastReady);
            } catch {
              // A misbehaving listener must never break the SDK.
            }
          }
        }
      } catch {
        // ignore
      }
      return api;
    },
    off(event: EventName, cb: (payload: unknown) => void): HallPass {
      try {
        const listeners = registry[event];
        if (listeners) {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        }
      } catch {
        // ignore
      }
      return api;
    },
  };

  return api;
}

/** Clamp a requested limit into 1..100, default 10. */
function clampLimit(limit: unknown): number {
  if (typeof limit === "number" && isFinite(limit)) {
    const n = Math.floor(limit);
    if (n < 1) return 1;
    if (n > 100) return 100;
    return n;
  }
  return 10;
}

/** Pull a validated `ScoreEntry[]` out of a leaderboard response body. */
function extractScores(data: unknown): ScoreEntry[] {
  const body = data as Partial<LeaderboardResponse> | undefined;
  const scores = body?.scores;
  if (Array.isArray(scores)) {
    return scores.filter(isScoreEntry);
  }
  return [];
}

function isScoreEntry(value: unknown): value is ScoreEntry {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ScoreEntry).rank === "number" &&
    typeof (value as ScoreEntry).handle === "string" &&
    typeof (value as ScoreEntry).score === "number"
  );
}
