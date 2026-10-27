import { describe, expect, it } from "vitest";
import { FRIGHT_FEST_2026 as C } from "./fright-fest-2026";
import { championshipSummary, clockPhase, phaseLine, pointBands, pointsFor, summaryGame } from "./summary";

const S = championshipSummary(C);

describe("championshipSummary", () => {
  it("is plain data: no functions, no validators, no games named", () => {
    const json = JSON.stringify(S);
    expect(JSON.parse(json)).toEqual(S);
    expect(json).not.toMatch(/validate|Cursed|Blood Moon|Halloween Shift/);
  });
  it("prints the UK dates the rules state", () => {
    expect(S.labels.opens).toBe("Wed 28 Oct, 00:00");
    expect(S.labels.lastMinute).toBe("Mon 2 Nov, 23:59");
    expect(S.labels.range).toBe("Wed 28 Oct to Mon 2 Nov");
    expect(S.labels.closesDate).toBe("2 Nov");
    expect(S.labels.resultsBy).toBe("Thu 5 Nov, 23:59");
    expect(S.submitGraceMin).toBe(10);
  });
  it("gives a game's own page its entry, and nothing for a stranger", () => {
    expect(summaryGame(C, "last-bell")?.board).toBe("last-bell-halloween-shift");
    expect(summaryGame(C, "neon-snake")).toBeNull();
  });
});

describe("points as published", () => {
  it("merges the table into the bands the rules show", () => {
    expect(pointBands(S)).toEqual([
      { from: 1, to: 1, points: 100 },
      { from: 2, to: 2, points: 80 },
      { from: 3, to: 3, points: 65 },
      { from: 4, to: 5, points: 40 },
      { from: 6, to: 10, points: 20 },
      { from: 11, to: null, points: 5 },
    ]);
    expect([1, 3, 5, 10, 11, 40].map((r) => pointsFor(S, r))).toEqual([100, 65, 40, 20, 5, 5]);
  });
});

describe("phase", () => {
  it("follows the clock until the server says more", () => {
    expect(clockPhase(S, Date.parse("2026-10-27T23:59:59Z"))).toBe("upcoming");
    expect(clockPhase(S, Date.parse("2026-10-28T00:00:00Z"))).toBe("live");
    expect(clockPhase(S, Date.parse("2026-11-03T00:00:00Z"))).toBe("closed");
  });
  it("has a line for every phase a player can see, with no invented numbers", () => {
    for (const p of ["upcoming", "live", "closed", "verification", "finalised", "archived", "suspended"] as const) {
      expect(phaseLine(S, p).length).toBeGreaterThan(10);
    }
    expect(phaseLine(S, "off")).toBe("");
  });
});
