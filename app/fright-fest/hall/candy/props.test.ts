import { describe, expect, it } from "vitest";
import { CANDY_FRIGHT_FEST_2026 as C } from "@/app/lib/candy/fright-fest-2026";
import { buildCandy, rankRange } from "./props";

const P = buildCandy(C, "Wed 4 Nov, 23:59");

describe("buildCandy", () => {
  it("shelves the eight priced packs: four at 30, four at 100", () => {
    expect(P.shelves.map((s) => [s.price, s.items.length])).toEqual([[30, 4], [100, 4]]);
    expect(P.shelves.flatMap((s) => s.items.map((i) => i.packId)).sort()).toEqual(Object.keys(C.prices).sort());
    for (const i of P.shelves.flatMap((s) => s.items)) expect(i.print).toMatch(/^\/collectibles\/packs\/print\/.+\.png/);
  });
  it("reads the labels from the config", () => {
    expect(P.labels).toEqual({ opens: "28 Oct", earnEnds: "1 Nov", spendEnds: "30 Nov", spendUntil: C.spendUntilLabel, resultsBy: "Wed 4 Nov" });
  });
  it("shows the daily-best bands as candy for the top-value game, and the placings", () => {
    expect(P.maxGameCandy).toBe(40);
    expect(P.dailyBest).toEqual([
      { label: "1st", amount: 40 },
      { label: "2nd–3rd", amount: 30 },
      { label: "4th–10th", amount: 20 },
      { label: "Top half", amount: 10 },
      { label: "On the board", amount: 2 },
    ]);
    expect(JSON.stringify(P)).not.toMatch(/rubric|achievement/i);
    expect(P.placing).toEqual([
      { label: "1st", amount: 40 },
      { label: "2nd–3rd", amount: 30 },
      { label: "4th–10th", amount: 20 },
    ]);
    expect([P.rankedRun, P.allBoards]).toEqual([10, 20]);
  });
  it("draws prints at the pack print's native size", () => {
    expect(P.printPx).toEqual({ w: 96, h: 140 });
  });
  it("formats ranges", () => {
    expect(rankRange(4, 10)).toBe("4th–10th");
  });
  it("names no game that is not announced", () => {
    expect(JSON.stringify(P)).not.toMatch(/shadow|cursed|survive|blood moon|dawn|halloween dash|shadowcore/i);
  });
});
