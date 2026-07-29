/**
 * HallPass — "Surprise me" game picker.
 *
 * Pure and dependency-free so it unit-tests in the plain `node` env, like
 * `badges.ts` and `handle.ts`. The RNG is INJECTED rather than reached for
 * directly: a test that cannot pin `Math.random` can only assert "the result is
 * in the list", which would pass for a picker that returns the same game every
 * time — exactly the bug worth catching here.
 *
 * WHY THIS IS NOT CALLED DURING RENDER. The catalog and every store page are
 * statically prerendered (see the header comment in `app/game/[slug]/page.tsx`),
 * so a pick made while rendering would be frozen into the HTML at build time:
 * every visitor would get the same "random" game until the next deploy, and the
 * client's own pick would disagree with the server's and trip a hydration
 * mismatch. The caller invokes this from a click handler, where neither applies.
 */

export type PickSurpriseOptions = {
  /** Slug the player is already looking at; never returned if avoidable. */
  exclude?: string | null;
  /** Previous pick, so consecutive presses do not land on the same game. */
  last?: string | null;
  /** Injected for tests; defaults to `Math.random`. */
  random?: () => number;
};

/**
 * Choose a slug at random, preferring one that is neither the current game nor
 * the previous pick.
 *
 * The two exclusions DEGRADE rather than compound into a dead button, which
 * matters at the small end of the catalogue: with two games, excluding both the
 * current one and the last pick would leave nothing, and a strict filter would
 * return `null` and make the button silently do nothing. So the filters are
 * relaxed in order — drop `last` first, then `exclude` — and only a genuinely
 * empty list yields `null`.
 */
export function pickSurprise(
  slugs: readonly string[],
  { exclude = null, last = null, random = Math.random }: PickSurpriseOptions = {},
): string | null {
  if (slugs.length === 0) return null;

  const candidates =
    slugs.filter((s) => s !== exclude && s !== last);
  const pool = candidates.length
    ? candidates
    : slugs.filter((s) => s !== exclude);
  const finalPool = pool.length ? pool : slugs;

  // `random()` is contractually [0, 1), but an injected stub (or a hostile
  // polyfill) can hand back 1 or NaN. Clamping here keeps a bad RNG from
  // producing an out-of-bounds `undefined` that would read as "no games".
  const raw = Math.floor(random() * finalPool.length);
  const index = Number.isFinite(raw)
    ? Math.min(Math.max(raw, 0), finalPool.length - 1)
    : 0;

  return finalPool[index];
}
