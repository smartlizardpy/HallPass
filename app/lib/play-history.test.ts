import { describe, expect, it } from "vitest";
import { buildLifetimeSeries } from "./play-history";

describe("buildLifetimeSeries", () => {
  it("is empty with no plays", () => {
    expect(buildLifetimeSeries([])).toEqual([]);
  });

  it("fills quiet days with zero and keeps a running total to today", () => {
    const out = buildLifetimeSeries(
      [
        { date: "2026-10-01", plays: 3 },
        { date: "2026-10-03", plays: 2 },
      ],
      new Date("2026-10-04T12:00:00Z"),
    );
    expect(out).toEqual([
      { date: "2026-10-01", plays: 3, total: 3 },
      { date: "2026-10-02", plays: 0, total: 3 },
      { date: "2026-10-03", plays: 2, total: 5 },
      { date: "2026-10-04", plays: 0, total: 5 },
    ]);
  });

  it("offsets the running total by the seeded baseline", () => {
    const out = buildLifetimeSeries(
      [{ date: "2026-10-01", plays: 1 }],
      new Date("2026-10-01T00:00:00Z"),
      100,
    );
    expect(out).toEqual([{ date: "2026-10-01", plays: 1, total: 101 }]);
  });

  it("ignores malformed rows", () => {
    const out = buildLifetimeSeries(
      [
        { date: "nope", plays: 5 },
        { date: "2026-10-01", plays: -2 },
        { date: "2026-10-01", plays: 4 },
      ],
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(out).toEqual([{ date: "2026-10-01", plays: 4, total: 4 }]);
  });
});
