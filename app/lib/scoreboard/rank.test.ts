/**
 * Tests for the pure ranking semantics. These pin the tie-break that the SQL
 * `ORDER BY` clauses and leaderboard indexes must reproduce exactly:
 * score, then earlier `createdAt`, then lower `id`.
 */

import { describe, it, expect } from "vitest";
import { assignRanks, comparator, rankForScores, type RankInput } from "./rank";

describe("comparator", () => {
  it("orders desc boards highest-score first", () => {
    const rows: RankInput[] = [
      { handle: "A", score: 10 },
      { handle: "B", score: 30 },
      { handle: "C", score: 20 },
    ];
    const sorted = [...rows].sort(comparator("desc")).map((r) => r.handle);
    expect(sorted).toEqual(["B", "C", "A"]);
  });

  it("orders asc boards lowest-score first (time/golf)", () => {
    const rows: RankInput[] = [
      { handle: "A", score: 10 },
      { handle: "B", score: 30 },
      { handle: "C", score: 20 },
    ];
    const sorted = [...rows].sort(comparator("asc")).map((r) => r.handle);
    expect(sorted).toEqual(["A", "C", "B"]);
  });

  it("breaks a score tie by earlier createdAt, then lower id", () => {
    const rows: RankInput[] = [
      { handle: "late-lowid", score: 100, createdAt: 2000, id: 1 },
      { handle: "early", score: 100, createdAt: 1000, id: 9 },
      { handle: "late-highid", score: 100, createdAt: 2000, id: 5 },
    ];
    const sorted = [...rows].sort(comparator("desc")).map((r) => r.handle);
    expect(sorted).toEqual(["early", "late-lowid", "late-highid"]);
  });

  it("applies the same tie-break for asc boards", () => {
    const rows: RankInput[] = [
      { handle: "b", score: 5, createdAt: 2000, id: 3 },
      { handle: "a", score: 5, createdAt: 1000, id: 4 },
    ];
    const sorted = [...rows].sort(comparator("asc")).map((r) => r.handle);
    expect(sorted).toEqual(["a", "b"]);
  });
});

describe("rankForScores", () => {
  const population = [100, 90, 90, 50];

  it("desc: rank is 1 + count of strictly-greater scores", () => {
    expect(rankForScores(population, 100, "desc")).toBe(1);
    expect(rankForScores(population, 90, "desc")).toBe(2); // one (100) is better
    expect(rankForScores(population, 50, "desc")).toBe(4); // 100, 90, 90 better
    expect(rankForScores(population, 200, "desc")).toBe(1);
  });

  it("asc: rank is 1 + count of strictly-smaller scores", () => {
    expect(rankForScores(population, 50, "asc")).toBe(1);
    expect(rankForScores(population, 90, "asc")).toBe(2); // only 50 is better
    expect(rankForScores(population, 100, "asc")).toBe(4); // 50, 90, 90 better
    expect(rankForScores(population, 10, "asc")).toBe(1);
  });

  it("treats equal scores as a tie sharing the leading rank", () => {
    expect(rankForScores([90, 90], 90, "desc")).toBe(1);
  });
});

describe("assignRanks", () => {
  it("sorts then numbers entries 1..N, projecting to ScoreEntry", () => {
    const entries: RankInput[] = [
      { handle: "A", score: 10, createdAt: 1000, id: 1 },
      { handle: "B", score: 30, createdAt: 1001, id: 2 },
      { handle: "C", score: 30, createdAt: 1000, id: 3 },
    ];
    expect(assignRanks(entries, "desc")).toEqual([
      { rank: 1, handle: "C", score: 30 }, // tie with B, but earlier createdAt
      { rank: 2, handle: "B", score: 30 },
      { rank: 3, handle: "A", score: 10 },
    ]);
  });

  it("does not mutate the input array", () => {
    const entries: RankInput[] = [
      { handle: "A", score: 1 },
      { handle: "B", score: 2 },
    ];
    const before = entries.map((e) => e.handle);
    assignRanks(entries, "desc");
    expect(entries.map((e) => e.handle)).toEqual(before);
  });

  it("defaults to desc ordering", () => {
    const entries: RankInput[] = [
      { handle: "low", score: 1 },
      { handle: "high", score: 2 },
    ];
    expect(assignRanks(entries).map((e) => e.handle)).toEqual(["high", "low"]);
  });
});
