import { describe, expect, it } from "vitest";
import {
  computeCurrentStreak,
  diffDays,
  dayKey,
  EMPTY_STATE,
  isDayKey,
  isMilestone,
  lastNDays,
  recordDay,
} from "./core";

describe("dayKey / isDayKey", () => {
  it("formats a local date as YYYY-MM-DD, zero-padded", () => {
    // Constructed with local parts, read back with local getters — no TZ round-trip.
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("validates key shape", () => {
    expect(isDayKey("2026-08-07")).toBe(true);
    expect(isDayKey("2026-8-7")).toBe(false);
    expect(isDayKey(20260807)).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
});

describe("diffDays", () => {
  it("counts whole calendar days in both directions", () => {
    expect(diffDays("2026-08-07", "2026-08-08")).toBe(1);
    expect(diffDays("2026-08-08", "2026-08-07")).toBe(-1);
    expect(diffDays("2026-08-07", "2026-08-07")).toBe(0);
  });

  it("spans month and year boundaries", () => {
    expect(diffDays("2026-01-31", "2026-02-01")).toBe(1);
    expect(diffDays("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("is exact across a spring-forward DST date (no 23h drift)", () => {
    // US DST begins 2026-03-08; adjacent local days must still be exactly 1 apart.
    expect(diffDays("2026-03-08", "2026-03-09")).toBe(1);
  });
});

describe("computeCurrentStreak", () => {
  it("is 0 for no history", () => {
    expect(computeCurrentStreak([], "2026-08-07")).toBe(0);
  });

  it("counts a consecutive run ending today", () => {
    const days = ["2026-08-07", "2026-08-06", "2026-08-05"];
    expect(computeCurrentStreak(days, "2026-08-07")).toBe(3);
  });

  it("stays alive when the last play was yesterday", () => {
    const days = ["2026-08-06", "2026-08-05"];
    expect(computeCurrentStreak(days, "2026-08-07")).toBe(2);
  });

  it("lapses to 0 when the last play was two+ days ago", () => {
    const days = ["2026-08-04", "2026-08-03"];
    expect(computeCurrentStreak(days, "2026-08-07")).toBe(0);
  });

  it("stops at the first gap", () => {
    const days = ["2026-08-07", "2026-08-06", "2026-08-04", "2026-08-03"];
    expect(computeCurrentStreak(days, "2026-08-07")).toBe(2);
  });

  it("tolerates unsorted, duplicated input", () => {
    const days = ["2026-08-05", "2026-08-07", "2026-08-06", "2026-08-07"];
    expect(computeCurrentStreak(days, "2026-08-07")).toBe(3);
  });
});

describe("recordDay", () => {
  it("adds today and starts a streak of 1", () => {
    const s = recordDay(EMPTY_STATE, "2026-08-07");
    expect(s.days).toEqual(["2026-08-07"]);
    expect(s.longest).toBe(1);
  });

  it("is idempotent within a day", () => {
    const once = recordDay(EMPTY_STATE, "2026-08-07");
    const twice = recordDay(once, "2026-08-07");
    expect(twice.days).toEqual(["2026-08-07"]);
    expect(twice.longest).toBe(1);
  });

  it("extends and grows longest across consecutive days", () => {
    let s = recordDay(EMPTY_STATE, "2026-08-05");
    s = recordDay(s, "2026-08-06");
    s = recordDay(s, "2026-08-07");
    expect(computeCurrentStreak(s.days, "2026-08-07")).toBe(3);
    expect(s.longest).toBe(3);
  });

  it("keeps longest after a lapse even though current resets", () => {
    let s = recordDay(EMPTY_STATE, "2026-08-01");
    s = recordDay(s, "2026-08-02");
    s = recordDay(s, "2026-08-03"); // longest now 3
    s = recordDay(s, "2026-08-10"); // gap → current 1
    expect(computeCurrentStreak(s.days, "2026-08-10")).toBe(1);
    expect(s.longest).toBe(3);
  });
});

describe("isMilestone", () => {
  it("recognises milestone lengths", () => {
    expect(isMilestone(7)).toBe(true);
    expect(isMilestone(30)).toBe(true);
    expect(isMilestone(4)).toBe(false);
  });
});

describe("lastNDays", () => {
  it("returns n oldest-first days ending today with played flags", () => {
    const days = ["2026-08-07", "2026-08-05"];
    const week = lastNDays(days, "2026-08-07", 7);
    expect(week).toHaveLength(7);
    expect(week[6]).toEqual({ key: "2026-08-07", played: true, isToday: true });
    expect(week[0].key).toBe("2026-08-01");
    expect(week.find((d) => d.key === "2026-08-05")?.played).toBe(true);
    expect(week.find((d) => d.key === "2026-08-06")?.played).toBe(false);
  });
});
