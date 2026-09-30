/**
 * `/game/[slug]` must 404 for a staged game.
 *
 * The page has no staged check of its own, and needs none: it resolves the slug
 * through the PUBLIC-only `resolveGame`, so a staged slug yields `undefined` and
 * the page calls `notFound()` before reading anything else. `generateStaticParams`
 * draws from `resolveGames()` for the same reason, so a staged slug is never
 * prerendered (and so never enters the service-worker precache). This test pins
 * both halves against the REAL `games-store` over a fake `sql`, so a future
 * swap to an including-staged resolver here fails loudly rather than leaking a
 * pre-release game's page.
 */

import { describe, expect, it, vi } from "vitest";
import type { Game } from "@/app/lib/games";

class NotFound extends Error {}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...a: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));
vi.mock("@/app/lib/db", () => ({ sql: async () => [] }));
vi.mock("@/app/lib/external-games-store", () => ({ readExternalGames: async () => [] }));
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
  return { ...real, games: [base("pub"), base("hidden", { staged: true })] };
});
// The page's other data sources and components are irrelevant to the 404 path.
vi.mock("../../components/ArcadeShell", () => ({ ArcadeShell: () => null }));
vi.mock("../../components/GameStore", () => ({ GameStore: () => null }));
vi.mock("../../lib/game-credits", () => ({ getGameCredit: async () => null, resolveCredit: () => null }));
vi.mock("../../lib/game-media", () => ({ getGameMedia: async () => [], mediaPublicPath: () => "" }));
vi.mock("../../lib/beta", () => ({ getGameTesters: async () => [] }));
vi.mock("../../lib/game-videos", () => ({ getGameVideo: async () => null }));
vi.mock("../../lib/stats", () => ({ getGamePlayCounts: async () => ({}) }));

import GamePage, { generateMetadata, generateStaticParams } from "./page";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("/game/[slug] and staged games", () => {
  it("calls notFound() for a staged slug", async () => {
    await expect(GamePage(params("hidden"))).rejects.toBeInstanceOf(NotFound);
  });

  it("calls notFound() for an unknown slug, same as staged", async () => {
    await expect(GamePage(params("nope"))).rejects.toBeInstanceOf(NotFound);
  });

  it("does not prerender a staged slug", async () => {
    expect(await generateStaticParams()).toEqual([{ slug: "pub" }]);
  });

  it("gives a staged slug the generic not-found metadata, not its title", async () => {
    expect(await generateMetadata(params("hidden"))).toEqual({ title: "Game not found" });
  });
});
