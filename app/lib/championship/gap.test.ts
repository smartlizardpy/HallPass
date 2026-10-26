import { describe, expect, it } from "vitest";
import { gapToNextPlace } from "./gap";
import type { PublicOverallEntry } from "./standings";

const entry = (rank: number, points: number, publicId = `p${rank}`): PublicOverallEntry => ({
  rank,
  publicId,
  name: `Player ${rank}`,
  avatar: "",
  points,
  games: {},
  gamesWithResult: 1,
  eligible: true,
  missing: [],
  reachedAt: "2026-10-29T10:00:00Z",
});
const TABLE = [entry(1, 100), entry(2, 80), entry(3, 65), entry(4, 40), entry(5, 40), entry(6, 20), entry(7, 20)];

describe("gapToNextPlace", () => {
  it("says how far ahead the next place up is, while the championship is live", () => {
    expect(gapToNextPlace(TABLE, { rank: 6, points: 20 }, "live")).toBe("The next place up, 5th, is 20 Fright Points ahead.");
    expect(gapToNextPlace(TABLE, { rank: 2, points: 80 }, "live")).toBe("The next place up, 1st, is 20 Fright Points ahead.");
  });

  it("says so when the next place is level on points", () => {
    expect(gapToNextPlace(TABLE, { rank: 7, points: 20 }, "live")).toBe("The next place up, 6th, has the same Fright Points and is ahead on the tiebreak.");
  });

  it("says nothing when you lead, are unranked, the phase is not live, or the next place is off the public table", () => {
    expect(gapToNextPlace(TABLE, { rank: 1, points: 100 }, "live")).toBeNull();
    expect(gapToNextPlace(TABLE, null, "live")).toBeNull();
    for (const p of ["upcoming", "closed", "verification", "finalised", "archived", "suspended"] as const) expect(gapToNextPlace(TABLE, { rank: 6, points: 20 }, p)).toBeNull();
    expect(gapToNextPlace(TABLE, { rank: 60, points: 5 }, "live")).toBeNull();
    expect(gapToNextPlace(TABLE, { rank: 6, points: 20 }, null)).toBeNull();
  });
});
