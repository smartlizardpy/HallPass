/**
 * HallPass — how long the data behind the PRERENDERED public pages may be reused.
 *
 * WHY THIS IS ITS OWN MODULE. `/`, `/new`, `/category/*`, `/tag/*`, `/game/*`
 * and the sitemap are ISR pages, and a Next ISR page regenerates as often as
 * the SHORTEST lifetime of anything it read: a fetch's `next.revalidate` or an
 * `unstable_cache` `revalidate`. One short value anywhere in a page's reads
 * sets the interval for the whole page, silently — nothing in the page file
 * says so. These numbers used to sit in each reader, and that is how a 300s
 * play-count fetch ended up regenerating forty-three pages every five minutes
 * in production (#131) while the catalogue reads beside it said an hour.
 *
 * WHAT A REGENERATION COSTS. Vercel bills an ISR write only when the
 * regenerated output DIFFERS from the stored one, in 8 KB units of the whole
 * page (HTML plus RSC payload). So the costly case is a short lifetime on data
 * that drifts, like play counts: one count going from 56 to 57 rewrote the
 * full 89 KB category page. Every regeneration also costs function CPU, which
 * is billed whether or not the output changed.
 *
 * THE LOCAL BUILD WILL NOT SHOW YOU A MISTAKE HERE. `getGamePlayCounts` skips
 * its fetch when `POSTHOG_PERSONAL_API_KEY` is unset, so a local `next build`
 * never registers its lifetime and the route table looks fine. Build with the
 * key set (any value — the fetch failing still registers it) to see what
 * production gets.
 */

/**
 * The catalogue reads behind the public pages: game overrides, external games,
 * media, videos, credits and beta tester credits.
 *
 * A BACKSTOP, NOT THE FRESHNESS MECHANISM. Every write to those tables from the
 * app expires its tag on the spot (`updateTag` in Server Actions, an immediate
 * `revalidateTag` in Route Handlers) and revalidates the pages that show it,
 * so an edit is visible on the next request whatever this says. The lifetime
 * only bounds how long a write the app never saw can stay invisible: a row
 * changed by hand in the Neon console, or by `scripts/publish-game.mjs`, which
 * inserts a game's hero image. A day is the right trade for those rare cases
 * against regenerating every catalogue page every hour.
 *
 * If you add a writer to one of these tables, it MUST expire the tag; this
 * number will not cover for it.
 *
 * NOT used by `app-settings.ts` or `game-blob-index.ts`: no prerendered page
 * reads those, they keep their own hour.
 */
export const CATALOGUE_TTL_SECONDS = 86_400;

/**
 * The 30-day play counts shown to the PUBLIC: the "Most played" ordering, the
 * related-games ordering and the `interactionStatistic` in a game's JSON-LD.
 *
 * A day, because a rolling 30-day count does not change meaningfully within one
 * and no number is printed until a game clears `MIN_PLAYS_SHOWN`. The
 * dashboard's own figures do NOT use this: they go through `hogql` in
 * `stats.ts` with their own 60s lifetime, on dynamic routes that ISR never
 * stores.
 */
export const PUBLIC_PLAY_COUNTS_TTL_SECONDS = 86_400;
