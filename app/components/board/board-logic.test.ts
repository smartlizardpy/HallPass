import { describe, expect, it } from "vitest";
import type { Game } from "@/app/lib/games";
import { validateUsernameFormat } from "@/app/lib/username";
import { categoryCounts, filterGames, isFiltering, NO_FILTER, normaliseQuery, pickFeatured } from "./board-filter";
import { applyKey, BACKSPACE, CLEAR, rowsFor, SEARCH_MAX_LENGTH } from "./keyboard-keys";
import { planLaunch } from "./launch-decision";

const g = (slug: string, title: string, category: string, extra: Partial<Game> = {}): Game =>
  ({ slug, title, category, tagline: "", description: "", tags: [], gradient: ["#000", "#111"], accent: "#fff", art: "grid", ...extra }) as Game;

const games = [
  g("a", "Zombie Siege", "Survivor"),
  g("b", "Neon Velocity", "Arcade", { isFeatured: true }),
  g("c", "Café Rush", "Simulation"),
  g("d", "Zombie Golf", "Sports"),
  g("e", "Dash", "Arcade"),
];

describe("board-filter", () => {
  it("returns everything with no filter", () => {
    expect(filterGames(games, NO_FILTER)).toHaveLength(5);
    expect(isFiltering(NO_FILTER)).toBe(false);
  });
  it("searches by name, case- and accent-insensitively, all words required", () => {
    expect(filterGames(games, { query: "  ZOMBIE ", category: null }).map((x) => x.slug)).toEqual(["a", "d"]);
    expect(filterGames(games, { query: "cafe", category: null }).map((x) => x.slug)).toEqual(["c"]);
    expect(filterGames(games, { query: "zombie golf", category: null }).map((x) => x.slug)).toEqual(["d"]);
    expect(filterGames(games, { query: "golf zombie", category: null }).map((x) => x.slug)).toEqual(["d"]);
  });
  it("does not search categories or taglines", () => {
    expect(filterGames(games, { query: "arcade", category: null })).toEqual([]);
  });
  it("combines category and search", () => {
    expect(filterGames(games, { query: "", category: "Arcade" }).map((x) => x.slug)).toEqual(["b", "e"]);
    expect(filterGames(games, { query: "dash", category: "Arcade" }).map((x) => x.slug)).toEqual(["e"]);
    expect(filterGames(games, { query: "zombie", category: "Arcade" })).toEqual([]);
    expect(isFiltering({ query: "x", category: null })).toBe(true);
    expect(isFiltering({ query: " ", category: "Arcade" })).toBe(true);
  });
  it("counts categories alphabetically", () => {
    expect(categoryCounts(games)).toEqual([
      { category: "Arcade", count: 2 },
      { category: "Simulation", count: 1 },
      { category: "Sports", count: 1 },
      { category: "Survivor", count: 1 },
    ]);
  });
  it("features only an explicitly flagged game", () => {
    expect(pickFeatured(games)?.slug).toBe("b");
    expect(pickFeatured(games.filter((x) => !x.isFeatured))).toBeNull();
  });
  it("normalises whitespace", () => {
    expect(normaliseQuery("  a   b ")).toBe("a b");
  });
});

describe("keyboard-keys", () => {
  it("offers every username character and nothing else", () => {
    const keys = rowsFor("username").flat();
    for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789_") expect(keys).toContain(ch);
    expect(keys).toHaveLength(37);
    expect(new Set(keys).size).toBe(37);
  });
  it("only ever builds usernames the format check accepts", () => {
    let v = "";
    for (const ch of "ab_c9z") v = applyKey(v, ch, "username");
    expect(v).toBe("ab_c9z");
    expect(validateUsernameFormat(v).ok).toBe(true);
  });
  it("rejects characters outside the username charset", () => {
    expect(applyKey("ab", "A", "username")).toBe("ab");
    expect(applyKey("ab", " ", "username")).toBe("ab");
    expect(applyKey("ab", "-", "username")).toBe("ab");
    expect(applyKey("ab", "é", "username")).toBe("ab");
    expect(applyKey("ab", "ab", "username")).toBe("ab");
  });
  it("caps usernames at 20 characters", () => {
    let v = "";
    for (let i = 0; i < 30; i++) v = applyKey(v, "a", "username");
    expect(v).toHaveLength(20);
  });
  it("backspace and clear", () => {
    expect(applyKey("abc", BACKSPACE, "username")).toBe("ab");
    expect(applyKey("", BACKSPACE, "username")).toBe("");
    expect(applyKey("abc", CLEAR, "username")).toBe("");
  });
  it("search mode also allows space and hyphen, with a longer cap", () => {
    expect(applyKey("a", " ", "search")).toBe("a ");
    expect(applyKey("a", "-", "search")).toBe("a-");
    expect(rowsFor("search").flat()).toContain("-");
    let v = "";
    for (let i = 0; i < 60; i++) v = applyKey(v, "a", "search");
    expect(v).toHaveLength(SEARCH_MAX_LENGTH);
  });
});

describe("planLaunch", () => {
  it("needs a player when nobody is signed in", () => {
    expect(planLaunch([])).toEqual({ kind: "needs-player" });
  });
  it("launches directly for one player", () => {
    expect(planLaunch(["ava"])).toEqual({ kind: "launch", who: "ava" });
  });
  it("asks who is playing for several", () => {
    expect(planLaunch(["ava", "ben"])).toEqual({ kind: "pick" });
  });
});
