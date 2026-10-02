import { describe, expect, it } from "vitest";
import { needsSync, streakBeaconBody } from "./beacon";

describe("streakBeaconBody", () => {
  const now = new Date(2026, 9, 2, 18, 30); // local time, whatever the runner's zone

  it("reports the device's local day and an offset east of UTC", () => {
    const body = streakBeaconBody(now, ["2026-10-02"]);
    expect(body.day).toBe("2026-10-02");
    expect(body.tzOffsetMin).toBe(-now.getTimezoneOffset() || 0);
  });

  it("never reports negative zero", () => {
    expect(Object.is(streakBeaconBody(new Date(), []).tzOffsetMin, -0)).toBe(false);
  });

  it("reports the device's current run, to seed a new server row", () => {
    const days = ["2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29"];
    expect(streakBeaconBody(now, days).current).toBe(4);
  });

  it("reports at least 1 — today was just played", () => {
    expect(streakBeaconBody(now, []).current).toBe(1);
  });

  it("does not count a lapsed run", () => {
    expect(streakBeaconBody(now, ["2026-09-20", "2026-09-19"]).current).toBe(1);
  });
});

describe("needsSync", () => {
  const days = ["2026-10-02", "2026-10-01"];

  it("is due when today is counted and the server has not confirmed it", () => {
    expect(needsSync(days, "2026-10-02", null)).toBe(true);
    expect(needsSync(days, "2026-10-02", "2026-10-01")).toBe(true);
  });

  it("is not due once the server confirmed today", () => {
    expect(needsSync(days, "2026-10-02", "2026-10-02")).toBe(false);
  });

  it("is not due when the device has not played today", () => {
    expect(needsSync(days, "2026-10-03", null)).toBe(false);
    expect(needsSync([], "2026-10-02", null)).toBe(false);
  });
});
