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
        id: "neon-snake",
        game_slug: "neon-snake",
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
      gameSlug: "neon-snake",
      title: "Neon Snake",
      sort: "desc",
      scoreLabel: "Voltage",
      maxScore: 9000,
    });
    // Idempotent upsert wired through ON CONFLICT.
    expect(calls[0].text).toContain("ON CONFLICT (id) DO UPDATE");
    expect(calls[0].text).toContain("(xmax = 0) AS created");
  });

  it("reports created:false for an idempotent update and defaults maxScore to null", async () => {
    const { sql } = makeFakeSql(() => [
      {
        id: "silence",
        game_slug: null,
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
    expect(result.board.gameSlug).toBeNull();
  });

  it("round-trips gameSlug when a board is linked to a game", async () => {
    const { sql } = makeFakeSql(() => [
      {
        id: "nv-time-attack",
        game_slug: "neon-velocity-hyperdrive",
        title: "X",
        sort: "desc",
        score_label: "Score",
        max_score: null,
        created: true,
      },
    ]);
    const store = createStore(sql);
    const result = await store.createBoard({
      slug: "nv-time-attack",
      title: "X",
      gameSlug: "neon-velocity-hyperdrive",
    });

    expect(result.board.gameSlug).toBe("neon-velocity-hyperdrive");
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
    // Anonymous rows lack player_id -> verified:false, no avatar.
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
      { rank: 1, handle: "AAA", score: 300, verified: false },
      { rank: 2, handle: "BBB", score: 200, verified: false },
      { rank: 3, handle: "CCC", score: 100, verified: false },
    ]);
  });

  it("tags a verified entry from joined player columns (player_id + p_name)", async () => {
    // A row with player_id set maps to verified:true; the effective display falls
    // through p_handle -> p_name (here p_handle is null), and avatar = p_image.
    const { sql } = makeFakeSql(() => [
      {
        handle: "anon-fallback",
        score: "500",
        player_id: "google-sub-1",
        p_handle: null,
        p_name: "Ada Lovelace",
        p_image: "https://example.test/a.png",
      },
    ]);
    const store = createStore(sql);
    const scores = await store.getTopScores("neon-snake", {
      limit: 10,
      period: "all",
      sort: "desc",
    });

    expect(scores).toEqual([
      {
        rank: 1,
        handle: "Ada Lovelace",
        score: 500,
        verified: true,
        avatar: "https://example.test/a.png",
      },
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

  it("returns the accepted row id and rank when a row was inserted", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: "42", rank: "7" }]);
    const store = createStore(sql);
    const result = await store.appendScore(
      "g",
      { handle: "ME", score: 100, ipHash: "abc" },
      "desc",
    );

    // The ok-result now surfaces the RETURNING id (a claim token is minted from
    // it downstream), alongside the competition rank; both coerced via Number().
    expect(result).toEqual({ ok: true, id: 42, rank: 7 });
    // The single statement carries the rate-limit CTE, the guarded insert (which
    // now RETURNs its id), and the desc rank subquery, with all dynamic data bound.
    expect(calls[0].text).toContain("WITH recent AS");
    expect(calls[0].text).toContain("INSERT INTO scores");
    expect(calls[0].text).toContain("INSERT INTO scores (board_id");
    expect(calls[0].text).toContain("RETURNING id");
    expect(calls[0].text).toContain("ins.id AS id");
    expect(calls[0].text).toContain("score >");
    expect(calls[0].values).toContain("g");
    expect(calls[0].values).toContain("ME");
    expect(calls[0].values).toContain(100);
    expect(calls[0].values).toContain("abc");
  });

  it("binds the player_id column for a verified (signed-in) submission", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: "9", rank: "1" }]);
    const store = createStore(sql);
    const result = await store.appendScore(
      "g",
      { handle: "ME", score: 100, ipHash: "abc", playerId: "google-sub-1" },
      "desc",
    );

    expect(result).toEqual({ ok: true, id: 9, rank: 1 });
    expect(calls[0].text).toContain("player_id");
    expect(calls[0].values).toContain("google-sub-1");
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

describe("claimScores", () => {
  it("binds the playerId + score ids and returns the atomic CTE count", async () => {
    const { sql, calls } = makeFakeSql(() => [{ n: 2 }]);
    const store = createStore(sql);

    const claimed = await store.claimScores("google-sub-1", [10, 20]);

    expect(claimed).toBe(2);
    // One guarded UPDATE (skipping already-owned rows) wrapped in a count CTE.
    expect(calls[0].text).toContain("UPDATE scores SET player_id");
    expect(calls[0].text).toContain("player_id IS NULL");
    expect(calls[0].text).toContain("= ANY(");
    expect(calls[0].text).toContain("::bigint[]");
    expect(calls[0].text).toContain("count(*)::int AS n");
    // playerId then the ids array are the only bound values.
    expect(calls[0].values[0]).toBe("google-sub-1");
    expect(calls[0].values[1]).toEqual([10, 20]);
  });

  it("short-circuits an empty id list to 0 without querying", async () => {
    const { sql, calls } = makeFakeSql(() => [{ n: 99 }]);
    const store = createStore(sql);

    expect(await store.claimScores("google-sub-1", [])).toBe(0);
    // No statement is issued — the empty array never reaches the driver.
    expect(calls).toHaveLength(0);
  });
});

describe("moderation", () => {
  it("listScoresForModeration maps raw rows newest-first and binds boardId + limit", async () => {
    const { sql, calls } = makeFakeSql(() => [
      { id: "5", handle: "AAA", score: "300", created_at: "2026-01-01T00:00:00Z" },
    ]);
    const store = createStore(sql);
    const rows = await store.listScoresForModeration("neon-snake", 50);

    expect(rows).toEqual([
      { id: 5, handle: "AAA", score: 300, createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(calls[0].text).toContain("ORDER BY created_at DESC");
    expect(calls[0].values).toContain("neon-snake");
    expect(calls[0].values).toContain(50);
  });

  it("deleteScore returns true when a row matched and false when none did", async () => {
    const hit = makeFakeSql(() => [{ id: "5" }]);
    const hitStore = createStore(hit.sql);
    expect(await hitStore.deleteScore("g", 5)).toBe(true);
    expect(hit.calls[0].text).toContain("DELETE FROM scores");
    expect(hit.calls[0].text).toContain("board_id");

    const miss = makeFakeSql(() => []);
    const missStore = createStore(miss.sql);
    expect(await missStore.deleteScore("g", 999)).toBe(false);
  });

  it("clearBoardScores returns the atomic CTE count of deleted rows", async () => {
    const { sql, calls } = makeFakeSql(() => [{ n: 7 }]);
    const store = createStore(sql);
    expect(await store.clearBoardScores("g")).toBe(7);
    expect(calls[0].text).toContain("WITH del AS");
    expect(calls[0].text).toContain("DELETE FROM scores");
  });

  it("deleteBoard returns true when a board matched and false when none did", async () => {
    const hit = makeFakeSql(() => [{ id: "g" }]);
    const hitStore = createStore(hit.sql);
    expect(await hitStore.deleteBoard("g")).toBe(true);
    expect(hit.calls[0].text).toContain("DELETE FROM boards");
    expect(hit.calls[0].values).toContain("g");

    const miss = makeFakeSql(() => []);
    const missStore = createStore(miss.sql);
    expect(await missStore.deleteBoard("ghost")).toBe(false);
  });
});

describe("listBoardsForGame", () => {
  it("filters by game_slug (bound) and maps rows via mapBoard", async () => {
    const { sql, calls } = makeFakeSql(() => [
      {
        id: "nv-time-attack",
        game_slug: "neon-velocity-hyperdrive",
        title: "Time Attack",
        sort: "asc",
        score_label: "Seconds",
        max_score: null,
      },
    ]);
    const store = createStore(sql);
    const boards = await store.listBoardsForGame("neon-velocity-hyperdrive");

    expect(boards).toEqual([
      {
        slug: "nv-time-attack",
        gameSlug: "neon-velocity-hyperdrive",
        title: "Time Attack",
        sort: "asc",
        scoreLabel: "Seconds",
        maxScore: null,
      },
    ]);
    expect(calls[0].text).toContain("WHERE game_slug");
    expect(calls[0].values).toEqual(["neon-velocity-hyperdrive"]);
  });
});

describe("setBoardGame", () => {
  it("returns true when a board matched and binds gameSlug + boardId", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: "nv-time-attack" }]);
    const store = createStore(sql);
    expect(await store.setBoardGame("nv-time-attack", "neon-velocity-hyperdrive")).toBe(true);

    expect(calls[0].text).toContain("UPDATE boards SET game_slug");
    expect(calls[0].values).toEqual(["neon-velocity-hyperdrive", "nv-time-attack"]);
  });

  it("returns false when no board matched and accepts a null gameSlug (unlink)", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createStore(sql);
    expect(await store.setBoardGame("ghost", null)).toBe(false);
    expect(calls[0].values).toEqual([null, "ghost"]);
  });
});

describe("getPlayerStandings", () => {
  it("computes per-board best/rank via the CTE and coerces bigint egress", async () => {
    const { sql, calls } = makeFakeSql(() => [
      {
        board_id: "neon-snake",
        title: "Neon Snake",
        game_slug: "neon-snake",
        sort: "desc",
        best: "9000",
        rank: "1",
      },
      {
        board_id: "nv-time-attack",
        title: "Time Attack",
        game_slug: null,
        sort: "asc",
        best: "42",
        rank: "3",
      },
    ]);
    const store = createStore(sql);
    const standings = await store.getPlayerStandings("google-sub-1");

    expect(standings).toEqual([
      {
        boardId: "neon-snake",
        title: "Neon Snake",
        gameSlug: "neon-snake",
        sort: "desc",
        best: 9000,
        rank: 1,
      },
      {
        boardId: "nv-time-attack",
        title: "Time Attack",
        gameSlug: null,
        sort: "asc",
        best: 42,
        rank: 3,
      },
    ]);
    expect(calls[0].text).toContain("WITH mine AS");
    expect(calls[0].text).toContain("JOIN boards");
    expect(calls[0].values).toEqual(["google-sub-1"]);
  });
});
