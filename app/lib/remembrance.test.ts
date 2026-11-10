import { describe, expect, it } from "vitest";
import { isRemembranceDay, remembranceKey } from "./remembrance";

describe("isRemembranceDay", () => {
  it("is true across the whole of 10 November in Istanbul", () => {
    // 00:00 and 23:59 Istanbul (UTC+3).
    expect(isRemembranceDay(new Date("2026-11-09T21:00:00Z"))).toBe(true);
    expect(isRemembranceDay(new Date("2026-11-10T20:59:00Z"))).toBe(true);
    // 09:05, the moment itself.
    expect(isRemembranceDay(new Date("2026-11-10T06:05:00Z"))).toBe(true);
  });

  it("follows Istanbul's calendar, not UTC's", () => {
    // Still the 9th in UTC, already the 10th in Istanbul.
    expect(isRemembranceDay(new Date("2026-11-09T22:30:00Z"))).toBe(true);
    // Still the 10th in UTC, already the 11th in Istanbul.
    expect(isRemembranceDay(new Date("2026-11-10T21:30:00Z"))).toBe(false);
  });

  it("is false on the days either side and in other months", () => {
    expect(isRemembranceDay(new Date("2026-11-09T12:00:00Z"))).toBe(false);
    expect(isRemembranceDay(new Date("2026-11-11T12:00:00Z"))).toBe(false);
    expect(isRemembranceDay(new Date("2026-10-10T12:00:00Z"))).toBe(false);
  });

  it("comes round every year", () => {
    expect(isRemembranceDay(new Date("2027-11-10T12:00:00Z"))).toBe(true);
  });
});

describe("remembranceKey", () => {
  it("carries the Istanbul year so each anniversary is shown afresh", () => {
    expect(remembranceKey(new Date("2026-11-10T12:00:00Z"))).toBe("remembrance:2026");
    expect(remembranceKey(new Date("2027-11-10T12:00:00Z"))).toBe("remembrance:2027");
  });
});
