import { describe, expect, it } from "vitest";
import type { Game } from "@/app/lib/games";
import {
  TAG_PAGE_MIN_GAMES,
  landingTags,
  resolveTagFromSlug,
  tagPath,
  tagShelf,
  tagSlug,
} from "@/app/lib/tags";

describe("tagSlug", () => {
  it("lowercases and hyphenates the shapes the catalogue actually carries", () => {
    expect(tagSlug("Shooter")).toBe("shooter");
    expect(tagSlug("Bullet Hell")).toBe("bullet-hell");
    expect(tagSlug("Local Co-op")).toBe("local-co-op");
    expect(tagSlug("3D")).toBe("3d");
  });

  it("collapses runs of punctuation and trims the ends", () => {
    expect(tagSlug("  Co  --  op ")).toBe("co-op");
    expect(tagSlug("Sci-Fi / Cyber")).toBe("sci-fi-cyber");
  });

  it("returns an empty slug for a tag with nothing routable in it", () => {
    expect(tagSlug("!!!")).toBe("");
    expect(tagSlug("")).toBe("");
  });

  it("is idempotent — slugging a slug changes nothing", () => {
    for (const tag of ["Local Co-op", "Bullet Hell", "3D"]) {
      expect(tagSlug(tagSlug(tag))).toBe(tagSlug(tag));
    }
  });
});

describe("tagPath", () => {
  it("builds a path that resolves back to the tag it came from", () => {
    const tags = [{ tag: "Local Co-op", count: 3 }];
    const segment = tagPath("Local Co-op").replace("/tag/", "");
    expect(resolveTagFromSlug(segment, tags)).toBe("Local Co-op");
  });
});

describe("landingTags", () => {
  const tags = [
    { tag: "Action", count: 14 },
    { tag: "Anime", count: TAG_PAGE_MIN_GAMES },
    { tag: "Horror", count: 1 },
    { tag: "???", count: 9 },
  ];

  it("keeps tags at or above the floor and drops the ones under it", () => {
    const kept = landingTags(tags).map((t) => t.tag);
    expect(kept).toContain("Action");
    expect(kept).toContain("Anime");
    expect(kept).not.toContain("Horror");
  });

  it("drops a tag with no routable slug, rather than routing /tag/", () => {
    expect(landingTags(tags).some((t) => t.tag === "???")).toBe(false);
  });

  it("preserves the order it was given", () => {
    expect(landingTags(tags).map((t) => t.tag)).toEqual(["Action", "Anime"]);
  });
});

describe("resolveTagFromSlug", () => {
  const tags = [
    { tag: "Shooter", count: 8 },
    { tag: "Local Co-op", count: 3 },
    { tag: "Horror", count: 1 },
  ];

  it("resolves to the tag as written", () => {
    expect(resolveTagFromSlug("shooter", tags)).toBe("Shooter");
    expect(resolveTagFromSlug("local-co-op", tags)).toBe("Local Co-op");
  });

  it("accepts a segment typed in the wrong case or spacing", () => {
    expect(resolveTagFromSlug("Local Co-op", tags)).toBe("Local Co-op");
  });

  it("refuses a tag below the floor, so its URL 404s", () => {
    expect(resolveTagFromSlug("horror", tags)).toBeNull();
  });

  it("refuses an unknown or empty segment", () => {
    expect(resolveTagFromSlug("nonesuch", tags)).toBeNull();
    expect(resolveTagFromSlug("", tags)).toBeNull();
  });

  it("prefers the tag on more games when two collide on one slug", () => {
    const colliding = [
      { tag: "Co-op", count: 5 },
      { tag: "Co op", count: 2 },
    ];
    expect(resolveTagFromSlug("co-op", colliding)).toBe("Co-op");
  });
});

describe("tagShelf", () => {
  const game = (slug: string, tags: string[]): Game =>
    ({ slug, tags, category: "Action" }) as Game;
  const games = [
    game("a", ["Shooter", "Neon"]),
    game("b", ["Puzzle"]),
    game("c", ["shooter"]),
  ];

  it("lists every game carrying the tag, in catalogue order", () => {
    expect(tagShelf("Shooter", games).map((g) => g.slug)).toEqual(["a", "c"]);
  });

  it("matches case-insensitively, so a miscapitalised tag is not half a shelf", () => {
    expect(tagShelf("SHOOTER", games).map((g) => g.slug)).toEqual(["a", "c"]);
  });

  it("returns nothing for a tag no game carries", () => {
    expect(tagShelf("Nonesuch", games)).toEqual([]);
  });
});
