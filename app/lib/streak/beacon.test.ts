import { describe, expect, it } from "vitest";
import { streakBeaconBody } from "./beacon";

describe("streakBeaconBody", () => {
  it("reports the device's local day and an offset east of UTC", () => {
    const now = new Date(2026, 9, 2, 18, 30); // local time, whatever the runner's zone
    const body = streakBeaconBody(now);
    expect(body.day).toBe("2026-10-02");
    expect(body.tzOffsetMin).toBe(-now.getTimezoneOffset() || 0);
  });

  it("never reports negative zero", () => {
    expect(Object.is(streakBeaconBody(new Date()).tzOffsetMin, -0)).toBe(false);
  });
});
