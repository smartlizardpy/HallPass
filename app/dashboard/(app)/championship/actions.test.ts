/**
 * Championship desk actions: the role gate comes first, reasons are required
 * where they are the record, admins cannot review their own runs, the clock
 * rules use the database clock, and the frozen result carries no internal ids.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const CLOSES = Date.parse("2026-11-02T00:00:00Z");

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readEvent: vi.fn(),
  runCounts: vi.fn(),
  reviewRun: vi.fn(),
  setGameStatus: vi.fn(),
  setEventState: vi.fn(),
  finalise: vi.fn(),
  computeStandings: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${decodeURIComponent(url)}`);
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ requireRole: h.requireRole }));
vi.mock("@/app/lib/championship", () => ({
  championshipStore: {
    readEvent: h.readEvent,
    runCounts: h.runCounts,
    reviewRun: h.reviewRun,
    setGameStatus: h.setGameStatus,
    setEventState: h.setEventState,
    finalise: h.finalise,
  },
  computeStandings: h.computeStandings,
}));

import { eventAction, finaliseAction, gameAction, reviewAction } from "./actions";
import { buildStandings } from "@/app/lib/championship/standings";
import { FRIGHT_FEST_2026 as C } from "@/app/lib/championship/fright-fest-2026";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  f.set("championship", "fright-fest-2026");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const state = (over = {}) => ({ status: "scheduled", suspended: false, suspendedReason: null, closedEarlyAt: null, finalisedAt: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({ email: "staff@hallpass", role: "admin", playerId: "g-staff" });
  h.runCounts.mockResolvedValue({ issued: 0, accepted: 1, flagged: 0, rejected: 0, disqualified: 0 });
});

describe("the role gate", () => {
  it("runs before anything is read or written", async () => {
    h.requireRole.mockRejectedValue(new Error("NEXT_REDIRECT /dashboard/signin"));
    for (const action of [gameAction, eventAction, reviewAction, finaliseAction]) {
      await expect(action(form({ action: "suspend", reason: "x", runId: "1", game: "last-bell" }))).rejects.toThrow(/signin/);
    }
    expect(h.readEvent).not.toHaveBeenCalled();
    expect(h.reviewRun).not.toHaveBeenCalled();
    expect(h.setGameStatus).not.toHaveBeenCalled();
  });
});

describe("reviews", () => {
  it("needs a reason to disqualify, and passes the reviewer's own player id so they cannot review themselves", async () => {
    await expect(reviewAction(form({ action: "disqualify-run", runId: "5" }))).rejects.toThrow(/Give a reason/);
    h.reviewRun.mockResolvedValue(false);
    await expect(reviewAction(form({ action: "approve-run", runId: "5" }))).rejects.toThrow(/your own run/);
    expect(h.reviewRun).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: "staff@hallpass", actorPlayerId: "g-staff", runId: 5 }));
  });
  it("rejects a mangled run id or action", async () => {
    await expect(reviewAction(form({ action: "approve-run", runId: "1; drop" }))).rejects.toThrow(/not valid/);
    await expect(reviewAction(form({ action: "delete-everything", runId: "1" }))).rejects.toThrow(/Unknown review action/);
  });
});

describe("lineup", () => {
  it("only acts on games in the championship, with the actor from the session", async () => {
    await expect(gameAction(form({ action: "open-game", game: "neon-snake" }))).rejects.toThrow(/not in this championship/);
    h.setGameStatus.mockResolvedValue(true);
    await expect(gameAction(form({ action: "open-game", game: "shadow-core-halloween-dash", actorEmail: "forged@x" }))).rejects.toThrow(/board opened/);
    expect(h.setGameStatus).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: "staff@hallpass", gameSlug: "shadow-core-halloween-dash" }));
    await expect(gameAction(form({ action: "withdraw-game", game: "last-bell" }))).rejects.toThrow(/Give a reason/);
  });
});

describe("event actions use the database clock", () => {
  it("refuses verification during the finishing grace", async () => {
    h.readEvent.mockResolvedValue({ state: state(), games: [], nowMs: CLOSES + 60_000 });
    await expect(eventAction(form({ action: "start-verification" }))).rejects.toThrow(/grace/);
    expect(h.setEventState).not.toHaveBeenCalled();
    h.readEvent.mockResolvedValue({ state: state(), games: [], nowMs: CLOSES + C.submitGraceSec * 1000 });
    h.setEventState.mockResolvedValue(true);
    await expect(eventAction(form({ action: "start-verification" }))).rejects.toThrow(/Verification started/);
  });
});

describe("finalise", () => {
  it("freezes public ids and points only, plus who earns what", async () => {
    h.readEvent.mockResolvedValue({ state: state({ status: "verification" }), games: [], nowMs: CLOSES + 1e7 });
    h.computeStandings.mockResolvedValue(
      buildStandings(C, "verification", [{ slug: "last-bell", status: "open", openedAt: C.opensAt }], [
        { runId: 1, gameSlug: "last-bell", playerId: "g-kid", publicId: "pub-kid", name: "@kid", avatar: "", score: 300, tiebreak: 1, submittedAt: "2026-10-30T00:00:00Z" },
      ]),
    );
    h.finalise.mockResolvedValue(true);
    await expect(finaliseAction(form({}))).rejects.toThrow(/Final\. 3 rewards decided/);
    const snapshot = h.finalise.mock.calls[0][0].snapshot;
    expect(JSON.stringify(snapshot)).not.toMatch(/g-kid|playerId|runId|grantKey/);
    expect(snapshot.awards).toEqual({ overallChampion: "pub-kid", gameChampions: { "last-bell": "pub-kid" }, participants: ["pub-kid"] });
    expect(snapshot.phase).toBe("finalised");
  });
  it("refuses while runs wait for review", async () => {
    h.readEvent.mockResolvedValue({ state: state({ status: "verification" }), games: [], nowMs: CLOSES + 1e7 });
    h.runCounts.mockResolvedValue({ issued: 0, accepted: 1, flagged: 1, rejected: 0, disqualified: 0 });
    await expect(finaliseAction(form({}))).rejects.toThrow(/1 run is still waiting/);
    expect(h.finalise).not.toHaveBeenCalled();
  });
});
