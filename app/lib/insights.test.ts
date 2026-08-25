import { describe, expect, it } from "vitest";
import {
  agoLabel,
  dayKey,
  dayKeys,
  delta,
  fillDays,
  fillHours,
  hourLabel,
  peak,
  share,
  weekdayLabel,
} from "./insights";

const AT = (iso: string) => new Date(iso);

describe("delta", () => {
  it("reports growth against the previous period", () => {
    expect(delta(150, 100)).toEqual({ value: 150, prev: 100, pct: 50 });
  });

  it("reports a decline as a negative percentage", () => {
    expect(delta(50, 100).pct).toBe(-50);
  });

  it("has no percentage when there is no baseline", () => {
    // Growth "from zero" is not 100% and not infinite — it is unanswerable, and
    // the dashboard renders that as "— new" rather than inventing a number.
    expect(delta(9, 0).pct).toBeNull();
    expect(delta(0, 0).pct).toBeNull();
  });
});

describe("dayKeys", () => {
  it("returns the window oldest-first, ending on the given day", () => {
    expect(dayKeys(3, AT("2026-03-02T11:00:00Z"))).toEqual([
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("buckets on UTC, not on the time of day", () => {
    expect(dayKeys(1, AT("2026-03-02T23:59:59Z"))).toEqual(["2026-03-02"]);
    expect(dayKeys(1, AT("2026-03-02T00:00:00Z"))).toEqual(["2026-03-02"]);
  });

  it("crosses a leap day", () => {
    expect(dayKeys(2, AT("2028-03-01T09:00:00Z"))).toEqual([
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("agrees with dayKey on the last entry", () => {
    const end = AT("2026-01-05T06:30:00Z");
    expect(dayKeys(5, end).at(-1)).toBe(dayKey(end));
  });
});

describe("fillDays", () => {
  const blank = (date: string) => ({ date, players: 0 });

  it("fills the days a sparse query never returned", () => {
    const rows = [{ date: "2026-03-02", players: 4 }];
    expect(fillDays(rows, 3, AT("2026-03-02T10:00:00Z"), blank)).toEqual([
      { date: "2026-02-28", players: 0 },
      { date: "2026-03-01", players: 0 },
      { date: "2026-03-02", players: 4 },
    ]);
  });

  it("drops rows outside the window rather than stretching it", () => {
    const rows = [
      { date: "2025-12-25", players: 99 },
      { date: "2026-03-01", players: 2 },
    ];
    const filled = fillDays(rows, 2, AT("2026-03-02T10:00:00Z"), blank);
    expect(filled).toHaveLength(2);
    expect(filled.map((d) => d.date)).toEqual(["2026-03-01", "2026-03-02"]);
  });
});

describe("fillHours", () => {
  it("always returns 24 buckets, midnight first", () => {
    const hours = fillHours([{ hour: 13, value: 7 }]);
    expect(hours).toHaveLength(24);
    expect(hours[0]).toEqual({ hour: 0, value: 0 });
    expect(hours[13]).toEqual({ hour: 13, value: 7 });
  });

  it("sums duplicates and ignores impossible hours", () => {
    const hours = fillHours([
      { hour: 9, value: 2 },
      { hour: 9, value: 3 },
      { hour: 24, value: 100 },
      { hour: -1, value: 100 },
      { hour: 1.5, value: 100 },
    ]);
    expect(hours[9].value).toBe(5);
    expect(hours.reduce((sum, h) => sum + h.value, 0)).toBe(5);
  });
});

describe("hourLabel", () => {
  it("reads as a clock, with noon and midnight the right way round", () => {
    expect(hourLabel(0)).toBe("12a");
    expect(hourLabel(9)).toBe("9a");
    expect(hourLabel(12)).toBe("12p");
    expect(hourLabel(13)).toBe("1p");
    expect(hourLabel(23)).toBe("11p");
  });
});

describe("weekdayLabel", () => {
  it("uses ISO numbering — 1 is Monday, 7 is Sunday", () => {
    expect(weekdayLabel(1)).toBe("Mon");
    expect(weekdayLabel(7)).toBe("Sun");
  });

  it("does not invent a day for an out-of-range index", () => {
    expect(weekdayLabel(0)).toBe("—");
    expect(weekdayLabel(8)).toBe("—");
  });
});

describe("share", () => {
  it("returns a percentage rounded to one decimal", () => {
    expect(share(1, 3)).toBe(33.3);
    expect(share(5, 8)).toBe(62.5);
  });

  it("returns null rather than dividing by nothing", () => {
    expect(share(0, 0)).toBeNull();
    expect(share(3, 0)).toBeNull();
    expect(share(Number.NaN, 10)).toBeNull();
  });
});

describe("peak", () => {
  const days = [
    { date: "a", plays: 3 },
    { date: "b", plays: 9 },
    { date: "c", plays: 9 },
  ];

  it("finds the highest row", () => {
    expect(peak(days, (d) => d.plays)?.date).toBe("b");
  });

  it("keeps the earliest row on a tie", () => {
    expect(peak([...days].reverse(), (d) => d.plays)?.date).toBe("c");
  });

  it("has no peak in an empty list", () => {
    expect(peak([], (d: { plays: number }) => d.plays)).toBeNull();
  });
});

describe("agoLabel", () => {
  const now = AT("2026-03-02T12:00:00Z");

  it("scales the unit with the age", () => {
    expect(agoLabel("2026-03-02T09:00:00Z", now)).toBe("today");
    expect(agoLabel("2026-03-01T09:00:00Z", now)).toBe("1d");
    expect(agoLabel("2026-02-26T09:00:00Z", now)).toBe("4d");
    expect(agoLabel("2026-02-10T09:00:00Z", now)).toBe("2w");
    expect(agoLabel("2025-12-02T09:00:00Z", now)).toBe("3mo");
    expect(agoLabel("2024-01-02T09:00:00Z", now)).toBe("2y");
  });

  it("never reports a negative age from clock skew", () => {
    expect(agoLabel("2026-03-03T09:00:00Z", now)).toBe("today");
  });

  it("returns null for a timestamp it cannot read", () => {
    expect(agoLabel("not a date", now)).toBeNull();
  });
});
