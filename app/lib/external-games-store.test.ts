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
