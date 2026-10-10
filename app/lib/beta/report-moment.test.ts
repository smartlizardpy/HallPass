import { describe, expect, it } from "vitest";
import { reportMoment } from "./report-moment";

describe("reportMoment", () => {
  it("keeps a valid moment that has a picture, normalised", () => {
    expect(reportMoment("Boss-1", { hp: 3 }, true)).toEqual({
      name: "boss-1",
      data: '{"hp":3}',
    });
  });

  it("keeps a moment with no data", () => {
    expect(reportMoment("died", null, true)).toEqual({ name: "died", data: null });
    expect(reportMoment("died", undefined, true)).toEqual({ name: "died", data: null });
  });

  it("drops it when no picture is pinned", () => {
    expect(reportMoment("died", { x: 1 }, false)).toBeNull();
  });

  it("drops the whole moment when either half is invalid", () => {
    expect(reportMoment("not valid", { x: 1 }, true)).toBeNull();
    expect(reportMoment("ok", [1, 2], true)).toBeNull();
    expect(reportMoment("ok", { s: "x".repeat(5000) }, true)).toBeNull();
  });

  it("treats an absent name as no moment", () => {
    expect(reportMoment(null, null, true)).toBeNull();
    expect(reportMoment(undefined, undefined, true)).toBeNull();
    expect(reportMoment("", {}, true)).toBeNull();
  });
});
