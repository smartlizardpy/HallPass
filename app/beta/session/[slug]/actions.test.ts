/**
 * Testers play STAGED games, so the session actions must accept a staged slug
 * (`isKnownSlug`) rather than answer "Unknown game" (the public-only resolver).
 * The tester gate is `requireBetaTester`, mocked as passing here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ isKnownSlug: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));
vi.mock("@/app/lib/beta", () => ({
  beta: {},
  requireBetaTester: async () => ({ playerId: "p1" }),
  BETA_CREDITS_CACHE_TAG: "beta-credits",
}));
vi.mock("@/app/lib/blob-ops", () => ({
  blobOpDisabledMessage: () => "off",
  isBlobOpEnabled: () => true,
}));
vi.mock("@/app/lib/reviews", () => ({ reviews: {} }));
vi.mock("@/app/lib/games-store", () => ({ isKnownSlug: h.isKnownSlug }));
vi.mock("@/app/lib/notifications/deliver", () => ({ notifyAdmins: vi.fn() }));

import { submitReportAction, submitShotAction } from "@/app/beta/session/[slug]/actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.isKnownSlug.mockImplementation(async (s: string) => s !== "nope");
});

describe("submitShotAction", () => {
  it("accepts a known (possibly staged) slug, failing later on the missing image", async () => {
    const form = new FormData();
    form.set("slug", "beta-game");
    expect(await submitShotAction(form)).toEqual({ ok: false, error: "No image" });
    expect(h.isKnownSlug).toHaveBeenCalledWith("beta-game");
  });

  it("still rejects an unknown slug", async () => {
    const form = new FormData();
    form.set("slug", "nope");
    expect(await submitShotAction(form)).toEqual({ ok: false, error: "Unknown game" });
  });
});

describe("submitReportAction", () => {
  const input = (slug: string) => ({ slug, kind: "bogus", title: "t", body: "b" }) as never;

  it("accepts a known (possibly staged) slug, failing later on the report kind", async () => {
    expect(await submitReportAction(input("beta-game"))).toEqual({
      ok: false,
      error: "Pick bug or idea",
    });
  });

  it("still rejects an unknown slug", async () => {
    expect(await submitReportAction(input("nope"))).toEqual({
      ok: false,
      error: "Unknown game",
    });
  });
});
