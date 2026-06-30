/**
 * Unit tests for the PURE server-side favorites contract (`favorites.ts`). Only
 * the no-DB helpers are exercised — `isKnownSlug` and `normalizeFavoriteSlugs`,
 * the validation/de-dupe layer that every server write (POST/PUT merge) funnels
 * through. The DB-touching functions (`listFavorites`/`addFavorite`/`mergeFavorites`)
 * need a live Neon connection and are intentionally NOT covered here.
 *
 * `favorites.ts` begins with `import "server-only"`, which throws under Vitest's
 * default (non-browser) resolver; we stub it to an empty module so the pure
 * helpers can be imported in the `node` env. The slug-trust invariant is asserted
 * against REAL catalogue slugs (read from `games`) so the test tracks the catalogue.
 */

import { describe, expect, it, vi } from "vitest";

// `favorites.ts` is `server-only`; neutralise the import for this node-env unit test.
vi.mock("server-only", () => ({}));

import { isKnownSlug, normalizeFavoriteSlugs } from "./favorites";
import { games } from "./games";

const REAL_A = games[0].slug;
const REAL_B = games[1].slug;
const REAL_C = games[2].slug;

describe("isKnownSlug", () => {
  it("accepts a real catalogue slug", () => {
    expect(isKnownSlug(REAL_A)).toBe(true);
  });

  it("rejects a slug that names no game", () => {
    expect(isKnownSlug("definitely-not-a-real-game")).toBe(false);
    expect(isKnownSlug("")).toBe(false);
  });
});

describe("normalizeFavoriteSlugs", () => {
  it("keeps known slugs in order", () => {
    expect(normalizeFavoriteSlugs([REAL_A, REAL_B, REAL_C])).toEqual([
      REAL_A,
      REAL_B,
      REAL_C,
    ]);
  });

  it("drops slugs that don't name a real game", () => {
    expect(normalizeFavoriteSlugs([REAL_A, "junk", REAL_B])).toEqual([REAL_A, REAL_B]);
  });

  it("de-dupes while preserving first-seen order", () => {
    expect(normalizeFavoriteSlugs([REAL_B, REAL_A, REAL_B])).toEqual([REAL_B, REAL_A]);
  });

  it("drops non-string entries (a corrupt body can't smuggle junk through)", () => {
    const dirty = [REAL_A, 1, null, { x: 1 }, REAL_B] as unknown as string[];
    expect(normalizeFavoriteSlugs(dirty)).toEqual([REAL_A, REAL_B]);
  });

  it("returns [] for an empty batch", () => {
    expect(normalizeFavoriteSlugs([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [REAL_A, "junk", REAL_A];
    normalizeFavoriteSlugs(input);
    expect(input).toEqual([REAL_A, "junk", REAL_A]);
  });
});
