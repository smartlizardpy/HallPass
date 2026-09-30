/**
 * Store tests for `games-store.ts`, against a FAKE tagged-template `sql`.
 *
 * The fake records every statement (its text with `$n` placeholders, and the
 * bound values) and answers reads from a mutable `overrideRows` list, so the
 * tests can assert BOTH what gets written and what the resolvers do with what
 * comes back. `unstable_cache` is a pass-through, `server-only` is a no-op, and
 * `readExternalGames` is stubbed — this file tests the override layer and the
 * public/including-staged split, not the external store.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@/app/lib/games";

type Call = { text: string; values: unknown[] };

const h = vi.hoisted(() => ({
  calls: [] as { text: string; values: unknown[] }[],
  overrideRows: [] as Record<string, unknown>[],
  external: [] as unknown[],
  failReads: false,
  externalDegraded: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...a: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));
vi.mock("@/app/lib/db", () => ({
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    h.calls.push({ text: text.replace(/\s+/g, " ").trim(), values });
    if (/^\s*SELECT/i.test(text)) {
      if (h.failReads) throw new Error("neon down");
      return h.overrideRows;
    }
    return [];
  },
}));
vi.mock("@/app/lib/external-games-store", () => ({
  readExternalGames: async () => h.external,
  readExternalGamesStatus: async () => ({ games: h.external, degraded: h.externalDegraded }),
}));
vi.mock("@/app/lib/games", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/lib/games")>();
  const base = (slug: string, extra: Partial<Game> = {}): Game => ({
    slug,
    title: slug,
    tagline: "",
    description: "",
    category: "Arcade",
    tags: ["Arcade"],
    gradient: ["#000", "#fff"],
    accent: "#000",
    art: "void",
    ...extra,
  });
  return {
    ...real,
    games: [
      base("pub"),
      base("hidden", { staged: true, category: "Secret", tags: ["Secret", "Arcade"] }),
      base("live", { staged: true }),
    ],
  };
});

import {
  clearOverride,
  isExternalReadDegraded,
  isKnownSlug,
  isResolvedSlug,
  isStagedSlug,
  renameCategory,
  renameTag,
  resolveCategories,
  resolveGame,
  resolveGameIncludingStaged,
  resolveGames,
  resolveGamesIncludingStaged,
  resolveGenres,
  resolveTags,
  setFeaturedGame,
  setGameCover,
  setGameStaged,
  upsertOverride,
} from "@/app/lib/games-store";

const slugs = (list: Game[]) => list.map((g) => g.slug);
const writes = (): Call[] => h.calls.filter((c) => !/^SELECT/i.test(c.text));

beforeEach(() => {
  h.calls.length = 0;
  h.overrideRows = [];
  h.external = [];
  h.failReads = false;
});

describe("public-only resolvers (the default)", () => {
  it("hide a static-staged game from every public resolver", async () => {
    expect(slugs(await resolveGames())).toEqual(["pub"]);
    expect(await resolveGame("hidden")).toBeUndefined();
    expect(await isResolvedSlug("hidden")).toBe(false);
    expect(await resolveCategories()).toEqual(["Arcade"]);
    expect(await resolveTags()).toEqual([{ tag: "Arcade", count: 1 }]);
    expect(await resolveGenres()).toEqual([{ name: "Arcade", count: 1 }]);
  });

  it("hide a staged external game and keep a public one", async () => {
    h.external = [
      { slug: "ext-staged", staged: true, category: "Arcade", tags: [] },
      { slug: "ext-pub", staged: false, category: "Arcade", tags: [] },
    ];
    expect(slugs(await resolveGames())).toEqual(["pub", "ext-pub"]);
    expect(await isResolvedSlug("ext-staged")).toBe(false);
  });

  it("fail closed when Neon is down: the static flag still hides the game", async () => {
    h.failReads = true;
    expect(slugs(await resolveGames())).toEqual(["pub"]);
    expect(await isStagedSlug("hidden")).toBe(true);
  });
});

describe("publishing through the override", () => {
  it("override staged=false publishes a static-staged game", async () => {
    h.overrideRows = [{ slug: "hidden", staged: false }];
    expect(slugs(await resolveGames())).toEqual(["pub", "hidden"]);
    expect(await isStagedSlug("hidden")).toBe(false);
  });

  it("keeps the un-overridden static-staged game hidden alongside it", async () => {
    h.overrideRows = [{ slug: "hidden", staged: false }];
    expect(await isStagedSlug("live")).toBe(true);
  });

  it("override staged=true stages a static-public game", async () => {
    h.overrideRows = [{ slug: "pub", staged: true }];
    expect(slugs(await resolveGames())).toEqual([]);
    expect(await isStagedSlug("pub")).toBe(true);
  });

  it("applies the override cover, with the row's other columns inheriting", async () => {
    h.overrideRows = [{ slug: "pub", cover_url: "/game-media/pub/1.png" }];
    const g = await resolveGame("pub");
    expect(g?.coverUrl).toBe("/game-media/pub/1.png");
    expect(g?.title).toBe("pub");
  });
});

describe("including-staged resolvers", () => {
  it("return staged games too", async () => {
    expect(slugs(await resolveGamesIncludingStaged())).toEqual(["pub", "hidden", "live"]);
    expect((await resolveGameIncludingStaged("hidden"))?.slug).toBe("hidden");
  });

  it("isKnownSlug sees staged games; isStagedSlug is false for unknown slugs", async () => {
    expect(await isKnownSlug("hidden")).toBe(true);
    expect(await isKnownSlug("nope")).toBe(false);
    expect(await isStagedSlug("nope")).toBe(false);
    expect(await isStagedSlug("pub")).toBe(false);
  });
});

describe("upsertOverride's patch type", () => {
  it("rejects staged and coverUrl at compile time (checked by tsc, not at runtime)", async () => {
    // @ts-expect-error staged moves only through setGameStaged
    const withStaged: Parameters<typeof upsertOverride>[1] = { staged: true };
    // @ts-expect-error coverUrl moves only through setGameCover
    const withCover: Parameters<typeof upsertOverride>[1] = { coverUrl: "/x.png" };
    await upsertOverride("hidden", { title: "T" });
    const [c] = writes();
    expect(c.text).not.toContain("staged");
    expect([withStaged, withCover]).toHaveLength(2);
  });
});

describe("isExternalReadDegraded", () => {
  it("reports the external read's degraded flag", async () => {
    h.externalDegraded = false;
    expect(await isExternalReadDegraded()).toBe(false);
    h.externalDegraded = true;
    expect(await isExternalReadDegraded()).toBe(true);
    h.externalDegraded = false;
  });
});

describe("column writes", () => {
  it("setGameStaged writes only staged", async () => {
    await setGameStaged("hidden", false);
    const [c] = writes();
    expect(c.text).toContain("INSERT INTO game_overrides (slug, staged)");
    expect(c.text).toContain("staged = EXCLUDED.staged");
    expect(c.text).not.toContain("title");
    expect(c.values).toEqual(["hidden", false]);
  });

  it("setGameCover writes only cover_url", async () => {
    await setGameCover("pub", "/game-media/pub/9.png");
    const [c] = writes();
    expect(c.text).toContain("INSERT INTO game_overrides (slug, cover_url)");
    expect(c.text).toContain("cover_url = EXCLUDED.cover_url");
    expect(c.values).toEqual(["pub", "/game-media/pub/9.png"]);
  });

  it("upsertOverride leaves staged and cover_url untouched", async () => {
    await upsertOverride("pub", { title: "T" });
    const [c] = writes();
    expect(c.text).not.toMatch(/staged/);
    expect(c.text).not.toMatch(/cover_url/);
  });

  it("clearOverride nulls the copy columns and keeps staged/cover_url", async () => {
    await clearOverride("hidden");
    const [update, del] = writes();
    expect(update.text).toMatch(/^UPDATE game_overrides SET title = NULL/);
    expect(update.text).not.toMatch(/staged|cover_url/);
    // The husk row is only deleted when nothing is pinned on it — never a bare DELETE.
    expect(del.text).toContain("DELETE FROM game_overrides");
    expect(del.text).toContain("staged IS NULL AND cover_url IS NULL");
  });
});

describe("global curation reaches staged games", () => {
  it("renameTag renames on a staged game the public view cannot see", async () => {
    const changed = await renameTag("Secret", "Hush");
    expect(changed).toBe(1);
    const [c] = writes();
    expect(c.values).toEqual(["hidden", ["Hush", "Arcade"]]);
  });

  it("renameCategory renames a staged game's category", async () => {
    const changed = await renameCategory("Secret", "Hidden");
    expect(changed).toBe(1);
    expect(writes()[0].values).toEqual(["hidden", "Hidden"]);
  });

  it("setFeaturedGame un-features a staged game that resolves as featured", async () => {
    h.overrideRows = [{ slug: "hidden", is_featured: true }];
    await setFeaturedGame("pub");
    const featured = writes().map((c) => c.values);
    expect(featured).toContainEqual(["pub", true]);
    expect(featured).toContainEqual(["hidden", false]);
  });
});
