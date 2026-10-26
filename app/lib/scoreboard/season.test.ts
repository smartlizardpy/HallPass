import { describe, it, expect } from "vitest";
import { FRIGHT_FEST_SEASON, seasonFloor } from "./season";
import { FRIGHT_FEST_2026 } from "../championship/fright-fest-2026";
import { CANDY_FRIGHT_FEST_2026 } from "../candy/fright-fest-2026";

describe("FRIGHT_FEST_SEASON", () => {
  it("matches the championship window, so the two cannot drift", () => {
    expect(FRIGHT_FEST_SEASON.from).toBe(FRIGHT_FEST_2026.opensAt);
    expect(FRIGHT_FEST_SEASON.until).toBe(FRIGHT_FEST_2026.closesAt);
  });

  it("matches the candy earning window", () => {
    expect(FRIGHT_FEST_SEASON.from).toBe(CANDY_FRIGHT_FEST_2026.opensAt);
    expect(FRIGHT_FEST_SEASON.until).toBe(CANDY_FRIGHT_FEST_2026.closesAt);
  });
});

describe("seasonFloor", () => {
  const s = FRIGHT_FEST_SEASON;
  it("has no floor before the window", () => {
    expect(seasonFloor(s, new Date("2026-10-27T23:59:59Z"))).toBeNull();
  });
  it("floors at `from`, inclusive, once open", () => {
    expect(seasonFloor(s, new Date(s.from))?.toISOString()).toBe("2026-10-28T00:00:00.000Z");
    expect(seasonFloor(s, new Date("2026-10-31T12:00:00Z"))).not.toBeNull();
  });
  it("has no floor from `until`, exclusive", () => {
    expect(seasonFloor(s, new Date("2026-11-01T23:59:59Z"))).not.toBeNull();
    expect(seasonFloor(s, new Date(s.until))).toBeNull();
  });
});
