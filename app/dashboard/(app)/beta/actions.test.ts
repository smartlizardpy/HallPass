/**
 * Tests for the beta actions' REFUSALS — the rules, not the writes.
 *
 * The store's SQL is covered by `beta/store.test.ts` and the ladder by
 * `permissions.test.ts`. What neither can see is whether these actions actually
 * ASK, and asking is the whole feature: "may not confirm your own beta test" is
 * a rule that lives in four call sites and produces no error, no log line and no
 * visible difference when it is missing — just an admin quietly paying
 * themselves XP.
 *
 * Every dependency is mocked because the module is a `"use server"` file wired
 * into Blob, notifications and Neon; none of that is under test here. `redirect`
 * throws, as the real one does — `back()` is built on it, so a mock that merely
 * recorded the call would let execution continue past a refusal and assert
 * against a state that cannot exist in production.
 *
 * THE LOAD-BEARING ASSERTION IN EVERY CASE IS THAT THE STORE WAS NOT CALLED.
 * A refusal that redirects with the right banner and still writes the row is the
 * exact bug this file exists to catch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/app/lib/dashboard-users";

const requireRoleMock = vi.fn();
const reportById = vi.fn();
const shotById = vi.fn();
const triageReport = vi.fn();
const payAndRemoveReport = vi.fn();
const reviewShot = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@vercel/blob", () => ({ copy: vi.fn(), del: vi.fn() }));
vi.mock("@/app/lib/auth", () => ({ requireRole: () => requireRoleMock() }));
vi.mock("@/app/lib/blob-ops", () => ({
  isBlobOpEnabled: () => Promise.resolve(true),
  blobOpDisabledMessage: () => "disabled",
}));
vi.mock("@/app/lib/beta", () => ({
  beta: {
    reportById: (...args: unknown[]) => reportById(...args),
    shotById: (...args: unknown[]) => shotById(...args),
    triageReport: (...args: unknown[]) => triageReport(...args),
    payAndRemoveReport: (...args: unknown[]) => payAndRemoveReport(...args),
    reviewShot: (...args: unknown[]) => reviewShot(...args),
    clearClip: vi.fn(),
  },
}));
vi.mock("@/app/lib/game-media", () => ({
  MEDIA_CACHE_TAG: "media",
  insertMedia: vi.fn(),
}));
vi.mock("@/app/lib/game-media-blob", () => ({ mediaBlobPath: () => "path" }));
vi.mock("@/app/lib/image-meta", () => ({ toImageType: () => "image/png" }));
vi.mock("@/app/lib/games-store", () => ({ isResolvedSlug: () => true }));
vi.mock("@/app/lib/games", () => ({ findGame: () => undefined }));
vi.mock("@/app/lib/notifications/copy", () => ({ betaAssignmentCopy: () => ({}) }));
vi.mock("@/app/lib/notifications/deliver", () => ({ notifyPlayer: vi.fn() }));
vi.mock("@/app/lib/social", () => ({ social: { internalIdFromUsername: vi.fn() } }));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

import {
  duplicateReportAction,
  fixReportAction,
  reviewShotAction,
  triageReportAction,
} from "./actions";

/** The banner text an action redirected with, decoded from the querystring. */
async function bannerFrom(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirected) {
      const url = new URL(error.to, "http://localhost");
      return url.searchParams.get("error") ?? url.searchParams.get("ok") ?? "";
    }
    throw error;
  }
  throw new Error("action returned without redirecting");
}

function actingAs(role: Role, playerId: string | undefined) {
  requireRoleMock.mockReturnValue({
    email: "admin@example.com",
    role,
    playerId,
  });
}

/** An open bug report authored by `playerId`. */
function reportBy(playerId: string | null) {
  return {
    id: 1,
    playerId,
    kind: "bug" as const,
    severity: "major" as const,
    status: "open" as const,
    clipBlobPath: null,
  };
}

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  triageReport.mockResolvedValue(true);
  payAndRemoveReport.mockResolvedValue({ applied: true, clipBlobPath: null });
  reviewShot.mockResolvedValue(true);
});

describe("judging your own report", () => {
  const OWN = "You submitted this report — another admin has to judge it";

  it("is refused for a beta admin, and writes nothing", async () => {
    actingAs("beta_admin", "player-1");
    reportById.mockResolvedValue(reportBy("player-1"));

    const banner = await bannerFrom(() =>
      triageReportAction(form({ id: "1", status: "accepted" })),
    );
    expect(banner).toBe(OWN);
    // The refusal is only a refusal if the XP never moves.
    expect(triageReport).not.toHaveBeenCalled();
  });

  it("is refused for a full admin too", async () => {
    // The rule is about the decision, not about how much the person is trusted.
    actingAs("admin", "player-1");
    reportById.mockResolvedValue(reportBy("player-1"));

    expect(
      await bannerFrom(() =>
        triageReportAction(form({ id: "1", status: "accepted" })),
      ),
    ).toBe(OWN);
    expect(triageReport).not.toHaveBeenCalled();
  });

  it("is refused on the two outcomes that REMOVE the report", async () => {
    // Fixed pays the most and Duplicate deletes the row; both are reached by a
    // different action from triage, so each needs its own guard.
    for (const action of [fixReportAction, duplicateReportAction]) {
      vi.clearAllMocks();
      actingAs("admin", "player-1");
      reportById.mockResolvedValue(reportBy("player-1"));

      expect(await bannerFrom(() => action(form({ id: "1" })))).toBe(OWN);
      expect(payAndRemoveReport).not.toHaveBeenCalled();
    }
  });

  it("is allowed for a super admin, so a solo site cannot deadlock", async () => {
    actingAs("super_admin", "player-1");
    reportById.mockResolvedValue(reportBy("player-1"));

    await bannerFrom(() =>
      triageReportAction(form({ id: "1", status: "accepted" })),
    );
    expect(triageReport).toHaveBeenCalledTimes(1);
  });

  it("does not block somebody else's report", async () => {
    // The rule must not be so eager that it stops the queue being worked.
    actingAs("beta_admin", "player-1");
    reportById.mockResolvedValue(reportBy("player-2"));

    await bannerFrom(() =>
      triageReportAction(form({ id: "1", status: "accepted" })),
    );
    expect(triageReport).toHaveBeenCalledTimes(1);
  });

  it("does not block a report whose author is gone", async () => {
    // `player_id` is ON DELETE SET NULL: nobody owns it, so there is no
    // self-dealing to prevent and the queue must not jam on it.
    actingAs("beta_admin", "player-1");
    reportById.mockResolvedValue(reportBy(null));

    await bannerFrom(() =>
      triageReportAction(form({ id: "1", status: "accepted" })),
    );
    expect(triageReport).toHaveBeenCalledTimes(1);
  });

  it("refuses when the session cannot say who the caller is", async () => {
    // A token minted before `playerId` was pinned. The question is "can I prove
    // this is not yours", and a missing id means no — otherwise holding an old
    // token would be the way around the rule.
    actingAs("admin", undefined);
    reportById.mockResolvedValue(reportBy("player-1"));

    expect(
      await bannerFrom(() =>
        triageReportAction(form({ id: "1", status: "accepted" })),
      ),
    ).toContain("Sign out and back in");
    expect(triageReport).not.toHaveBeenCalled();
  });
});

describe("judging your own image", () => {
  const shotBy = (playerId: string | null) => ({
    id: "shot-1",
    playerId,
    slug: "game",
    blobPath: "beta-shots/shot-1.png",
    blobUrl: "https://blob/shot-1.png",
    contentType: "image/png",
    width: 1,
    height: 1,
    bytes: 1,
  });

  it("is refused when REJECTING, not only when accepting", async () => {
    // Rejecting reads as the harmless half, which is exactly why it was the
    // path where the row was never loaded and the author never checked.
    actingAs("beta_admin", "player-1");
    shotById.mockResolvedValue(shotBy("player-1"));

    expect(
      await bannerFrom(() =>
        reviewShotAction(form({ id: "shot-1", status: "rejected" })),
      ),
    ).toBe("You submitted this image — another admin has to judge it");
    expect(reviewShot).not.toHaveBeenCalled();
  });

  it("is refused when accepting", async () => {
    actingAs("admin", "player-1");
    shotById.mockResolvedValue(shotBy("player-1"));

    // The BANNER is asserted, not just the absent write. Without the rule this
    // path still fails to call `reviewShot` — it dies further along, in the
    // gallery publish — so "nothing was written" alone would pass whether or
    // not the refusal exists, and the test would be pinning nothing.
    expect(
      await bannerFrom(() =>
        reviewShotAction(form({ id: "shot-1", status: "accepted" })),
      ),
    ).toBe("You submitted this image — another admin has to judge it");
    expect(reviewShot).not.toHaveBeenCalled();
  });

  it("does not block somebody else's image", async () => {
    actingAs("beta_admin", "player-1");
    shotById.mockResolvedValue(shotBy("player-2"));

    await bannerFrom(() =>
      reviewShotAction(form({ id: "shot-1", status: "rejected" })),
    );
    expect(reviewShot).toHaveBeenCalledTimes(1);
  });
});
