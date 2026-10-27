import { describe, expect, it } from "vitest";
import { FRIGHT_FEST_2026 as C } from "./fright-fest-2026";
import { buildStandings, compareRuns, pointsForRank, rankBoard, toPublicStandings, type BestRun } from "./standings";
import type { GameState } from "./types";

const LB = C.games[0];
const SC = C.games[1];
const ST = C.games[2];

let nextId = 1;
const run = (game: string, player: string, score: number, tiebreak: number | null = null, at = "2026-10-29T12:00:00Z"): BestRun => ({
  runId: nextId++,
  gameSlug: game,
  playerId: `g-${player}`,
  publicId: `pub-${player}`,
  name: player,
  avatar: `/avatars/x.png`,
  score,
  tiebreak,
  submittedAt: at,
});

const open = (slug: string, at = "2026-10-28T00:00:00Z"): GameState => ({ slug, status: "open", openedAt: at });
const pending = (slug: string): GameState => ({ slug, status: "pending", openedAt: null });

describe("Fright Points", () => {
  it("follows the published table", () => {
    expect([1, 2, 3, 4, 5, 6, 10, 11, 50].map((r) => pointsForRank(C.points, r))).toEqual([100, 80, 65, 40, 40, 20, 20, 5, 5]);
    expect(pointsForRank(C.points, 0)).toBe(0);
  });
  it("gives every board the same maximum", () => {
    expect(Math.max(...C.points.byRank)).toBe(100);
  });
});

describe("per-board ranking", () => {
  it("orders by the metric, then tiebreak, then earlier receipt, then run id", () => {
    const cmp = compareRuns(LB.metric);
    const a = run("last-bell", "a", 300, 180.5, "2026-10-29T10:00:00Z");
    const b = run("last-bell", "b", 300, 180.2, "2026-10-29T11:00:00Z");
    const c = run("last-bell", "c", 300, 180.2, "2026-10-29T10:30:00Z");
    const d = run("last-bell", "d", 301, null);
    expect([a, b, c, d].sort(cmp).map((r) => r.name)).toEqual(["d", "c", "b", "a"]);
  });

  it("puts a missing tiebreak last and handles ascending metrics", () => {
    const cmp = compareRuns(SC.metric);
    const fast = run("x", "fast", 100_000, null);
    const slowNoDeaths = run("x", "slow", 120_000, 0);
    const fastFewerDeaths = run("x", "fast2", 100_000, 2);
    expect([slowNoDeaths, fast, fastFewerDeaths].sort(cmp).map((r) => r.name)).toEqual(["fast2", "fast", "slow"]);
  });

  it("keeps one best run per player and never shares a rank", () => {
    const entries = rankBoard(LB.metric, C.points, [
      run("last-bell", "a", 200, 280),
      run("last-bell", "a", 310, 170),
      run("last-bell", "b", 310, 170.5),
    ]);
    expect(entries.map((e) => [e.name, e.rank, e.score, e.points])).toEqual([
      ["a", 1, 310, 100],
      ["b", 2, 310, 80],
    ]);
  });

  it("is independent of input order", () => {
    const runs = [run("last-bell", "a", 1, 1), run("last-bell", "b", 2, 1), run("last-bell", "c", 2, 0)];
    const one = rankBoard(LB.metric, C.points, runs).map((e) => e.name);
    const two = rankBoard(LB.metric, C.points, [...runs].reverse()).map((e) => e.name);
    expect(one).toEqual(two);
  });
});

describe("overall table", () => {
  it("only counts opened boards; pending boards show no ranks", () => {
    const s = buildStandings(C, "live", [open("last-bell"), pending(SC.slug), pending(ST.slug)], [
      run("last-bell", "a", 300, 180),
      run(SC.slug, "a", 100_000, 0), // a stray run on a pending board never counts
    ]);
    expect(s.boards.map((b) => [b.slug, b.counting, b.entries.length])).toEqual([
      ["last-bell", true, 1],
      [SC.slug, false, 0],
      [ST.slug, false, 0],
    ]);
    expect(s.overall[0]).toMatchObject({ name: "a", points: 100, eligible: true, missing: [] });
    expect(s.championPublicId).toBe("pub-a");
    expect(s.lineupFinal).toBe(false);
  });

  it("requires a result on every counting board to be eligible", () => {
    const s = buildStandings(C, "live", [open("last-bell"), open(SC.slug), pending(ST.slug)], [
      run("last-bell", "solo", 400, 80), // 1st LB: 100, nothing on SC
      run("last-bell", "both", 300, 180), // 2nd LB: 80
      run(SC.slug, "both", 100_000, 0), // 1st SC: 100
    ]);
    expect(s.overall.map((o) => [o.name, o.points, o.eligible, o.missing])).toEqual([
      ["both", 180, true, []],
      ["solo", 100, false, [SC.slug]],
    ]);
    expect(s.championPublicId).toBe("pub-both");
  });

  it("is not won by the top of the table if they are ineligible", () => {
    const s = buildStandings(C, "live", [open("last-bell"), open(SC.slug), pending(ST.slug)], [
      run("last-bell", "a", 400, 80),
      run(SC.slug, "x", 90_000, 0),
      run("last-bell", "b", 100, 380),
      run(SC.slug, "b", 300_000, 9),
    ]);
    // a: 100 (one board), x: 100 (one board), b: 80 + 80 = 160 (both) → b leads and is champion.
    expect(s.overall[0].name).toBe("b");
    expect(s.championPublicId).toBe("pub-b");
  });

  it("breaks ties: more boards, then better placings, then who got there first, then public id", () => {
    const games = [open("last-bell"), open(SC.slug), open(ST.slug)];
    // p and q: 1st + 3rd + 3rd-ish combinations engineered to equal totals.
    const s = buildStandings(C, "live", games, [
      // LB: p 1st (100), q 2nd (80), r 3rd (65)
      run("last-bell", "p", 400, 1, "2026-10-29T10:00:00Z"),
      run("last-bell", "q", 300, 1, "2026-10-29T10:00:00Z"),
      run("last-bell", "r", 200, 1, "2026-10-29T10:00:00Z"),
      // SC: q 1st (100), p 2nd (80), r 3rd (65)
      run(SC.slug, "q", 100_000, 0, "2026-10-29T10:00:00Z"),
      run(SC.slug, "p", 110_000, 0, "2026-10-29T10:00:00Z"),
      run(SC.slug, "r", 120_000, 0, "2026-10-29T10:00:00Z"),
      // ST: r 1st (100), then p 2nd (80) at 12:00, q 3rd (65) at 11:00
      run(ST.slug, "r", 1200, 10, "2026-10-29T10:00:00Z"),
      run(ST.slug, "p", 1000, 10, "2026-10-29T12:00:00Z"),
      run(ST.slug, "q", 900, 10, "2026-10-29T11:00:00Z"),
    ]);
    // p: 100+80+80 = 260; q: 80+100+65 = 245; r: 65+65+100 = 230
    expect(s.overall.map((o) => [o.name, o.points])).toEqual([
      ["p", 260],
      ["q", 245],
      ["r", 230],
    ]);

    // Equal points, equal placings → earlier "reached" wins; then public id.
    const tie = buildStandings(C, "live", [open("last-bell"), open(SC.slug)], [
      run("last-bell", "late", 400, 1, "2026-10-30T10:00:00Z"),
      run(SC.slug, "late", 200_000, 0, "2026-10-30T10:00:00Z"),
      run("last-bell", "early", 300, 1, "2026-10-29T10:00:00Z"),
      run(SC.slug, "early", 100_000, 0, "2026-10-29T10:00:00Z"),
    ]);
    // late: LB 1st (100) + SC 2nd (80) = 180; early: LB 2nd (80) + SC 1st (100) = 180; placings [1,2] both.
    expect(tie.overall.map((o) => o.name)).toEqual(["early", "late"]);
  });

  it("drops a withdrawn board from points and eligibility", () => {
    const s = buildStandings(C, "live", [open("last-bell"), { slug: SC.slug, status: "withdrawn", openedAt: "2026-10-29T00:00:00Z" }, pending(ST.slug)], [
      run("last-bell", "a", 300, 1),
      run(SC.slug, "b", 100_000, 0),
    ]);
    expect(s.overall.map((o) => o.name)).toEqual(["a"]);
    expect(s.overall[0].eligible).toBe(true);
  });

  it("has a final lineup once nothing is pending or the window has closed", () => {
    const g = [open("last-bell"), pending(SC.slug), pending(ST.slug)];
    expect(buildStandings(C, "live", g, []).lineupFinal).toBe(false);
    expect(buildStandings(C, "closed", g, []).lineupFinal).toBe(true);
    expect(buildStandings(C, "live", [open("last-bell"), open(SC.slug), { slug: ST.slug, status: "withdrawn", openedAt: null }], []).lineupFinal).toBe(true);
  });

  it("is an honest empty state with no runs", () => {
    const s = buildStandings(C, "live", [open("last-bell")], []);
    expect(s.overall).toEqual([]);
    expect(s.championPublicId).toBeNull();
  });
});

describe("toPublicStandings", () => {
  it("never lets an internal player id or run id out", () => {
    const s = buildStandings(C, "live", [open("last-bell")], [run("last-bell", "a", 300, 1), run("last-bell", "b", 200, 1)]);
    const json = JSON.stringify(toPublicStandings(s, { board: 25, overall: 50 }));
    expect(json).not.toMatch(/playerId|runId|g-a|g-b/);
    expect(json).toMatch(/pub-a/);
  });
  it("counts a pending game but never names it", () => {
    const s = buildStandings(C, "live", [open("last-bell")], [run("last-bell", "a", 300, 1)]);
    const p = toPublicStandings(s, { board: 25, overall: 50 });
    expect(p.boards.map((b) => b.slug)).toEqual(["last-bell"]);
    expect(p.pendingGames).toBe(2);
    expect(JSON.stringify(p)).not.toMatch(/scp|lockdown|haunting|survive|Blood Moon/i);
  });
  it("ignores a stored game row the config no longer lists (the retired shadow-core row)", () => {
    const stale = pending("shadow-core-halloween-dash");
    const s = buildStandings(C, "live", [open("last-bell"), stale], [run("last-bell", "a", 300, 1)]);
    expect(s.boards.map((b) => b.slug)).toEqual(C.games.map((g) => g.slug));
    expect(s.lineupFinal).toBe(false);
    expect(JSON.stringify(toPublicStandings(s, { board: 25, overall: 50 }))).not.toMatch(/shadow/i);
    // Once every configured game has moved on, a stale pending row must not hold the lineup open.
    const opened = buildStandings(C, "live", [...C.games.map((g) => open(g.slug)), stale], []);
    expect(opened.lineupFinal).toBe(true);
  });
  it("applies the limits", () => {
    const s = buildStandings(C, "live", [open("last-bell")], [run("last-bell", "a", 3, 1), run("last-bell", "b", 2, 1), run("last-bell", "c", 1, 1)]);
    const p = toPublicStandings(s, { board: 2, overall: 1 });
    expect(p.boards[0].entries).toHaveLength(2);
    expect(p.overall).toHaveLength(1);
  });
});
