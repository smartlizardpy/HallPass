import { describe, expect, it } from "vitest";
import {
  REPORTING_STALE_AFTER_HOURS,
  claimsPerLink,
  fillWeeks,
  isReportingHealthy,
  normaliseLastEvent,
  type ShareWeek,
} from "./config";

describe("claimsPerLink", () => {
  it("divides claims by links", () => {
    expect(claimsPerLink(10, 25)).toBe(2.5);
    expect(claimsPerLink(4, 4)).toBe(1);
  });

  /**
   * The distinction the panel depends on. Zero links means nobody has used the
   * feature; rendering that as `0` would read as a loop that exists and is
   * failing, which is a different and much worse claim.
   */
  it("is null when no link has ever been minted, not zero", () => {
    expect(claimsPerLink(0, 0)).toBeNull();
    expect(claimsPerLink(-1, 5)).toBeNull();
  });

  it("is zero when links exist but nobody took one up", () => {
    expect(claimsPerLink(7, 0)).toBe(0);
  });

  it("refuses non-finite input rather than emitting NaN onto a chart", () => {
    expect(claimsPerLink(Number.NaN, 1)).toBeNull();
    expect(claimsPerLink(1, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("fillWeeks", () => {
  // A Wednesday, so the Monday-snap is actually exercised.
  const today = new Date(Date.UTC(2026, 7, 12));

  it("returns exactly the requested number of weeks, oldest first", () => {
    const out = fillWeeks([], 4, today);
    expect(out).toHaveLength(4);
    expect(out.map((w) => w.week)).toEqual([
      "2026-07-20",
      "2026-07-27",
      "2026-08-03",
      "2026-08-10",
    ]);
  });

  it("snaps the last bucket to the current week's Monday", () => {
    const out = fillWeeks([], 1, today);
    expect(out[0].week).toBe("2026-08-10");
  });

  /**
   * A quiet week has to be drawn as a zero. Leaving it absent lets a line chart
   * join two distant points and invent a slope through activity that never
   * happened.
   */
  it("fills a gap with zeros rather than closing it", () => {
    const rows: ShareWeek[] = [
      { week: "2026-07-20", links: 3, claims: 9 },
      { week: "2026-08-10", links: 1, claims: 2 },
    ];
    const out = fillWeeks(rows, 4, today);

    expect(out).toEqual([
      { week: "2026-07-20", links: 3, claims: 9 },
      { week: "2026-07-27", links: 0, claims: 0 },
      { week: "2026-08-03", links: 0, claims: 0 },
      { week: "2026-08-10", links: 1, claims: 2 },
    ]);
  });

  it("ignores rows outside the window", () => {
    const rows: ShareWeek[] = [{ week: "2025-01-06", links: 99, claims: 99 }];
    const out = fillWeeks(rows, 2, today);
    expect(out.every((w) => w.links === 0)).toBe(true);
  });

  it("treats a Monday as its own week, not the previous one", () => {
    const monday = new Date(Date.UTC(2026, 7, 10));
    expect(fillWeeks([], 1, monday)[0].week).toBe("2026-08-10");
  });

  it("treats a Sunday as the week that started six days earlier", () => {
    const sunday = new Date(Date.UTC(2026, 7, 16));
    expect(fillWeeks([], 1, sunday)[0].week).toBe("2026-08-10");
  });
});

describe("isReportingHealthy", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  const hoursAgo = (h: number) =>
    new Date(now.getTime() - h * 3600_000).toISOString();

  it("is healthy while events keep arriving", () => {
    expect(isReportingHealthy(hoursAgo(0), now)).toBe(true);
    expect(isReportingHealthy(hoursAgo(REPORTING_STALE_AFTER_HOURS - 1), now)).toBe(
      true,
    );
  });

  it("goes unhealthy once the newest event is stale", () => {
    expect(isReportingHealthy(hoursAgo(REPORTING_STALE_AFTER_HOURS + 1), now)).toBe(
      false,
    );
    expect(isReportingHealthy(hoursAgo(72), now)).toBe(false);
  });

  /**
   * The whole point of the check. A blocked, unconfigured or filtered analytics
   * pipeline produces the same row of zeros as genuinely having no visitors, and
   * without this the panel would be read as "our marketing did nothing" every
   * time it actually meant "our analytics stopped".
   */
  it("treats never-received as unhealthy rather than as silence", () => {
    expect(isReportingHealthy(null, now)).toBe(false);
  });

  it("refuses an unparseable timestamp instead of reporting healthy", () => {
    expect(isReportingHealthy("not a date", now)).toBe(false);
    expect(isReportingHealthy("", now)).toBe(false);
  });
});

describe("normaliseLastEvent", () => {
  /**
   * The shape HogQL actually emits for `toString(max(timestamp))`: a space
   * instead of a `T`, microseconds, and no zone at all. Read by `new Date()` as
   * written, that is LOCAL time — so on a server an hour off UTC the freshness
   * check measures staleness against the wrong clock.
   */
  it("reads a zoneless HogQL datetime as UTC", () => {
    expect(normaliseLastEvent("2026-08-17 13:45:12.000000")).toBe(
      "2026-08-17T13:45:12.000Z",
    );
    expect(normaliseLastEvent("2026-08-17 13:45:12")).toBe("2026-08-17T13:45:12.000Z");
  });

  it("keeps an explicit offset when one is given", () => {
    expect(normaliseLastEvent("2026-08-17T13:45:12Z")).toBe("2026-08-17T13:45:12.000Z");
    expect(normaliseLastEvent("2026-08-17 13:45:12+02:00")).toBe(
      "2026-08-17T11:45:12.000Z",
    );
  });

  /**
   * `max(timestamp)` over an empty range is not NULL — ClickHouse returns the
   * type default, so a project that has never received an event answers with the
   * epoch. Passing that through would have the panel name a newest event from
   * 1970 and call analytics stalled, when the truth is that nothing has ever
   * arrived.
   */
  it("treats the epoch default as no event rather than a very old one", () => {
    expect(normaliseLastEvent("1970-01-01 00:00:00")).toBeNull();
    expect(normaliseLastEvent("1970-01-01T00:00:00.000Z")).toBeNull();
  });

  it("is null for anything that cannot be a timestamp", () => {
    expect(normaliseLastEvent(null)).toBeNull();
    expect(normaliseLastEvent(undefined)).toBeNull();
    expect(normaliseLastEvent("")).toBeNull();
    expect(normaliseLastEvent("   ")).toBeNull();
    expect(normaliseLastEvent("not a date")).toBeNull();
    expect(normaliseLastEvent(42)).toBeNull();
  });

  it("hands isReportingHealthy something it can measure", () => {
    const now = new Date("2026-08-17T14:00:00Z");
    const fresh = normaliseLastEvent("2026-08-17 13:45:12.000000");
    expect(isReportingHealthy(fresh, now)).toBe(true);
    expect(isReportingHealthy(normaliseLastEvent("2026-08-16 13:45:12"), now)).toBe(
      false,
    );
  });
});
