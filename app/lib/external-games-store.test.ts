/**
 * Tests for the staged parts of `external-games-store.ts`, against a fake `sql`
 * (same approach as `games-store.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { text: string; values: unknown[] }[],
  rows: [] as Record<string, unknown>[],
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
    return /^\s*SELECT/i.test(text) ? h.rows : [];
  },
}));

import {
  createExternalGame,
  readExternalGames,
  setExternalGameStaged,
} from "@/app/lib/external-games-store";

const row = (extra: Record<string, unknown> = {}) => ({
  slug: "ext",
  title: "Ext",
  tagline: "",
  description: "",
  category: "Arcade",
  tags: [],
  external_url: "https://x.test",
  cover_url: null,
  accent: "#000",
  gradient_from: "#000",
  gradient_to: "#fff",
  is_new: true,
  is_featured: false,
  platform: null,
  plays: 0,
  ...extra,
});

beforeEach(() => {
  h.calls.length = 0;
  h.rows = [];
});

describe("external game staged flag", () => {
  it("maps the staged column onto Game.staged", async () => {
    h.rows = [row({ slug: "a", staged: true }), row({ slug: "b", staged: false })];
    const [a, b] = await readExternalGames();
    expect(a.staged).toBe(true);
    expect(b.staged).toBe(false);
  });

  it("reads a missing column as public, not staged", async () => {
    h.rows = [row()];
    expect((await readExternalGames())[0].staged).toBe(false);
  });

  it("selects the staged column", async () => {
    await readExternalGames();
    expect(h.calls[0].text).toContain("platform, staged, plays");
  });

  it("setExternalGameStaged writes only staged", async () => {
    await setExternalGameStaged("ext", false);
    const [c] = h.calls;
    expect(c.text).toMatch(/^UPDATE external_games SET staged = \$1, updated_at = now\(\) WHERE slug = \$2$/);
    expect(c.values).toEqual([false, "ext"]);
  });

  it("createExternalGame defaults to public and can create staged", async () => {
    const input = {
      slug: "ext", title: "t", tagline: "", description: "", category: "Arcade",
      tags: [], externalUrl: "https://x.test", coverUrl: null, accent: "#000",
      gradientFrom: "#000", gradientTo: "#fff", isNew: true, isFeatured: false,
      platform: null,
    };
    await createExternalGame(input);
    await createExternalGame({ ...input, staged: true });
    expect(h.calls[0].values.at(-1)).toBe(false);
    expect(h.calls[1].values.at(-1)).toBe(true);
  });
});

/**
 * The read goes through `unstable_cache`, which stores JSON. A cache MISS hands
 * the render this module's objects as built; a HIT hands it their JSON round
 * trip. If the two differ, the prerendered pages that list games serialise
 * differently depending on which one they got, and Vercel bills every such
 * regeneration as an ISR write even though nothing changed (issue #131).
 */
describe("external game rows are identical fresh and from the data cache", () => {
  it.each([
    ["no cover, no platform", row()],
    ["a cover and a platform", row({ cover_url: "/game-media/ext/c.png", platform: "desktop" })],
    ["an unrecognised platform", row({ platform: "toaster" })],
  ])("%s", async (_name, r) => {
    h.rows = [r];
    const [fresh] = await readExternalGames();
    // `toStrictEqual`, not `toEqual`: only the strict form tells a key holding
    // `undefined` apart from a missing key, which is exactly the difference JSON
    // erases.
    expect(JSON.parse(JSON.stringify(fresh))).toStrictEqual(fresh);
  });

  it("still maps a cover and a platform when the row has them", async () => {
    h.rows = [row({ cover_url: "/game-media/ext/c.png", platform: "desktop" })];
    const [game] = await readExternalGames();
    expect(game.coverUrl).toBe("/game-media/ext/c.png");
    expect(game.platform).toBe("desktop");
  });

  it("leaves both keys off when the row has neither", async () => {
    h.rows = [row()];
    const [game] = await readExternalGames();
    expect("coverUrl" in game).toBe(false);
    expect("platform" in game).toBe(false);
  });
});
