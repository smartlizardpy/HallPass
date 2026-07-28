/**
 * Unit tests for the PURE server-side favorites contract (`favorites.ts`). Only
 * `normalizeFavoriteSlugs` is exercised — the validation/de-dupe layer that every
 * server write (POST/PUT merge) funnels through. The DB-touching functions
 * (`listFavorites`/`addFavorite`/`mergeFavorites`) need a live Neon connection and
 * are intentionally NOT covered here.
 *
 * The known-slug set is now passed IN rather than built at module load, because
 * the real one comes from `resolveGames()` (static + overrides + external) and is
 * therefore async. That change is the fix for a real bug: the set used to be built
 * from the static array alone, so a signed-in player favouriting an EXTERNAL game
 * had the write silently discarded server-side.
 *
 * `favorites.ts` begins with `import "server-only"`, which throws under Vitest's
 * default (non-browser) resolver; we stub it to an empty module so the pure
 * helpers can be imported in the `node` env. The slug-trust invariant is asserted
 * against REAL catalogue slugs (read from `games`) so the test tracks the catalogue.
 */

import { describe, expect, it, vi } from "vitest";

// `favorites.ts` is `server-only`; neutralise the import for this node-env unit test.
vi.mock("server-only", () => ({}));

import { normalizeFavoriteSlugs } from "./favorites";
import { games } from "./games";

const REAL_A = games[0].slug;
const REAL_B = games[1].slug;
const REAL_C = games[2].slug;

/** Stands in for the resolved catalogue: static games PLUS an external one. */
const EXTERNAL = "an-external-game";
const KNOWN: ReadonlySet<string> = new Set([
  ...games.map((g) => g.slug),
  EXTERNAL,
]);

describe("normalizeFavoriteSlugs", () => {
  it("keeps known slugs in order", () => {
    expect(normalizeFavoriteSlugs([REAL_A, REAL_B, REAL_C], KNOWN)).toEqual([
      REAL_A,
      REAL_B,
      REAL_C,
    ]);
  });

  it("drops slugs that don't name a real game", () => {
    expect(normalizeFavoriteSlugs([REAL_A, "junk", REAL_B], KNOWN)).toEqual([REAL_A, REAL_B]);
  });

  it("de-dupes while preserving first-seen order", () => {
    expect(normalizeFavoriteSlugs([REAL_B, REAL_A, REAL_B], KNOWN)).toEqual([REAL_B, REAL_A]);
  });

  it("drops non-string entries (a corrupt body can't smuggle junk through)", () => {
    const dirty = [REAL_A, 1, null, { x: 1 }, REAL_B] as unknown as string[];
    expect(normalizeFavoriteSlugs(dirty, KNOWN)).toEqual([REAL_A, REAL_B]);
  });

  it("returns [] for an empty batch", () => {
    expect(normalizeFavoriteSlugs([], KNOWN)).toEqual([]);
  });

  it("keeps EXTERNAL game slugs — the bug this signature change fixes", () => {
    // The known set used to be built from the static `games` array at module
    // load, so an external (dashboard-created) game was silently dropped and a
    // signed-in player's favourite never persisted.
    expect(normalizeFavoriteSlugs([REAL_A, EXTERNAL], KNOWN)).toEqual([
      REAL_A,
      EXTERNAL,
    ]);
  });

  it("does not mutate its input", () => {
    const input = [REAL_A, "junk", REAL_A];
    normalizeFavoriteSlugs(input, KNOWN);
    expect(input).toEqual([REAL_A, "junk", REAL_A]);
  });
});
