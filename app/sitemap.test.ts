/**
 * `/sitemap.xml` is a prerendered route that regenerates on a timer, and Vercel
 * bills a regeneration whose output changed as an ISR write. Stamping every entry
 * with the render time made the output change EVERY time (#131), so this pins
 * the one property that matters for that: the same catalogue renders the same
 * sitemap, whenever it is rendered.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@/app/lib/games";

vi.mock("@/app/lib/games-store", () => ({
  resolveGames: async () =>
    [{ slug: "neon-run", category: "Arcade", tags: ["Neon"] }] as unknown as Game[],
  resolveCategories: async () => ["Arcade"],
  resolveTags: async () => [{ tag: "Neon", count: 99 }],
}));

import sitemap from "./sitemap";

afterEach(() => {
  vi.useRealTimers();
});

describe("sitemap", () => {
  it("renders identically at different times", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T10:00:00Z"));
    const first = await sitemap();
    vi.setSystemTime(new Date("2026-10-04T18:30:00Z"));
    const second = await sitemap();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("carries no lastModified on any entry", async () => {
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry).not.toHaveProperty("lastModified");
  });
});
