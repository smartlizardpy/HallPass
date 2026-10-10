// Which of a game's files the service worker downloads at install.
//
// WHY A BUDGET. `public/sw.js` installs into a cache named per deploy and
// fetches every listed URL with `cache: "reload"`, so EVERY installed device
// downloads EVERYTHING listed, again, on EVERY deploy — 42 deploys in the 30
// days before this was written. That is Fast Data Transfer, of which Hobby
// includes 100 GB a month, and going over pauses the project rather than
// billing it. The whole catalogue was ~5 MB, about 660 daily devices' worth of
// that allowance; ONE 50 MB bundle (which the dashboard accepts) would have cut
// it to about 60.
//
// THE RULE. A game whose files, the cover aside, add up to more than
// `PRECACHE_GAME_BUDGET_BYTES` is listed by its cover alone. The cover is always
// listed because the catalogue shows it, offline too, for every game whether or
// not it has been played. The rest of a big game is saved the first time it is
// played and after that only revalidated (`revalidateGameFile` in
// `public/sw.js`, a 304 when it has not changed), so it still plays offline once
// played. What it gives up is being playable offline BEFORE its first play.
//
// Every game in the catalogue when this was written is under 1.1 MB, so the
// budget changes nothing until a bigger one is published.
//
// A plain-Node module (an .mjs script cannot import the TS app) tested from
// `app/lib/precache-budget.test.ts`, like `cover-mirror.mjs` beside it.

/** The most a game's files (cover aside) may add up to and still be precached. */
export const PRECACHE_GAME_BUDGET_BYTES = 2 * 1024 * 1024;

/** Files listed for every game, whatever its size. */
const ALWAYS_PRECACHED = new Set(["cover.png"]);

/**
 * Decide which of one game's files to precache.
 *
 * @param {{ rel: string, size: number }[]} files every file under
 *   `public/games/<slug>/`, by path relative to that directory
 * @param {number} [budget]
 * @returns {{ precache: string[], playBytes: number, overBudget: boolean }}
 *   the relative paths to list, the size the budget was measured on, and
 *   whether the game went over it
 */
export function planGamePrecache(files, budget = PRECACHE_GAME_BUDGET_BYTES) {
  const playBytes = files
    .filter((file) => !ALWAYS_PRECACHED.has(file.rel))
    .reduce((total, file) => total + file.size, 0);
  const overBudget = playBytes > budget;
  const precache = files
    .filter((file) => !overBudget || ALWAYS_PRECACHED.has(file.rel))
    .map((file) => file.rel);
  return { precache, playBytes, overBudget };
}
