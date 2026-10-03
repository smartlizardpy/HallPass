/**
 * The two PostHog lifetimes in `stats.ts` serve different masters and must stay
 * apart:
 *
 *   * `getGamePlayCounts` feeds PRERENDERED public pages, so its fetch lifetime
 *     becomes their ISR regeneration interval. At 300s it regenerated `/`, every
 *     category and every game page each five minutes in production, and each
 *     drifted count made the regeneration a billed write (#131). A local build
 *     cannot catch that — it has no PostHog key, so the fetch never runs — which
 *     is why it is pinned here.
 *   * `hogql` feeds the dashboard, which renders dynamically and wants near-live
 *     numbers. Lengthening the public lifetime must not drag it along.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_TTL_SECONDS,
  PUBLIC_PLAY_COUNTS_TTL_SECONDS,
} from "@/app/lib/cache-lifetimes";

vi.mock("server-only", () => ({}));

type NextInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };

const seen: NextInit[] = [];

beforeEach(() => {
  seen.length = 0;
  vi.resetModules();
  // Read at module load, so it must be set before the dynamic import below.
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "test-key");
  vi.stubEnv("POSTHOG_PROJECT_ID", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: NextInit) => {
      seen.push(init);
      return Response.json({ results: [["neon-run", 57]], columns: ["slug", "plays"] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PostHog fetch lifetimes", () => {
  it("caches the public play counts for a day, under their own tag", async () => {
    const { getGamePlayCounts } = await import("./stats");
    expect(await getGamePlayCounts()).toEqual({ "neon-run": 57 });
    expect(seen).toHaveLength(1);
    expect(seen[0].next).toEqual({
      revalidate: PUBLIC_PLAY_COUNTS_TTL_SECONDS,
      tags: ["game-play-counts"],
    });
    expect(PUBLIC_PLAY_COUNTS_TTL_SECONDS).toBe(86_400);
  });

  it("never regenerates the catalogue pages more often than the catalogue does", () => {
    // The pages that show counts also read the catalogue; the shorter of the two
    // lifetimes is the one they regenerate on, so the counts must not be it.
    expect(PUBLIC_PLAY_COUNTS_TTL_SECONDS).toBeGreaterThanOrEqual(CATALOGUE_TTL_SECONDS);
  });

  it("keeps the dashboard's queries near-live", async () => {
    const { hogql } = await import("./stats");
    await hogql("SELECT 1");
    expect(seen[0].next?.revalidate).toBe(60);
  });
});
