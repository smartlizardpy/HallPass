import { describe, expect, it } from "vitest";
import {
  VIRTUAL_CATEGORIES,
  categoryPath,
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
