/**
 * The "for you" ranking, with made-up players: what it must do for someone who
 * likes shooters, what it must refuse to do for someone it knows nothing about,
 * and the properties that keep it safe to show (never fewer games, stable within
 * a day, no dependence on input order for the outcome it promises).
 */

import { describe, expect, it } from "vitest";
import type { Game } from "./games";
import { MIN_SIGNALS, rankForYou, type ForYouInput } from "./for-you";

const DAY = 86_400_000;
const TODAY = 20_000 * DAY;

function game(slug: string, category: string, tags: string[], extra: Partial<Game> = {}): Game {
  return {
    slug,
    title: slug,
    tagline: "",
    description: "",
    category,
    tags,
    gradient: ["#000", "#111"],
    accent: "#fff",
    art: "swarm",
    ...extra,
  };
}

const CATALOGUE: Game[] = [
  game("zombie-yard", "Shooter", ["Shooter", "Zombies", "Survival"]),
  game("night-siege", "Shooter", ["Shooter", "Survival", "Horror"]),
  game("bullet-storm", "Shooter", ["Shooter", "Bullet Hell"]),
  game("arena-duel", "Shooter", ["Shooter", "Multiplayer"]),
  game("neon-snake", "Arcade", ["Arcade", "Neon", "Retro"]),
  game("block-drop", "Puzzle", ["Puzzle", "Retro"]),
  game("word-garden", "Puzzle", ["Puzzle", "Relaxing"]),
  game("farm-clicker", "Simulation", ["Simulation", "Relaxing"]),
  game("kart-rush", "Racing", ["Racing", "Neon"]),
];

function input(over: Partial<ForYouInput> = {}): ForYouInput {
  return {
    games: CATALOGUE,
    taste: {},
    favorites: [],
    recent: [],
    device: null,
    playCounts: {},
    today: TODAY,
    ...over,
  };
}

const shooterFan = (): Partial<ForYouInput> => ({
  favorites: ["zombie-yard"],
  recent: ["night-siege", "zombie-yard"],
  taste: {
    "zombie-yard": { n: 5, t: TODAY - DAY },
    "night-siege": { n: 3, t: TODAY - 2 * DAY },
    "arena-duel": { n: 2, t: TODAY - 3 * DAY },
  },
});

const SHOOTERS = ["zombie-yard", "night-siege", "bullet-storm", "arena-duel"];

describe("rankForYou", () => {
  it("knows nothing about a player with no history, and says so", () => {
    expect(rankForYou(input())).toBeNull();
  });

  it("will not guess from fewer than MIN_SIGNALS games", () => {
    const thin = input({ favorites: ["zombie-yard"], recent: ["night-siege"] });
    expect(MIN_SIGNALS).toBeGreaterThan(2);
    expect(rankForYou(thin)).toBeNull();
  });

  it("puts the games a shooter fan has not tried but would like above unrelated ones", () => {
    const r = rankForYou(input(shooterFan()))!;
    const at = (s: string) => r.order.indexOf(s);
    expect(at("bullet-storm")).toBeLessThan(at("word-garden"));
    expect(at("bullet-storm")).toBeLessThan(at("farm-clicker"));
    expect(at("bullet-storm")).toBeLessThan(at("block-drop"));
  });

  it("returns every game it was given, exactly once, and never filters", () => {
    const r = rankForYou(input(shooterFan()))!;
    expect([...r.order].sort()).toEqual(CATALOGUE.map((g) => g.slug).sort());
    expect(new Set(r.order).size).toBe(CATALOGUE.length);
  });

  it("describes the taste in a word or two", () => {
    const r = rankForYou(input(shooterFan()))!;
    expect(r.topInterests.length).toBeGreaterThan(0);
    expect(r.topInterests.join(" ")).toMatch(/shooter|survival/);
  });

  it("is stable: the same player on the same day gets the same order", () => {
    const a = rankForYou(input(shooterFan()))!.order;
    const b = rankForYou(input(shooterFan()))!.order;
    expect(a).toEqual(b);
  });

  it("does not depend on how the catalogue happened to be ordered, for what it promises", () => {
    const shuffled = [...CATALOGUE].reverse();
    const a = rankForYou(input(shooterFan()))!.order;
    const b = rankForYou(input({ ...shooterFan(), games: shuffled }))!.order;
    // The whole order may differ in the tail (ties), but the top of the list is the
    // shooters' territory either way.
    expect(b.slice(0, 3).every((s) => SHOOTERS.includes(s))).toBe(true);
    expect(a.slice(0, 3).every((s) => SHOOTERS.includes(s))).toBe(true);
  });

  it("sinks a game that cannot be played on this device", () => {
    const cat = CATALOGUE.map((g) =>
      g.slug === "bullet-storm" ? { ...g, platform: "desktop" as const } : { ...g, platform: "both" as const },
    );
    const phone = rankForYou(input({ ...shooterFan(), games: cat, device: "mobile" }))!;
    const desktop = rankForYou(input({ ...shooterFan(), games: cat, device: "desktop" }))!;
    expect(phone.order.indexOf("bullet-storm")).toBeGreaterThan(desktop.order.indexOf("bullet-storm"));
    expect(phone.order[phone.order.length - 1]).toBe("bullet-storm");
  });

  it("gives a new game a nudge, not the top spot", () => {
    const cat = CATALOGUE.map((g) => (g.slug === "kart-rush" ? { ...g, isNew: true } : g));
    const r = rankForYou(input({ ...shooterFan(), games: cat }))!;
    expect(r.order.indexOf("kart-rush")).toBeGreaterThan(2);
  });

  it("lets an old play fade: last week's habit outweighs last year's", () => {
    const recentPuzzler: Partial<ForYouInput> = {
      favorites: ["zombie-yard"],
      recent: [],
      taste: {
        "zombie-yard": { n: 6, t: TODAY - 400 * DAY },
        "night-siege": { n: 6, t: TODAY - 400 * DAY },
        "block-drop": { n: 4, t: TODAY - DAY },
        "word-garden": { n: 4, t: TODAY - 2 * DAY },
      },
    };
    const r = rankForYou(input({ ...recentPuzzler, favorites: [] }))!;
    expect(r.order.indexOf("block-drop")).toBeLessThan(r.order.indexOf("zombie-yard"));
  });

  it("does not stack the same category all the way down the list", () => {
    const r = rankForYou(input(shooterFan()))!;
    const cat = new Map(CATALOGUE.map((g) => [g.slug, g.category]));
    const firstFive = r.order.slice(0, 5).map((s) => cat.get(s));
    const shooters = firstFive.filter((c) => c === "Shooter").length;
    expect(shooters).toBeLessThan(5);
    expect(shooters).toBeGreaterThanOrEqual(2); // but it still leads with what they like
  });

  it("ignores history for a game that has left the catalogue", () => {
    const r = rankForYou(
      input({ ...shooterFan(), taste: { ...shooterFan().taste, "gone-game": { n: 99, t: TODAY } }, recent: ["gone-game", "night-siege"] }),
    )!;
    expect(r.order).not.toContain("gone-game");
  });

  it("returns null for an empty catalogue", () => {
    expect(rankForYou(input({ games: [], ...shooterFan() }))).toBeNull();
  });
});

describe("quality in the ranking", () => {
  const rate = (ratings: Record<string, number>): Game[] =>
    CATALOGUE.map((g) => (ratings[g.slug] ? { ...g, quality: ratings[g.slug] } : g));

  it("puts the better-rated of two otherwise identical games first", () => {
    const games = [
      ...CATALOGUE,
      game("bullet-storm-b", "Shooter", ["Shooter", "Bullet Hell"], { quality: 9 }),
    ].map((g) => (g.slug === "bullet-storm" ? { ...g, quality: 2 } : g));
    const r = rankForYou(input({ ...shooterFan(), games }))!;
    expect(r.order.indexOf("bullet-storm-b")).toBeLessThan(r.order.indexOf("bullet-storm"));
  });

  it("leaves the order alone when nothing is rated", () => {
    const a = rankForYou(input(shooterFan()))!;
    const b = rankForYou(input({ ...shooterFan(), games: rate({}) }))!;
    expect(b.order).toEqual(a.order);
  });

  it("is a tie-breaker: a top-rated game outside the player's taste does not beat a poor one they like", () => {
    const r = rankForYou(
      input({ ...shooterFan(), games: rate({ "bullet-storm": 1, "kart-rush": 10, "neon-snake": 10 }) }),
    )!;
    expect(r.order.indexOf("bullet-storm")).toBeLessThan(r.order.indexOf("kart-rush"));
    expect(r.order.indexOf("bullet-storm")).toBeLessThan(r.order.indexOf("neon-snake"));
  });

  it("never drops a game, however it is rated", () => {
    const r = rankForYou(input({ ...shooterFan(), games: rate({ "word-garden": 1 }) }))!;
    expect(r.order).toHaveLength(CATALOGUE.length);
  });

  it("still puts a game known not to work on this device last", () => {
    const games = CATALOGUE.map((g) =>
      g.slug === "kart-rush" ? { ...g, quality: 10, platform: "mobile" as const } : g,
    );
    const r = rankForYou(input({ ...shooterFan(), games, device: "desktop" }))!;
    expect(r.order.at(-1)).toBe("kart-rush");
  });
});

