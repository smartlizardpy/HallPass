/**
 * `expireTesterCredits` decides which caches a tester-credit change touches.
 * The cases worth pinning are the cheap one (nothing credited, so nothing
 * regenerates), the safe one (lookup failed, so the tag goes anyway), and the
 * API split Next imposes (`updateTag` only exists in Server Actions).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("next/cache", () => ({
  updateTag: (tag: string) => void h.calls.push(`update:${tag}`),
  revalidateTag: (tag: string, profile: unknown) =>
    void h.calls.push(`revalidate:${tag}:${JSON.stringify(profile)}`),
  revalidatePath: (path: string) => void h.calls.push(`path:${path}`),
}));

import { BETA_CREDITS_CACHE_TAG, expireTesterCredits } from "./credit-cache";

beforeEach(() => {
  h.calls = [];
});

describe("expireTesterCredits", () => {
  it("does nothing when no game credits the player", () => {
    expireTesterCredits([], "action");
    expireTesterCredits([], "route");
    expect(h.calls).toEqual([]);
  });

  it("expires the tag and each credited game page once, from an action", () => {
    expireTesterCredits(["neon-run", "pixel-slicer", "neon-run"], "action");
    expect(h.calls).toEqual([
      `update:${BETA_CREDITS_CACHE_TAG}`,
      "path:/game/neon-run",
      "path:/game/pixel-slicer",
    ]);
  });

  it("uses an immediately-expiring revalidateTag from a route handler", () => {
    expireTesterCredits(["neon-run"], "route");
    expect(h.calls).toEqual([
      `revalidate:${BETA_CREDITS_CACHE_TAG}:{"expire":0}`,
      "path:/game/neon-run",
    ]);
  });

  it("expires the tag alone when the credited games are unknown", () => {
    expireTesterCredits(null, "action");
    expect(h.calls).toEqual([`update:${BETA_CREDITS_CACHE_TAG}`]);
  });
});
