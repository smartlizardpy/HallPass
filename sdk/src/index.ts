/**
 * Build entry for the browser SDK — SIDE EFFECTS ONLY. tsup bundles this into a
 * single dependency-free IIFE served at `/sdk/v1/hallpass.js`.
 *
 * It interoperates with the inline stub that game pages paste before this script
 * (see sdk/README.md). The stub pre-creates `window.HallPass` (alias `window.HP`)
 * with `version: "0"`, `mode: "loading"`, and a queue `_q` of pending calls
 * shaped `{ n, a, r }`. If no real SDK arrives within 2s the stub flips itself to
 * `inert` and settles the queue. This module is the "real SDK arriving":
 *
 *  1. Build the live `api` (version "1", mode "live").
 *  2. Swap it in for the stub at `window.HallPass` / `window.HP`.
 *  3. Replay any queued stub calls into the real api, resolving each caller's
 *     promise — and resolving a SAFE default if replay rejects.
 *  4. Emit `"ready"`.
 *
 * The entire thing runs inside one try/catch that never throws: a broken SDK
 * must never break the host game.
 */

import { resolveConfig } from "./config";
import { createClient, emit } from "./client";
import { SDK_MAJOR } from "./version";
import type { HallPass } from "./contract";

/** A queued call recorded by the inline stub. */
interface StubCall {
  n: string;
  a?: unknown[];
  r: (value: unknown) => void;
}

/** The shape of whatever currently sits at `window.HallPass` (stub or prior SDK). */
interface InstalledGlobal {
  version?: string;
  _q?: StubCall[];
}

type GlobalHolder = {
  HallPass?: InstalledGlobal;
  HP?: InstalledGlobal;
};

(function bootstrap(): void {
  try {
    if (typeof window === "undefined") return;
    const holder = window as unknown as GlobalHolder;

    const prev = holder.HallPass;

    // Already initialised by an earlier load of this exact major — do nothing.
    if (prev && prev.version === SDK_MAJOR) return;

    const cfg = resolveConfig();
    const api = createClient(cfg, emit);

    holder.HallPass = api as unknown as InstalledGlobal;
    holder.HP = api as unknown as InstalledGlobal;

    if (prev && Array.isArray(prev._q)) {
      for (const call of prev._q.slice()) {
        replay(api, call);
      }
    }

    emit("ready", {
      ready: true,
      game: cfg.game,
      handle: api.getHandle(),
      mode: api.mode,
    });
  } catch {
    // Never throw: a failed bootstrap leaves the stub in place to go inert.
  }
})();

/** Replay one queued stub call into the real api, always settling its promise. */
function replay(api: HallPass, call: StubCall): void {
  try {
    const method = (api as unknown as Record<string, unknown>)[call.n];
    if (typeof method !== "function") {
      call.r(safeDefault(call.n));
      return;
    }
    Promise.resolve(
      (method as (...args: unknown[]) => unknown).apply(api, call.a || []),
    )
      .then(call.r)
      .catch(() => settle(call, safeDefault(call.n)));
  } catch {
    settle(call, safeDefault(call.n));
  }
}

function settle(call: StubCall, value: unknown): void {
  try {
    call.r(value);
  } catch {
    // The caller's resolver itself threw — nothing more we can do safely.
  }
}

/** Safe fallback per method when replay cannot produce a real result. */
function safeDefault(name: string): unknown {
  return name === "getScores" ? [] : { ok: false, reason: "network" };
}
