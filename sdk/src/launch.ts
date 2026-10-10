/**
 * The launch handoff: how a game learns it was opened from an invite.
 *
 * Shared by BOTH sides, which is why it is a pure SDK module (the app may import
 * pure SDK modules; the SDK never imports app code):
 *
 *  - the landing page `/i/<code>` calls {@link writeLaunch} immediately before it
 *    mounts the game, and {@link clearLaunch} when the game closes;
 *  - the SDK calls {@link takeLaunch} once, when it loads inside the game, and
 *    serves the result from memory through `HallPass.getLaunch()`.
 *
 * ── WHY sessionStorage ─────────────────────────────────────────────────────
 * The game cannot get it from its URL: `/game-html/<slug>/` 307s to
 * `/games/<slug>/index.html` and the overlay never forwards a query string. But
 * the game frame is SAME-ORIGIN with the page that mounts it (a hosted game, or
 * a staged one proxied in place), and `sessionStorage` is per origin AND per
 * top-level browsing context — a same-origin iframe reads the exact storage
 * area its parent wrote. It also dies with the tab, so an invite opened on a
 * shared school computer cannot follow the next pupil into their game, which
 * `localStorage` would allow.
 *
 * A cross-origin (externally hosted) game reads a different origin's storage
 * and gets `null`. That is documented, not worked around.
 *
 * ── READ ONCE, BY THE RIGHT GAME ───────────────────────────────────────────
 * The key carries the slug, so a different game opened in the same tab later
 * cannot pick the invite up, and {@link takeLaunch} REMOVES the entry as it
 * reads it, so a reload of the game does not rejoin a room it already left.
 * Expired or malformed entries are ignored (and removed).
 *
 * Every function is guarded and never throws: storage can be disabled, full,
 * or throw on access in a sandbox.
 */

import type { LaunchInfo } from "./contract";

/** `sessionStorage` key prefix; the slug follows. Pinned: the app writes it. */
export const LAUNCH_KEY_PREFIX = "hallpass:launch:";

/** Mirrors `MAX_INVITE_DATA_BYTES` in `app/lib/invites/data.ts` (the server is the authority). */
export const MAX_LAUNCH_DATA_BYTES = 1024;

/** What is stored. `v` lets a later SDK change the shape without misreading this one. */
interface StoredLaunch {
  v: 1;
  kind: "invite";
  data: Record<string, unknown>;
  from: string | null;
  expiresAt: number;
}

/** The storage key for a game. */
export function launchKey(slug: string): string {
  return LAUNCH_KEY_PREFIX + slug;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    // Accessing sessionStorage throws when storage is blocked.
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validate a parsed entry into a {@link LaunchInfo}, or `null`. `now` is
 * injectable for tests. The data is re-parsed from JSON so the caller always
 * gets a fresh, plain copy.
 */
export function parseLaunch(value: unknown, now: number = Date.now()): LaunchInfo | null {
  try {
    if (!isPlainObject(value)) return null;
    if (value.v !== 1 || value.kind !== "invite") return null;
    if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return null;
    if (value.expiresAt <= now) return null;
    if (!isPlainObject(value.data)) return null;
    const json = JSON.stringify(value.data);
    if (json.length > MAX_LAUNCH_DATA_BYTES * 4) return null;
    const from = typeof value.from === "string" && value.from.trim() ? value.from.slice(0, 64) : null;
    return {
      kind: "invite",
      data: JSON.parse(json) as Record<string, unknown>,
      from,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Hand an invite to the game about to be mounted in this tab. Returns whether
 * it was stored. Called by the landing page, never by a game.
 */
export function writeLaunch(
  slug: string,
  launch: { data: Record<string, unknown>; from: string | null; expiresAt: number },
): boolean {
  try {
    const store = storage();
    if (!store || !slug) return false;
    const entry: StoredLaunch = {
      v: 1,
      kind: "invite",
      data: launch.data,
      from: launch.from,
      expiresAt: launch.expiresAt,
    };
    store.setItem(launchKey(slug), JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

/** Remove any pending launch for a game. Never throws. */
export function clearLaunch(slug: string): void {
  try {
    storage()?.removeItem(launchKey(slug));
  } catch {
    // Nothing to remove, or storage is blocked.
  }
}

/**
 * Read AND REMOVE the pending launch for `slug`: the invite data, once per page
 * load. `null` when there is none, it expired, it is malformed, or storage is
 * unavailable.
 */
export function takeLaunch(slug: string | null, now: number = Date.now()): LaunchInfo | null {
  try {
    if (!slug) return null;
    const store = storage();
    if (!store) return null;
    const key = launchKey(slug);
    const raw = store.getItem(key);
    if (raw === null) return null;
    store.removeItem(key);
    return parseLaunch(JSON.parse(raw), now);
  } catch {
    return null;
  }
}

/**
 * The game's slug from the frame's own path, for a game that loads the SDK
 * without `data-game`: `/games/<slug>/…` (hosted) or `/game-html/<slug>/…`
 * (staged, proxied in place). `null` anywhere else.
 */
export function slugFromPath(pathname: string): string | null {
  try {
    const match = /^\/(?:games|game-html)\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
