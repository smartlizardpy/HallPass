import { describe, expect, it } from "vitest";
import { eventActionAllowed, graceEndsAtMs } from "./admin";
import { FRIGHT_FEST_2026 as C } from "./fright-fest-2026";
import type { EventState } from "./types";

const OPENS = Date.parse(C.opensAt);
const CLOSES = Date.parse(C.closesAt);
const s = (over: Partial<EventState> = {}): EventState => ({
  status: "scheduled", suspended: false, suspendedReason: null, closedEarlyAt: null, finalisedAt: null, ...over,
});
const ok = (r: { ok: boolean }) => r.ok;

describe("eventActionAllowed", () => {
  it("starts verification only after the finishing grace", () => {
    const graceEnd = graceEndsAtMs(C, s());
    expect(graceEnd).toBe(CLOSES + C.submitGraceSec * 1000);
    expect(ok(eventActionAllowed(C, s(), graceEnd - 1, "start-verification", 0))).toBe(false);
    expect(ok(eventActionAllowed(C, s(), graceEnd, "start-verification", 0))).toBe(true);
    const early = new Date(OPENS + 3_600_000).toISOString();
    expect(ok(eventActionAllowed(C, s({ closedEarlyAt: early }), OPENS + 3_600_000 + C.submitGraceSec * 1000, "start-verification", 0))).toBe(true);
  });

  it("finalises only from verification, unsuspended, with nothing waiting for review", () => {
    expect(eventActionAllowed(C, s(), CLOSES + 1e7, "finalise", 0)).toEqual({ ok: false, why: "Start verification first." });
    expect(eventActionAllowed(C, s({ status: "verification" }), CLOSES + 1e7, "finalise", 2)).toEqual({ ok: false, why: "2 runs are still waiting for review." });
    expect(ok(eventActionAllowed(C, s({ status: "verification", suspended: true }), CLOSES + 1e7, "finalise", 0))).toBe(false);
    expect(ok(eventActionAllowed(C, s({ status: "verification" }), CLOSES + 1e7, "finalise", 0))).toBe(true);
  });

  it("closes early only while live, and reopens only before the scheduled close", () => {
    expect(ok(eventActionAllowed(C, s(), OPENS - 1, "close-early", 0))).toBe(false);
    expect(ok(eventActionAllowed(C, s(), OPENS + 1, "close-early", 0))).toBe(true);
    const early = new Date(OPENS + 10).toISOString();
    expect(ok(eventActionAllowed(C, s({ closedEarlyAt: early }), OPENS + 20, "reopen", 0))).toBe(true);
    expect(ok(eventActionAllowed(C, s({ closedEarlyAt: early }), CLOSES, "reopen", 0))).toBe(false);
  });

  it("never suspends a final result, and archives only a finalised one", () => {
    expect(ok(eventActionAllowed(C, s({ status: "finalised" }), CLOSES + 1, "suspend", 0))).toBe(false);
    expect(ok(eventActionAllowed(C, s({ status: "finalised" }), CLOSES + 1, "archive", 0))).toBe(true);
    expect(ok(eventActionAllowed(C, s({ status: "verification" }), CLOSES + 1, "archive", 0))).toBe(false);
  });
});
