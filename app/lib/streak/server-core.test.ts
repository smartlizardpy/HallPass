import { describe, expect, it } from "vitest";
import {
  REMINDER_HOUR,
  applyDay,
  clampDay,
  isNudgeDue,
  localParts,
  parseTzOffset,
  utcDayKey,
  type ServerStreak,
} from "./server-core";

const at = (iso: string) => Date.parse(iso);
const run = (current: number, lastDay: string, longest = current): ServerStreak => ({
  current,
  longest,
  lastDay,
});

describe("applyDay", () => {
  it("starts a run of 1 with no history", () => {
    expect(applyDay(null, "2026-10-02")).toEqual({
      state: run(1, "2026-10-02"),
      advanced: true,
      milestone: false,
    });
  });

  it("ignores the same day and an earlier day", () => {
    const prev = run(4, "2026-10-02");
    expect(applyDay(prev, "2026-10-02").advanced).toBe(false);
    expect(applyDay(prev, "2026-10-01").advanced).toBe(false);
    expect(applyDay(prev, "2026-10-01").state).toBe(prev);
  });

  it("grows the run on the next day and tracks the longest", () => {
    const next = applyDay(run(4, "2026-10-02", 9), "2026-10-03");
    expect(next.state).toEqual(run(5, "2026-10-03", 9));
    expect(next.advanced).toBe(true);
  });

  it("raises longest when the run passes it", () => {
    expect(applyDay(run(4, "2026-10-02", 4), "2026-10-03").state.longest).toBe(5);
  });

  it("restarts at 1 after a gap, keeping the longest", () => {
    const next = applyDay(run(8, "2026-10-02", 8), "2026-10-05");
    expect(next.state).toEqual(run(1, "2026-10-05", 8));
  });

  it("flags a milestone only when the run lands on one", () => {
    expect(applyDay(run(2, "2026-10-02"), "2026-10-03").milestone).toBe(true); // 3
    expect(applyDay(run(3, "2026-10-02"), "2026-10-03").milestone).toBe(false); // 4
    expect(applyDay(run(3, "2026-10-02"), "2026-10-02").milestone).toBe(false); // no-op
  });

  it("counts across a month and year boundary", () => {
    expect(applyDay(run(2, "2026-12-31"), "2027-01-01").state.current).toBe(3);
  });
});

describe("clampDay", () => {
  const now = at("2026-10-02T12:00:00Z");

  it("accepts today, yesterday and tomorrow in UTC terms", () => {
    expect(clampDay("2026-10-02", now)).toBe("2026-10-02");
    expect(clampDay("2026-10-01", now)).toBe("2026-10-01");
    expect(clampDay("2026-10-03", now)).toBe("2026-10-03");
  });

  it("rejects anything further out", () => {
    expect(clampDay("2026-09-30", now)).toBeNull();
    expect(clampDay("2026-10-04", now)).toBeNull();
  });

  it("rejects malformed and impossible dates", () => {
    expect(clampDay("2026-10-2", now)).toBeNull();
    expect(clampDay("2026-02-31", now)).toBeNull();
    expect(clampDay(20261002, now)).toBeNull();
    expect(clampDay(null, now)).toBeNull();
  });
});

describe("parseTzOffset", () => {
  it("accepts real offsets and rounds to whole minutes", () => {
    expect(parseTzOffset(60)).toBe(60);
    expect(parseTzOffset(-300)).toBe(-300);
    expect(parseTzOffset(330.4)).toBe(330);
  });

  it("rejects out-of-range and non-numeric values", () => {
    expect(parseTzOffset(841)).toBeNull();
    expect(parseTzOffset("60")).toBeNull();
    expect(parseTzOffset(NaN)).toBeNull();
  });
});

describe("localParts", () => {
  it("shifts the day across midnight in both directions", () => {
    const now = at("2026-10-02T23:30:00Z");
    expect(localParts(now, 120)).toEqual({ day: "2026-10-03", hour: 1 });
    expect(localParts(now, -300)).toEqual({ day: "2026-10-02", hour: 18 });
  });

  it("matches utcDayKey at zero offset", () => {
    const now = at("2026-10-02T08:00:00Z");
    expect(localParts(now, 0).day).toBe(utcDayKey(now));
  });
});

describe("isNudgeDue", () => {
  // 16:30 UTC in London (BST, +60) is 17:30 local.
  const now = at("2026-10-02T16:30:00Z");
  const base = { current: 5, lastDay: "2026-10-01", lastNudgedDay: null, tzOffsetMin: 60 };

  it("is due at the reminder hour for a live, unextended streak", () => {
    expect(localParts(now, 60).hour).toBe(REMINDER_HOUR);
    expect(isNudgeDue(base, now)).toBe(true);
  });

  it("is not due outside the reminder hour", () => {
    expect(isNudgeDue(base, at("2026-10-02T15:30:00Z"))).toBe(false);
    expect(isNudgeDue(base, at("2026-10-02T17:30:00Z"))).toBe(false);
  });

  it("is not due once the player has played today", () => {
    expect(isNudgeDue({ ...base, lastDay: "2026-10-02" }, now)).toBe(false);
  });

  it("is not due for a lapsed streak — there is no win-back", () => {
    expect(isNudgeDue({ ...base, lastDay: "2026-09-30" }, now)).toBe(false);
  });

  it("is not due for a run too short to be worth saving", () => {
    expect(isNudgeDue({ ...base, current: 1 }, now)).toBe(false);
  });

  it("is not due twice on the same local day", () => {
    expect(isNudgeDue({ ...base, lastNudgedDay: "2026-10-02" }, now)).toBe(false);
    expect(isNudgeDue({ ...base, lastNudgedDay: "2026-10-01" }, now)).toBe(true);
  });

  it("uses the player's offset, not the server's", () => {
    // The same instant is 11:30 in New York: not due there.
    expect(isNudgeDue({ ...base, tzOffsetMin: -300 }, now)).toBe(false);
  });
});
