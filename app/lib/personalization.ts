"use client";

/**
 * HallPass — client-side personalization (favorites + recently played).
 *
 * This is the BROWSER-ONLY counterpart to the server `favorites.ts` layer. It
 * keeps two per-device lists in `localStorage` and exposes them to React through
 * `useSyncExternalStore`, so every card and every section re-renders live the
 * instant a list changes — whether the change came from THIS tab (toggling a
 * heart), ANOTHER tab (the `storage` event), or the login-time server sync.
 *
 * Storage model (deliberately split):
 *   - RECENTLY PLAYED (`hp:recent`) is localStorage ONLY — per-device, never sent
 *     to the server. Capped at {@link RECENT_CAP}, most-recent-first, deduped.
 *   - FAVORITES (`hp:favorites`) is localStorage for EVERYONE (the floor — works
 *     for anonymous/guest players and offline) AND, for a SIGNED-IN player,
 *     mirrored to Neon via `/api/v1/me/favorites`. Local is the OPTIMISTIC TRUTH:
 *     a toggle writes localStorage + emits instantly and fires-and-forgets the
 *     server mutation; the next-load {@link useFavoritesServerSync} reconciles
 *     (union of local + server) so a guest's local favorites survive sign-in and
 *     another device's favorites appear here.
 *
 * FAIL-SOFT, the load-bearing rule of this module:
 *   Every `localStorage` read is wrapped try/catch → `[]` and guarded for SSR
 *   (`typeof window === "undefined"`), so a private-mode/quota/SSR environment
 *   degrades to "no personalization" rather than throwing into a render. Every
 *   network call is likewise swallowed — local already reflects the user's intent.
 *
 * `useSyncExternalStore` correctness (the subtle part):
 *   - `getServerSnapshot` returns a STABLE empty array (`EMPTY`) — the same
 *     reference every call — so the server render and the hydration render agree
 *     and the new home sections simply appear AFTER hydration with no mismatch.
 *   - `getSnapshot` returns a CACHED module-scope reference (`favSnapshot` /
 *     `recentSnapshot`) that only changes identity when the data actually changes
 *     (on a write or a `storage` event). Reading + parsing `localStorage` on every
 *     `getSnapshot` call would hand React a fresh array each time and trip its
 *     "getSnapshot should be cached" guard / infinite re-render loop.
 *
 * NO analytics here: Arcade owns PostHog (it wraps the toggle to capture
 * favorite/unfavorite). NO server-only imports (`@/app/lib/db` etc.) — this file
 * ships to the browser.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** localStorage key holding the JSON `string[]` of favorited game slugs. */
const FAVORITES_KEY = "hp:favorites";
/** localStorage key holding the JSON `string[]` of recently-played slugs. */
const RECENT_KEY = "hp:recent";
/**
 * Per-slug timestamps of the last time a play was reported to the server. Purely
 * a debounce ledger — it holds no history and is never read for display.
 */
const PLAY_SYNC_KEY = "hp:playsync";
/** Hard cap on the recently-played list (most-recent-first, older ones drop off). */
const RECENT_CAP = 12;

/**
 * The stable empty snapshot shared by every `getServerSnapshot` and by the
 * pre-hydration client state. MUST keep a constant reference — never reassign or
 * mutate it — so React sees "no change" across server → hydration.
 */
const EMPTY: readonly string[] = [];

/* -------------------------------------------------------------------------- *
 * Pure helpers — no `window`, no side effects, fully unit-testable.
 * -------------------------------------------------------------------------- */

/**
 * Tolerantly parse a stored JSON `string[]`. Returns `[]` for `null`, malformed
 * JSON, or a non-array payload; keeps only string elements so a corrupt entry can
 * never inject a non-slug value downstream. Never throws.
 */
export function readSlugs(raw: string | null): string[] {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

/** Serialize a slug list to the canonical JSON string stored in localStorage. */
export function writeSlugs(list: string[]): string {
  return JSON.stringify(list);
}

/**
 * Toggle `slug` in a favorites list: drop it when present, otherwise PREPEND it
 * (favorites are most-recent-first). Returns a NEW array; never mutates `list`.
 */
export function toggleSlug(list: string[], slug: string): string[] {
  if (list.includes(slug)) return list.filter((s) => s !== slug);
  return [slug, ...list];
}

/**
 * Prepend `slug` to a most-recent-first list: move-to-front if already present
 * (dedup), then cap at `cap`. Returns a NEW array; never mutates `list`.
 */
export function prependCapped(list: string[], slug: string, cap: number): string[] {
  return [slug, ...list.filter((s) => s !== slug)].slice(0, cap);
}

/**
 * Union of two slug lists preserving order, `local` first then any `server` slugs
 * not already present. Used at login to merge the device's guest favorites with
 * the server's stored favorites. De-dupes; returns a new array.
 */
export function mergeSlugs(local: string[], server: string[]): string[] {
  const seen = new Set(local);
  const out = [...local];
  for (const s of server) {
    if (typeof s !== "string" || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Browser-guarded localStorage access (fail-soft).
 * -------------------------------------------------------------------------- */

/** Read a key, returning `null` on SSR or any storage failure. */
function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a key, silently no-op on SSR or any storage failure. */
function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — local is best-effort. */
  }
}

/* -------------------------------------------------------------------------- *
 * Module-scope store: cached snapshots + pub/sub. The cached references are what
 * make `useSyncExternalStore` legal (see the header note).
 * -------------------------------------------------------------------------- */

let favSnapshot: string[] = EMPTY as string[];
let recentSnapshot: string[] = EMPTY as string[];
/** Whether the caches have been hydrated from localStorage at least once. */
let loaded = false;
/**
 * Set true once {@link useFavoritesServerSync} confirms a signed-in session.
 * Gates whether a favorite toggle ALSO fires the server mutation; guests stay
 * local-only.
 */
let signedIn = false;
/**
 * Slugs the user EXPLICITLY unfavorited before/while {@link useFavoritesServerSync}
 * runs. The login reconciliation is a UNION of local + server, which (being
 * insert-only, like the server's `mergeFavorites`) cannot express a deletion — so
 * without this buffer an unfavorite performed during the sync window would be
 * resurrected, both in the UI (re-added by the union) and on the server (re-added
 * by the PUT). The sync subtracts these from the union and DELETEs them server-side
 * so a local removal stays authoritative. Kept accurate by `toggleFavorite`: a
 * removal adds, a re-favorite removes.
 */
const pendingUnfavorites = new Set<string>();

/** The set of `useSyncExternalStore` subscribers to notify on any change. */
const listeners = new Set<() => void>();

/** Notify every subscriber that a snapshot reference changed. */
function emit(): void {
  for (const listener of listeners) listener();
}

/** Lazily hydrate both caches from localStorage on first access (idempotent). */
function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  favSnapshot = readSlugs(safeGet(FAVORITES_KEY));
  recentSnapshot = readSlugs(safeGet(RECENT_KEY));
  loaded = true;
}

/** Replace the favorites cache + persist + notify. `next` becomes the new ref. */
function commitFavorites(next: string[]): void {
  favSnapshot = next;
  safeSet(FAVORITES_KEY, writeSlugs(next));
  emit();
}

/** Replace the recent cache + persist + notify. `next` becomes the new ref. */
function commitRecent(next: string[]): void {
  recentSnapshot = next;
  safeSet(RECENT_KEY, writeSlugs(next));
  emit();
}

/**
 * Cross-tab sync: when ANOTHER tab writes one of our keys (or clears storage,
 * `key === null`), re-read the affected cache so this tab's cards stay in sync.
 * Registered once, SSR-guarded.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === FAVORITES_KEY || event.key === null) {
      favSnapshot = readSlugs(safeGet(FAVORITES_KEY));
    }
    if (event.key === RECENT_KEY || event.key === null) {
      recentSnapshot = readSlugs(safeGet(RECENT_KEY));
    }
    if (event.key === FAVORITES_KEY || event.key === RECENT_KEY || event.key === null) {
      emit();
    }
  });
}

/** Subscribe a `useSyncExternalStore` listener; returns the unsubscribe fn. */
function subscribe(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cached client snapshot of favorites (stable ref until a change). */
function getFavSnapshot(): string[] {
  ensureLoaded();
  return favSnapshot;
}

/** Cached client snapshot of recently-played (stable ref until a change). */
function getRecentSnapshot(): string[] {
  ensureLoaded();
  return recentSnapshot;
}

/** Stable empty snapshot for SSR + the hydration render. */
function getServerSnapshot(): string[] {
  return EMPTY as string[];
}

/* -------------------------------------------------------------------------- *
 * Imperative mutations (callable outside React).
 * -------------------------------------------------------------------------- */

/**
 * Toggle a slug's favorited state: updates localStorage + emits INSTANTLY (the
 * optimistic local truth), then — only when a signed-in session is known — fires
 * and forgets the matching server mutation (add → POST, remove → DELETE). Network
 * errors are swallowed; the next-load sync reconciles any divergence.
 */
export function toggleFavorite(slug: string): void {
  ensureLoaded();
  const wasFavorited = favSnapshot.includes(slug);
  commitFavorites(toggleSlug(favSnapshot, slug));
  // Track explicit removals so the login union (insert-only) can't resurrect a
  // slug the user unfavorited during the server-sync window; a re-favorite clears it.
  if (wasFavorited) pendingUnfavorites.add(slug);
  else pendingUnfavorites.delete(slug);
  if (!signedIn) return;
  const method = wasFavorited ? "DELETE" : "POST";
  void fetch("/api/v1/me/favorites", {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ slug }),
  }).catch(() => {
    /* local already reflects intent; next-load sync reconciles. */
  });
}

/**
 * Record a game as recently played: move-to-front + dedup + cap. localStorage
 * only — never hits the server. No-op when `slug` is already at the front (avoids
 * a needless write + re-render).
 */
export function recordRecentPlay(slug: string): void {
  if (!slug) return;
  ensureLoaded();
  if (recentSnapshot[0] === slug) return;
  commitRecent(prependCapped(recentSnapshot, slug, RECENT_CAP));
}

/* -------------------------------------------------------------------------- *
 * Server-side play history (the "friends who play this" input).
 * -------------------------------------------------------------------------- */

/**
 * How long before the same game is reported to the server again.
 *
 * The write itself is an idempotent UPSERT, so a duplicate would be harmless —
 * this exists to cut the REQUEST volume. A player bouncing between three games
 * for an hour produces three requests instead of thirty, which is what keeps the
 * beacon at roughly 0.03 writes/second on a driver with no connection pooling.
 */
const PLAY_SYNC_TTL_MS = 30 * 60_000;

/**
 * Whether `slug` is due to be reported again. Pure, so the debounce contract is
 * unit-testable without touching storage or the clock.
 */
export function shouldSyncPlay(
  map: Record<string, number>,
  slug: string,
  now: number,
  ttlMs: number = PLAY_SYNC_TTL_MS,
): boolean {
  const last = map[slug];
  if (typeof last !== "number" || !Number.isFinite(last)) return true;
  // A clock that moved backwards (timezone change, manual set) must not lock the
  // beacon out until the future timestamp expires.
  if (last > now) return true;
  return now - last >= ttlMs;
}

/** Read the debounce ledger, tolerating anything corrupt in storage. */
function readPlaySync(): Record<string, number> {
  const raw = safeGet(PLAY_SYNC_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Report a play to the server, debounced per slug.
 *
 * Fire-and-forget with a swallowed catch, exactly like `toggleFavorite`'s sync:
 * a failed beacon must never surface to the player, and a guest gets a
 * deliberate `200 { recorded: false }` rather than a 401 so no console error
 * appears for signed-out visitors.
 *
 * `keepalive: true` is load-bearing. The caller fires this at the moment a game
 * opens, which is immediately followed by the overlay mounting and, historically,
 * a navigation — without the flag the browser is free to cancel the request
 * in-flight and the play is simply lost.
 */
export function recordPlayServerSide(slug: string): void {
  if (!slug) return;
  const map = readPlaySync();
  const now = Date.now();
  if (!shouldSyncPlay(map, slug, now)) return;

  // Written BEFORE the request, deliberately: the ledger is a rate limiter, not a
  // record of success. Waiting for the response would let a burst of opens all
  // pass the check and fire together.
  map[slug] = now;
  safeSet(PLAY_SYNC_KEY, JSON.stringify(map));

  void fetch("/api/v1/me/plays", {
    method: "POST",
    keepalive: true,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  }).catch(() => {});
}

/* -------------------------------------------------------------------------- *
 * React hooks.
 * -------------------------------------------------------------------------- */

/** Live favorites list + helpers. Re-renders the instant the list changes. */
export function useFavorites(): {
  favorites: string[];
  isFavorite: (slug: string) => boolean;
  toggleFavorite: (slug: string) => void;
} {
  const favorites = useSyncExternalStore(subscribe, getFavSnapshot, getServerSnapshot);
  const isFavorite = useCallback(
    (slug: string) => favorites.includes(slug),
    [favorites],
  );
  const toggle = useCallback((slug: string) => toggleFavorite(slug), []);
  return { favorites, isFavorite, toggleFavorite: toggle };
}

/** Live recently-played list. Re-renders the instant the list changes. */
export function useRecentlyPlayed(): { recent: string[] } {
  const recent = useSyncExternalStore(subscribe, getRecentSnapshot, getServerSnapshot);
  return { recent };
}

/**
 * Login-time favorites reconciliation. Call ONCE (in Arcade). On mount it asks
 * `/api/v1/me/favorites` who is signed in:
 *   - GUEST (`signedIn: false`) → no-op, no writes, stays local-only.
 *   - SIGNED IN → flips the module {@link signedIn} flag, computes the union of
 *     this device's local favorites with the server's MINUS any slug the user
 *     unfavorited in the sync window ({@link pendingUnfavorites}), PUTs that union
 *     (so the server gains the guest's local favorites) and updates the local store
 *     to it (so favorites saved on other devices appear here), then DELETEs the
 *     unfavorited slugs server-side (the insert-only PUT can't). All network errors
 *     are swallowed — personalization is best-effort.
 */
export function useFavoritesServerSync(): void {
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/me/favorites", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { signedIn?: boolean; favorites?: unknown };
        if (!active || data.signedIn !== true) return;
        signedIn = true;
        ensureLoaded();
        const server = Array.isArray(data.favorites)
          ? data.favorites.filter((s): s is string => typeof s === "string")
          : [];
        // Local is authoritative for deletions: subtract slugs the user unfavorited
        // in the sync window from the union so neither the UI nor the insert-only PUT
        // resurrects them.
        const union = mergeSlugs(favSnapshot, server).filter(
          (slug) => !pendingUnfavorites.has(slug),
        );
        // Update local first so the union is visible immediately…
        commitFavorites(union);
        // …then push it up so the server gains this device's guest favorites.
        await fetch("/api/v1/me/favorites", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ slugs: union }),
        });
        // The PUT can only INSERT (ON CONFLICT DO NOTHING), so it cannot express a
        // deletion. Explicitly DELETE every slug the user unfavorited during the sync
        // — read AFTER the PUT settles so a removal that landed mid-PUT is caught too.
        // DELETE is idempotent, so a slug the server never had is a harmless no-op.
        for (const slug of pendingUnfavorites) {
          void fetch("/api/v1/me/favorites", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ slug }),
          }).catch(() => {
            /* local already reflects intent; next-load sync reconciles. */
          });
        }
      } catch {
        /* offline / DB hiccup — local favorites still work. */
      }
    })();
    return () => {
      active = false;
    };
  }, []);
}
