"use client";

/**
 * HallPass mobile — warming images inside the launch splash's window.
 *
 * `MobileSplash` holds the screen for a beat while the phone shell mounts on the
 * second paint. This module is what makes that beat useful: it fetches (and
 * DECODES) the pictures the shell is about to paint, so the grid and the friends
 * list arrive complete rather than filling in afterwards.
 *
 * WHAT THIS IS AND IS NOT WORTH, stated honestly so nobody over-claims it later.
 * An `Image()` preload of a URL the DOM is ALREADY requesting is free — same
 * cache key, same in-flight request — and it exists mainly to give the splash an
 * `onload` to wait for. The genuinely new fetches are:
 *
 *   - covers BELOW the fold, which `GameCard` renders `loading="lazy"` so the
 *     browser does not ask for them until somebody scrolls;
 *   - external / override covers, which live on Vercel Blob and are therefore
 *     absent from the service-worker precache (`scripts/build-sw-manifest.mjs`
 *     only sweeps `public/games/**`);
 *   - friends' AVATARS, which are cross-origin Google URLs, also lazy, and cached
 *     by nothing in this app.
 *
 * NOTHING HERE TOUCHES THE FIRST PAINT. Every caller runs this from an effect,
 * on a device that matched the phone media query — which is the second render.
 * The prerendered HTML that the crawler and the service worker share is
 * untouched, which is the rule the whole mobile shell rests on
 * (`use-device-platform.ts`).
 *
 * NO SERVICE WORKER. This does not message `sw.js` and must not. See the long
 * note in `MobileSplash.tsx` about why the splash's old `SYNC_NOW` was a
 * catalogue-wide download burst on exactly the school network it meant to help.
 */

import { coverImageSrc } from "../components/CoverImage";
import type { Game } from "./games";

/** Just enough of a {@link Game} to locate its cover. */
type CoverGame = Pick<Game, "slug" | "coverUrl" | "externalUrl">;

/**
 * How many covers count as "the first screen" on a phone.
 *
 * Six is three rows of the mobile shell's two-column grid — comfortably more
 * than a portrait viewport shows, so the splash never lifts onto a half-drawn
 * row, and small enough that waiting on them cannot become the slow path.
 */
export const FIRST_SCREEN_COUNT = 6;

/**
 * How much this connection should be asked to fetch.
 *
 * TWO VALUES, NOT THREE. `"first-screen"` is not "a bit less" — it is the images
 * the browser is fetching anyway, so it costs nothing and still gives the splash
 * something to wait for. `"all"` is what adds the below-the-fold covers and the
 * avatars. There is deliberately no `"none"`: a value nothing ever returns is a
 * lie in the type.
 */
export type PreloadBudget = "first-screen" | "all";

/** The slice of `navigator.connection` this decision needs. */
export type ConnectionHint = {
  saveData?: boolean;
  effectiveType?: string;
};

/**
 * Pure, so it is unit-tested without a DOM — the hook site does the one narrow
 * cast, because `NetworkInformation` is not in TypeScript's DOM lib.
 *
 * A MISSING `navigator.connection` MEANS `"all"`, and that is the important
 * case rather than an afterthought: Safari does not implement the API at all, so
 * every iPhone lands here. Absence of the API is not evidence of a bad
 * connection, and treating it as one would switch the feature off on half the
 * phones it was written for.
 *
 * `saveData` and the 2g tiers narrow to the free tier instead. This is a school
 * product on school networks — spending a data-saver visitor's allowance on
 * covers they may never scroll to is the wrong default, and their in-viewport
 * images still load exactly as they do today.
 */
export function preloadBudget(conn?: ConnectionHint | null): PreloadBudget {
  if (!conn) return "all";
  if (conn.saveData) return "first-screen";
  if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") {
    return "first-screen";
  }
  return "all";
}

/** `navigator.connection`, where it exists. `null` everywhere else. */
export function readConnection(): ConnectionHint | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { connection?: ConnectionHint };
  return nav.connection ?? null;
}

/**
 * Cover URLs for `games`, in order, deduped, with the gradient-only games
 * dropped.
 *
 * Resolved through `coverImageSrc` rather than by rebuilding
 * `/games/<slug>/cover.png` here — that helper is documented as the ONE
 * definition of where cover art lives, and it returns `null` for an external
 * game with no `coverUrl`, which renders as a gradient and has no image to
 * fetch. Requesting one anyway would be a guaranteed 404 per card.
 */
export function coverUrls(games: readonly CoverGame[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const game of games) {
    const src = coverImageSrc(game);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    urls.push(src);
  }
  return urls;
}

/**
 * Every URL this page has already asked for, so a cover reachable from both the
 * Favourites row and the Games row is fetched once. Module scope, and therefore
 * per-document — a reload starts clean, which is what we want: the point of the
 * set is deduping one launch, not remembering across them.
 */
const requested = new Set<string>();

/**
 * First-screen images still in flight.
 *
 * A COUNT, NOT A PROMISE, and that is deliberate. `MobileSplash` polls this to
 * decide when to leave, and a promise it awaits is a promise that can strand the
 * splash on screen forever — the exact failure its docblock already warns about
 * for the timer path. A number can only ever be read wrong once.
 */
let pendingFirst = 0;

export function pendingFirstScreen(): number {
  return pendingFirst;
}

export function preloadImages(
  urls: readonly (string | null | undefined)[],
  opts: {
    /**
     * Count these toward {@link pendingFirstScreen} — i.e. the splash may wait
     * for them. Only ever true for the handful of covers that will be on screen
     * when it lifts.
     */
    firstScreen?: boolean;
    /**
     * MANDATORY FOR AVATARS. `players.image` is a Google-hosted URL, and
     * `Avatar.tsx` is explicit that rendering one without `no-referrer` leaks the
     * page the viewer is on to Google. A preload is the same request to the same
     * host; it gets the same policy, or this module re-opens a hole from a
     * different code path.
     */
    referrerPolicy?: ReferrerPolicy;
  } = {},
): void {
  if (typeof window === "undefined") return;

  for (const url of urls) {
    if (!url || requested.has(url)) continue;
    requested.add(url);

    const img = new Image();
    // Both set BEFORE `src`: assigning the source is what starts the fetch, and
    // a policy applied afterwards would arrive too late to govern it.
    if (opts.referrerPolicy) img.referrerPolicy = opts.referrerPolicy;
    img.decoding = "async";

    if (opts.firstScreen) pendingFirst += 1;
    let settled = false;
    const settle = () => {
      if (settled || !opts.firstScreen) return;
      settled = true;
      pendingFirst = Math.max(0, pendingFirst - 1);
    };

    img.addEventListener(
      "load",
      () => {
        // DECODE BEFORE SETTLING. "In the cache" is not "paints without a beat"
        // — decoding is the part that otherwise happens on the frame the image
        // first appears. `decode()` rejects for an image that failed, which is
        // not an error worth surfacing, and is absent on older browsers.
        try {
          const decoded = img.decode?.();
          if (decoded) decoded.then(settle, settle);
          else settle();
        } catch {
          settle();
        }
      },
      { once: true },
    );
    // A 404 cover must never hold the splash. Errors settle exactly like loads.
    img.addEventListener("error", settle, { once: true });

    img.src = url;
  }
}
