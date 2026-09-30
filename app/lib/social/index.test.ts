/**
 * The live `social` barrel binds `badgeStats` to the staged-slug list, so no
 * caller (the public profile, the owner's shelf) can forget to exclude a
 * beta-only game's achievement points from a badge total.
 */

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ badgeStats: vi.fn(async () => ({ achievementPoints: 0 })) }));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({ sql: {} }));
vi.mock("@/app/lib/games-store", () => ({ stagedSlugs: async () => ["beta-game"] }));
vi.mock("./store", () => ({
  createSocialStore: () => ({ badgeStats: h.badgeStats, other: () => "x" }),
}));

import { social } from "./index";

describe("social.badgeStats", () => {
  it("passes the staged slugs to the store", async () => {
    await social.badgeStats("p1");
    expect(h.badgeStats).toHaveBeenCalledWith("p1", ["beta-game"]);
  });

  it("leaves every other store method intact", () => {
    expect((social as unknown as { other: () => string }).other()).toBe("x");
  });
});
