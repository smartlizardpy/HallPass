/**
 * Tests for the store factory. A FAKE `sql` — a function matching the
 * tagged-template signature `(strings, ...values)` — records every call and
 * returns canned rows, so we can assert both the JS-side mapping and that the
 * correct whitelisted query BRANCH (sort/period) was selected without a real
 * database. The fake also lets us prove `appendScore`'s zero-rows-means-
 * rate-limited contract.
 */

import { describe, it, expect } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createStore } from "./store";

interface RecordedCall {
  text: string;
  values: unknown[];
}

/**
 * Build a fake `sql` tagged-template function. `responder` decides the rows for
 * each call (it sees the assembled static SQL text and the bound values). The
 * cast mirrors how the real `neon()` function is consumed: as a tag only.
 */
function makeFakeSql(responder: (call: RecordedCall) => Record<string, unknown>[]) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { text: strings.join("?"), values };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("createBoard", () => {
  it("maps the returned row and reports created:true for a fresh insert", async () => {
    const { sql, calls } = makeFakeSql(() => [
      {
        slug: "neon-snake",
        title: "Neon Snake",
        sort: "desc",
        score_label: "Voltage",
        max_score: "9000",
        created: true,
      },
    ]);
    const store = createStore(sql);
    const result = await store.createBoard({ slug: "neon-snake", title: "Neon Snake" });

    expect(result.created).toBe(true);
    expect(result.board).toEqual({
      slug: "neon-snake",
      title: "Neon Snake",
      sort: "desc",
      scoreLabel: "Voltage",
      maxScore: 9000,
    });
    // Idempotent upsert wired through ON CONFLICT.
    expect(calls[0].text).toContain("ON CONFLICT (slug) DO UPDATE");
    expect(calls[0].text).toContain("(xmax = 0) AS created");
  });

  it("reports created:false for an idempotent update and defaults maxScore to null", async () => {
    const { sql } = makeFakeSql(() => [
      {
        slug: "silence",
        title: "Silence",
        sort: "asc",
        score_label: "Score",
        max_score: null,
        created: false,
      },
    ]);
    const store = createStore(sql);
    const result = await store.createBoard({ slug: "silence", title: "Silence", sort: "asc" });

    expect(result.created).toBe(false);
    expect(result.board.sort).toBe("asc");
    expect(result.board.maxScore).toBeNull();
  });
});

describe("getBoard", () => {
  it("returns null when no row exists", async () => {
    const { sql } = makeFakeSql(() => []);
    const store = createStore(sql);
    expect(await store.getBoard("missing")).toBeNull();
  });
});

describe("getTopScores", () => {
  it("assigns positional ranks 1..N and coerces bigint scores via Number()", async () => {
    const { sql } = makeFakeSql(() => [
      { handle: "AAA", score: "300" },
      { handle: "BBB", score: "200" },
      { handle: "CCC", score: "100" },
    ]);
    const store = createStore(sql);
    const scores = await store.getTopScores("neon-snake", {
      limit: 10,
      period: "all",
      sort: "desc",
    });

    expect(scores).toEqual([
      { rank: 1, handle: "AAA", score: 300 },
      { rank: 2, handle: "BBB", score: 200 },
      { rank: 3, handle: "CCC", score: 100 },
    ]);
  });

  it("selects the desc + all-time branch (no interval, score DESC)", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createStore(sql);
    await store.getTopScores("g", { limit: 5, period: "all", sort: "desc" });

    expect(calls[0].text).toContain("ORDER BY score DESC");
    expect(calls[0].text).not.toContain("make_interval");
    expect(calls[0].values).toEqual(["g", 5]);
  });

  it("selects the asc + week branch (1-week interval, score ASC)", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createStore(sql);
    await store.getTopScores("g", { limit: 3, period: "week", sort: "asc" });

    expect(calls[0].text).toContain("ORDER BY score ASC");
    expect(calls[0].text).toContain("make_interval(0, 0, 1)");
    expect(calls[0].values).toEqual(["g", 3]);
  });

  it("selects the desc + day branch (1-day interval)", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createStore(sql);
    await store.getTopScores("g", { limit: 10, period: "day", sort: "desc" });

    expect(calls[0].text).toContain("ORDER BY score DESC");
    expect(calls[0].text).toContain("make_interval(0, 0, 0, 1)");
  });
});

describe("rankForScore", () => {
  it("desc: counts strictly-greater scores and adds 1", async () => {
    const { sql, calls } = makeFakeSql(() => [{ better: 4 }]);
    const store = createStore(sql);
    expect(await store.rankForScore("g", 50, "desc")).toBe(5);
    expect(calls[0].text).toContain("score >");
  });

  it("asc: counts strictly-smaller scores and adds 1", async () => {
    const { sql, calls } = makeFakeSql(() => [{ better: 0 }]);
    const store = createStore(sql);
    expect(await store.rankForScore("g", 50, "asc")).toBe(1);
    expect(calls[0].text).toContain("score <");
  });
});

describe("appendScore", () => {
  it("returns rate-limited when the insert CTE wrote nothing (zero rows)", async () => {
    const { sql } = makeFakeSql(() => []);
    const store = createStore(sql);
    const result = await store.appendScore(
      "g",
      { handle: "ME", score: 100, ipHash: "abc" },
      "desc",
    );
    expect(result).toEqual({ ok: false, reason: "rate-limited" });
  });

  it("returns the new rank when a row was inserted", async () => {
    const { sql, calls } = makeFakeSql(() => [{ rank: "7" }]);
    const store = createStore(sql);
    const result = await store.appendScore(
      "g",
      { handle: "ME", score: 100, ipHash: "abc" },
      "desc",
    );

    expect(result).toEqual({ ok: true, rank: 7 });
    // The single statement carries the rate-limit CTE, the guarded insert,
    // and the desc rank subquery, with all dynamic data bound as values.
    expect(calls[0].text).toContain("WITH recent AS");
    expect(calls[0].text).toContain("INSERT INTO scores");
    expect(calls[0].text).toContain("score >");
    expect(calls[0].values).toContain("g");
    expect(calls[0].values).toContain("ME");
    expect(calls[0].values).toContain(100);
    expect(calls[0].values).toContain("abc");
  });

  it("uses the asc rank subquery for ascending boards", async () => {
    const { sql, calls } = makeFakeSql(() => [{ rank: "1" }]);
    const store = createStore(sql);
    await store.appendScore("g", { handle: "ME", score: 10, ipHash: "abc" }, "asc");
    expect(calls[0].text).toContain("score <");
  });

  it("honours a custom rate-limit window in the bound values", async () => {
    const { sql, calls } = makeFakeSql(() => [{ rank: "1" }]);
    const store = createStore(sql);
    await store.appendScore(
      "g",
      { handle: "ME", score: 10, ipHash: "abc" },
      "desc",
      { maxPerWindow: 5, windowSeconds: 30 },
    );
    expect(calls[0].values).toContain(5);
    expect(calls[0].values).toContain(30);
  });
});
