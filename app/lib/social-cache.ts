"use client";

/**
 * HallPass — the friends + challenges responses, held in memory for the tab that
 * is about to ask for them.
 *
 * THE PROBLEM THIS SOLVES. `FriendsIsland` renders `null` until
 * `/api/v1/me/friends` comes back, so tapping the Friends tab on a phone is a
 * dynamic navigation (the `auth()`-gated `/play/you` layout) and THEN two more
 * round trips before a single pixel of content exists. `MobileSplash` is already
 * holding the screen at launch; warming these two responses there means the tab
 * paints from memory instead.
 *
 * IN MEMORY, AND NOWHERE ELSE. Never `localStorage`, never `sessionStorage`,
 * never a `Cache`. `/api/` is excluded from the service worker (`public/sw.js`)
 * precisely so one player's friends list cannot outlive their session on a shared
 * school machine, and this module must not be the thing that quietly reintroduces
 * that. It dies with the document.
 *
 * ⚠ NEVER IMPORT THIS FROM A SERVER COMPONENT. Module state on the server is
 * per-process and shared across every request, so a server-side write here would
 * be one player's friends list handed to the next visitor. Two things keep that
 * from being possible today and both are load-bearing: every write happens in
 * browser-only code (an effect, or the splash), and {@link useCachedFriends}
 * hands React a stable `null` server snapshot so the SSR pass of the island is
 * byte-identical to what it renders today.
 *
 * STALENESS IS DECIDED ON WRITE, NOT ON READ. A read always returns whatever is
 * cached, however old; {@link TTL_MS} only decides whether a warm-up bothers to
 * refetch. That is not laziness — a `getSnapshot` whose answer changed with the
 * clock, without a subscriber notification, is exactly the torn-render bug
 * `personalization.ts` documents at length. The island revalidates on mount
 * regardless, so the cache only ever decides what is on screen in the meantime.
 */

import { useSyncExternalStore } from "react";
import type { IncomingChallenge, OutgoingChallenge } from "./challenges/store";
import type { PublicProfile } from "./social/store";
import { preloadImages } from "./mobile-preload";

/** A pending friend request — a profile plus when it was sent. */
export type FriendRequest = PublicProfile & { requestedAt: string };

/** `GET /api/v1/me/friends`. */
export type FriendsResponse = {
  signedIn: boolean;
  enabled: boolean;
  friends: PublicProfile[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
};

/** `GET /api/v1/me/challenges`. */
export type ChallengesResponse = {
  signedIn: boolean;
  incoming: IncomingChallenge[];
  outgoing: OutgoingChallenge[];
};

/**
 * How long a warmed response is considered fresh enough to skip a refetch.
 *
 * Long enough to cover splash → tab tap, short enough that a request accepted on
 * another device is not stale for a whole session.
 */
const TTL_MS = 60_000;

type Entry<T> = { value: T; at: number } | null;

let friendsEntry: Entry<FriendsResponse> = null;
let challengesEntry: Entry<ChallengesResponse> = null;

/* -------------------------------------------------------------------------- *
 * The store — same shape as `personalization.ts`, for the same reasons.
 * -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * The server snapshot for both hooks. A STABLE `null` — the same value on every
 * call — so the server render and the hydration render agree and the island's
 * first paint is exactly the one it produces today.
 */
function nothing(): null {
  return null;
}

/**
 * The cached responses, outside React.
 *
 * These ARE the hooks' `getSnapshot`, not a parallel path to the same data —
 * which is what keeps the "snapshot identity only changes on a real write" rule
 * true by construction. Building an object in `getSnapshot` would hand React a
 * fresh reference every call and trip its "getSnapshot should be cached" guard.
 */
export function readCachedFriends(): FriendsResponse | null {
  return friendsEntry?.value ?? null;
}

export function readCachedChallenges(): ChallengesResponse | null {
  return challengesEntry?.value ?? null;
}

export function useCachedFriends(): FriendsResponse | null {
  return useSyncExternalStore(subscribe, readCachedFriends, nothing);
}

export function useCachedChallenges(): ChallengesResponse | null {
  return useSyncExternalStore(subscribe, readCachedChallenges, nothing);
}

/** Drop everything. Exported for a sign-out path — see {@link rememberFriends}. */
export function clearSocialCache(): void {
  friendsEntry = null;
  challengesEntry = null;
  emit();
}

/**
 * Store a friends response, and — when it says nobody is signed in — drop the
 * challenges alongside it.
 *
 * The cross-clearing is the shared-machine rule this codebase applies everywhere
 * else (`purgePrivateEntries` in `sw.js`, the never-intercept list, the email
 * moving off the `/play/you` header). Signing out is a server action followed by
 * a `redirect()`, which is a CLIENT transition, not a reload — so module state
 * survives it. Nothing renders the island for a signed-out visitor today, so this
 * leaks nothing as things stand; relying on a guard two components away is how
 * that stops being true later.
 */
function rememberFriends(value: FriendsResponse): void {
  friendsEntry = { value, at: Date.now() };
  if (!value.signedIn) challengesEntry = null;
  emit();
}

function rememberChallenges(value: ChallengesResponse): void {
  challengesEntry = { value, at: Date.now() };
  if (!value.signedIn) friendsEntry = null;
  emit();
}

/* -------------------------------------------------------------------------- *
 * Fetching.
 * -------------------------------------------------------------------------- */

/**
 * In-flight requests, so the splash's warm-up and the island mounting a beat
 * later share one round trip rather than racing each other to the same endpoint.
 */
let friendsInFlight: Promise<void> | null = null;
let challengesInFlight: Promise<void> | null = null;

function fresh(entry: Entry<unknown>): boolean {
  return entry !== null && Date.now() - entry.at < TTL_MS;
}

export function refreshFriends(): Promise<void> {
  if (friendsInFlight) return friendsInFlight;
  friendsInFlight = (async () => {
    try {
      const res = await fetch("/api/v1/me/friends", { credentials: "include" });
      if (!res.ok) return;
      rememberFriends((await res.json()) as FriendsResponse);
    } catch {
      // Offline: `/api/` is never intercepted by the service worker, so this
      // simply fails and whatever was already cached stays on screen. Same
      // behaviour the island had before this module existed.
    } finally {
      friendsInFlight = null;
    }
  })();
  return friendsInFlight;
}

export function refreshChallenges(): Promise<void> {
  if (challengesInFlight) return challengesInFlight;
  challengesInFlight = (async () => {
    try {
      const res = await fetch("/api/v1/me/challenges", { credentials: "include" });
      if (!res.ok) return;
      rememberChallenges((await res.json()) as ChallengesResponse);
    } catch {
      // Kept separate from the friends read on purpose: the two endpoints fail
      // independently, and a challenges table that is behind the deploy must not
      // blank a friends list that works perfectly well.
    } finally {
      challengesInFlight = null;
    }
  })();
  return challengesInFlight;
}

/**
 * The LAUNCH warm-up: fetch both, unless they are already fresh, and preload the
 * faces that come back.
 *
 * The avatar preload lives here rather than in {@link refreshFriends} because
 * preloading only pays ahead of the surface that renders the images. By the time
 * the island itself refreshes, it is on screen and requesting them anyway.
 *
 * `no-referrer` is not decoration: `players.image` is a Google-hosted URL and
 * `Avatar.tsx` is explicit that fetching one without this leaks the page the
 * viewer is on to Google. A preload is the same request to the same host.
 *
 * RETURNS A PROMISE THAT CALLERS ARE MEANT TO IGNORE. The splash must not await
 * it — nothing on screen may depend on a network call completing — but a promise
 * that resolves when the work is genuinely done is the difference between a test
 * that checks the freshness rule and one that accidentally checks the in-flight
 * dedupe instead, because `fetch` is called synchronously and the write is not.
 */
export function warmSocial(): Promise<void> {
  const work: Promise<unknown>[] = [];

  if (!fresh(friendsEntry)) {
    work.push(
      refreshFriends().then(() => {
        const people = friendsEntry?.value;
        if (!people) return;
        preloadImages(
          [
            ...people.friends.map((p) => p.image),
            ...people.incoming.map((p) => p.image),
          ],
          { referrerPolicy: "no-referrer" },
        );
      }),
    );
  }
  if (!fresh(challengesEntry)) work.push(refreshChallenges());

  return Promise.all(work).then(() => undefined);
}
