/**
 * The scoreboard's SEASON FILTER against a REAL Postgres — opt-in, because it
 * needs a database with the scoreboard and social migrations applied. The
 * fake-`sql` tests in store.test.ts check statement shape; this one checks the
 * predicate actually means what it says when Postgres evaluates it against its
 * own `now()`.
 *
 *   SCOREBOARD_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/scoreboard/store.db.test.ts
 *
 * Refuses to run when DATABASE_URL is the same endpoint as PROD_DATABASE_URL.
 * `now()` cannot be moved, so the window is injectable (`createStore(sql,
 * { season })`) and the test builds one AROUND the present instant ("open"), and
 * one that ended an hour ago ("closed"). It creates a throwaway board and
 * players under a random tag and deletes them in `afterAll`; the board's scores
 * go with it by cascade.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { createStore } from "./store";
import type { Season } from "./season";

const url = process.env.DATABASE_URL ?? "";
const endpoint = (u: string) => {
  try {
    return new URL(u).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return "";
  }
};
const isProd =
  !!process.env.PROD_DATABASE_URL && endpoint(url) === endpoint(process.env.PROD_DATABASE_URL);
const enabled = process.env.SCOREBOARD_DB_TEST === "1" && !!url && !isProd;

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe.skipIf(!enabled)("scoreboard season filter against Postgres", () => {
  // The describe body runs even when skipped; never hand neon() an empty URL.
  const sql = neon(enabled ? url : "postgres://skipped@localhost/skipped");
  const open: Season = { id: "t-open", from: iso(-HOUR), until: iso(HOUR) };
  const closed: Season = { id: "t-closed", from: iso(-3 * HOUR), until: iso(-HOUR) };
  const openStore = createStore(sql, { season: open });
  const closedStore = createStore(sql, { season: closed });

  const tag = randomBytes(4).toString("hex");
  const board = `zz-season-${tag}`;
  const me = { id: `zz-season-${tag}-a-me`, handle: "Me" };
  const friend = { id: `zz-season-${tag}-b-friend`, handle: "Friend" };
  const guest = "SeasonGuest";

  async function score(who: string | null, value: number, createdAt: string) {
    await sql`
      INSERT INTO scores (board_id, handle, score, ip_hash, player_id, created_at)
      VALUES (${board}, ${who ?? guest}, ${value}, ${"zz-" + tag}, ${who}, ${createdAt})
    `;
  }

  beforeAll(async () => {
    await openStore.createBoard({ slug: board, gameSlug: board, title: "Season test", sort: "desc" });
    for (const p of [me, friend]) {
      await sql`INSERT INTO players (id, email, handle) VALUES (${p.id}, ${p.id + "@season-db-test.invalid"}, ${p.handle})`;
    }
    const [lo, hi] = me.id < friend.id ? [me.id, friend.id] : [friend.id, me.id];
    await sql`
      INSERT INTO friendships (player_a, player_b, status, requested_by, responded_at)
      VALUES (${lo}, ${hi}, 'accepted', ${me.id}, now())
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM boards WHERE id = ${board}`;
    await sql`DELETE FROM players WHERE id = ANY(${[me.id, friend.id]}::text[])`;
  });

  const top = (store: typeof openStore, seasonal: boolean) =>
    store.getTopScores(board, { limit: 10, period: "all", sort: "desc", seasonal });

  it("hides a pre-window score while the window is open, shows it outside", async () => {
    await score(null, 1000, iso(-5 * 24 * HOUR)); // a guest, long before the window
    await score(friend.id, 500, iso(-2 * HOUR)); // before `open.from`
    await score(friend.id, 20, iso(-HOUR / 2)); // inside
    await score(me.id, 10, iso(-HOUR / 4)); // inside

    expect((await top(openStore, true)).map((r) => r.score)).toEqual([20, 10]);
    // Outside the window (a season that has ended): all-time, nothing hidden.
    expect((await top(closedStore, true)).map((r) => r.score)).toEqual([1000, 500, 10]);
    // And an admin read (no `seasonal`) is all-time even while the window is open.
    expect((await top(openStore, false)).map((r) => r.score)).toEqual([1000, 500, 10]);
  });

  it("ranks a submit among in-window scores only", async () => {
    // In-window rows strictly better than 15: only the 20. So rank 2.
    const inSeason = await openStore.appendScore(
      board,
      { handle: guest, score: 15, ipHash: "zz-rank-" + tag },
      "desc",
    );
    expect(inSeason).toMatchObject({ ok: true, rank: 2 });
    // Same rows, season closed: 1000 and 500 count too, and so does the 20.
    expect(await closedStore.rankForScore(board, 15, "desc")).toBe(4);
    expect(await openStore.rankForScore(board, 15, "desc")).toBe(2);
  });

  it("the friends panel ignores pre-window scores", async () => {
    const seasonal = await openStore.getFriendStandingsForGame(me.id, board);
    const byId = Object.fromEntries(seasonal.map((r) => [r.isYou ? "me" : "friend", r]));
    expect(byId.friend.best).toBe(20);
    expect(byId.friend.rank).toBe(1);
    expect(byId.me.best).toBe(10);
    // Better than 10, in window: the friend's 20 and the guest's 15.
    expect(byId.me.rank).toBe(3);

    const allTime = await closedStore.getFriendStandingsForGame(me.id, board);
    expect(allTime.find((r) => !r.isYou)?.best).toBe(500);
  });

  it("'a friend passed you' ignores a friend whose best is pre-window", async () => {
    const other = `zz-season-${tag}-c-other`;
    await sql`INSERT INTO players (id, email, handle) VALUES (${other}, ${other + "@season-db-test.invalid"}, 'Other')`;
    try {
      const [lo, hi] = me.id < other ? [me.id, other] : [other, me.id];
      await sql`
        INSERT INTO friendships (player_a, player_b, status, requested_by, responded_at)
        VALUES (${lo}, ${hi}, 'accepted', ${me.id}, now())
      `;
      await score(other, 12, iso(-5 * 24 * HOUR)); // only a pre-window score
      const rows = await sql`
        INSERT INTO scores (board_id, handle, score, ip_hash, player_id)
        VALUES (${board}, 'Me', 30, ${"zz-" + tag}, ${me.id}) RETURNING id
      `;
      const id = Number(rows[0].id);
      const seasonal = await openStore.getFriendsNewlyPassed(me.id, board, 30, id, "desc");
      expect(seasonal.map((r) => r.playerId)).not.toContain(other);
      // All-time (season closed): `other`'s 12 is at or above my previous best (10) and below 30.
      const allTime = await closedStore.getFriendsNewlyPassed(me.id, board, 30, id, "desc");
      expect(allTime.map((r) => r.playerId)).toContain(other);
    } finally {
      await sql`DELETE FROM players WHERE id = ${other}`;
    }
  });
});
