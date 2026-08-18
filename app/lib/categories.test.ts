import { describe, expect, it } from "vitest";
import type { Game } from "@/app/lib/games";
import {
  VIRTUAL_CATEGORIES,
  TRENDING_COUNT,
  categoryPath,
  categoryShelf,
  resolveCategoryFromSlug,
  routedCategories,
} from "@/app/lib/categories";

const LIVE = ["Action", "Bullet Hell", "Puzzle"];

describe("resolveCategoryFromSlug", () => {
  it("resolves a live category case-insensitively, returning the written name", () => {
    expect(resolveCategoryFromSlug("action", LIVE)).toBe("Action");
    expect(resolveCategoryFromSlug("ACTION", LIVE)).toBe("Action");
  });

  it("resolves a category containing a space", () => {
    expect(resolveCategoryFromSlug("bullet hell", LIVE)).toBe("Bullet Hell");
  });

  it("resolves the virtual shelves, which are never in the live list", () => {
    expect(resolveCategoryFromSlug("new", [])).toBe("New");
    expect(resolveCategoryFromSlug("trending", [])).toBe("Trending");
  });

  it("returns null for anything else, rather than inventing a shelf", () => {
    expect(resolveCategoryFromSlug("shooter", LIVE)).toBeNull();
    expect(resolveCategoryFromSlug("", LIVE)).toBeNull();
  });
});

describe("routedCategories", () => {
  it("puts the virtual shelves first and keeps the live order", () => {
    expect(routedCategories(LIVE)).toEqual([...VIRTUAL_CATEGORIES, ...LIVE]);
  });
});

describe("categoryPath", () => {
  it("lowercases and percent-encodes, so a space cannot break a link", () => {
    expect(categoryPath("Bullet Hell")).toBe("/category/bullet%20hell");
  });

  it("agrees with what resolveCategoryFromSlug accepts back", () => {
    for (const category of [...LIVE, ...VIRTUAL_CATEGORIES]) {
      const segment = decodeURIComponent(
        categoryPath(category).replace("/category/", ""),
      );
      expect(resolveCategoryFromSlug(segment, LIVE)).toBe(category);
    }
  });
});

/** Only the fields `categoryShelf` reads; the rest of `Game` is irrelevant here. */
const game = (partial: Partial<Game> & { slug: string }): Game =>
  ({ category: "Action", tags: [], ...partial }) as Game;

describe("categoryShelf", () => {
  const games = [
    game({ slug: "a", category: "Action", plays: 10 }),
    game({ slug: "b", category: "Puzzle", plays: 90, isNew: true }),
    game({ slug: "c", category: "Action", plays: 50, isNew: true }),
  ];

  it("keeps only the games in a real category", () => {
    expect(categoryShelf("Action", games).map((g) => g.slug)).toEqual(["a", "c"]);
  });

  it("reads New off isNew, like the arcade does", () => {
    expect(categoryShelf("New", games).map((g) => g.slug)).toEqual(["b", "c"]);
  });

  it("ranks Trending by live play counts when it has them", () => {
    const counts = { a: 999, b: 1, c: 2 };
    expect(categoryShelf("Trending", games, counts).map((g) => g.slug)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("falls back to the seeded plays when no counts are supplied", () => {
    expect(categoryShelf("Trending", games).map((g) => g.slug)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("caps Trending at TRENDING_COUNT, which is what the page's grid shows", () => {
    const many = Array.from({ length: TRENDING_COUNT + 3 }, (_, i) =>
      game({ slug: `g${i}`, plays: i }),
    );
    const shelf = categoryShelf("Trending", many);
    expect(shelf).toHaveLength(TRENDING_COUNT);
    expect(shelf[0].slug).toBe(`g${many.length - 1}`);
  });

  it("does not reorder the catalogue it was given", () => {
    const original = games.map((g) => g.slug);
    categoryShelf("Trending", games);
    expect(games.map((g) => g.slug)).toEqual(original);
  });

  it("returns nothing for a category no game carries", () => {
    expect(categoryShelf("Nonesuch", games)).toEqual([]);
  });
});
