import { describe, expect, it } from "vitest";
import type { Game } from "@/app/lib/games";
import {
  applyOverride,
  categoriesOf,
  genreCounts,
  isStaged,
  mergeCatalogue,
  tagCounts,
  withoutStaged,
  type StagingOverride,
} from "@/app/lib/game-staging";

function game(slug: string, extra: Partial<Game> = {}): Game {
  return {
    slug,
    title: slug.toUpperCase(),
    tagline: "t",
    description: "d",
    category: "Arcade",
    tags: ["Arcade"],
    gradient: ["#000", "#fff"],
    accent: "#000",
    art: "void",
    ...extra,
  };
}

function override(
  slug: string,
  extra: Partial<StagingOverride> = {},
): StagingOverride {
  return {
    slug,
    title: null,
    tagline: null,
    description: null,
    category: null,
    tags: null,
    isNew: null,
    isFeatured: null,
    platform: null,
    staged: null,
    coverUrl: null,
    ...extra,
  };
}

describe("isStaged / withoutStaged", () => {
  it("counts only an explicit true as staged", () => {
    expect(isStaged({ staged: true })).toBe(true);
    expect(isStaged({ staged: false })).toBe(false);
    expect(isStaged({})).toBe(false);
  });

  it("drops staged games and keeps the rest in order", () => {
    const list = [game("a"), game("b", { staged: true }), game("c")];
    expect(withoutStaged(list).map((g) => g.slug)).toEqual(["a", "c"]);
  });
});

describe("applyOverride staged tri-state", () => {
  it("inherits the static flag when the override is NULL", () => {
    expect(applyOverride(game("a", { staged: true }), override("a")).staged).toBe(true);
    expect(applyOverride(game("a"), override("a")).staged).toBeUndefined();
  });

  it("lets override false publish a static-staged game", () => {
    const g = applyOverride(game("a", { staged: true }), override("a", { staged: false }));
    expect(isStaged(g)).toBe(false);
  });

  it("lets override true stage a static-public game", () => {
    const g = applyOverride(game("a"), override("a", { staged: true }));
    expect(isStaged(g)).toBe(true);
  });
});

describe("applyOverride other columns", () => {
  it("replaces non-null columns and inherits null ones", () => {
    const g = applyOverride(
      game("a", { isNew: true }),
      override("a", { title: "New", tags: ["x"] }),
    );
    expect(g.title).toBe("New");
    expect(g.tags).toEqual(["x"]);
    expect(g.tagline).toBe("t");
    expect(g.isNew).toBe(true);
  });

  it("prefers the override cover over the static one", () => {
    const base = game("a", { coverUrl: "/static.png" });
    expect(applyOverride(base, override("a")).coverUrl).toBe("/static.png");
    expect(
      applyOverride(base, override("a", { coverUrl: "/game-media/a/1.png" })).coverUrl,
    ).toBe("/game-media/a/1.png");
  });

  it("leaves platform absent when neither side sets it", () => {
    expect(applyOverride(game("a"), override("a")).platform).toBeUndefined();
  });
});

describe("mergeCatalogue", () => {
  it("applies overrides to static games and appends external games after", () => {
    const merged = mergeCatalogue(
      [game("a"), game("b")],
      [override("b", { title: "B!" })],
      [game("ext", { externalUrl: "https://x" })],
    );
    expect(merged.map((g) => g.slug)).toEqual(["a", "b", "ext"]);
    expect(merged[1].title).toBe("B!");
  });

  it("returns un-overridden games untouched (same object)", () => {
    const a = game("a");
    expect(mergeCatalogue([a], [], [])[0]).toBe(a);
  });

  it("ignores an override whose slug is not in the static array", () => {
    const merged = mergeCatalogue([game("a")], [override("ghost", { staged: true })], []);
    expect(merged).toHaveLength(1);
  });

  it("keeps staged games in the merged list; the view is the caller's choice", () => {
    const merged = mergeCatalogue(
      [game("a", { staged: true })],
      [],
      [game("ext", { staged: true })],
    );
    expect(merged).toHaveLength(2);
    expect(withoutStaged(merged)).toHaveLength(0);
  });
});

describe("derived lists", () => {
  const list = [
    game("a", { category: "Puzzle", tags: ["x", "y"] }),
    game("b", { category: "Arcade", tags: ["x"] }),
    game("c", { category: "Arcade", tags: [] }),
  ];

  it("lists sorted unique categories", () => {
    expect(categoriesOf(list)).toEqual(["Arcade", "Puzzle"]);
  });

  it("counts tags by count desc then name", () => {
    expect(tagCounts(list)).toEqual([
      { tag: "x", count: 2 },
      { tag: "y", count: 1 },
    ]);
  });

  it("counts genres by count desc then name", () => {
    expect(genreCounts(list)).toEqual([
      { name: "Arcade", count: 2 },
      { name: "Puzzle", count: 1 },
    ]);
  });

  it("derives nothing from games that were filtered out", () => {
    const pub = withoutStaged([...list, game("s", { staged: true, category: "Secret", tags: ["hush"] })]);
    expect(categoriesOf(pub)).not.toContain("Secret");
    expect(tagCounts(pub).map((t) => t.tag)).not.toContain("hush");
  });
});

describe("games.ts public views", () => {
  it("derives categories and allTags from non-staged games only", async () => {
    const m = await import("@/app/lib/games");
    const pub = m.games.filter((g) => g.staged !== true);
    expect(m.publicGames).toEqual(pub);
    expect(m.categories).toEqual(categoriesOf(pub));
    expect(m.findGame(m.games[0].slug)).toBe(m.games[0]);
  });
});
