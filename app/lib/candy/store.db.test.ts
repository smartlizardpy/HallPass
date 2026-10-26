/**
 * The candy store's SQL against a REAL Postgres — opt-in, because it needs a
 * database with migrations 048, 049 and 050 applied. The fake-`sql` tests in
 * store.test.ts check statement shape; this one proves the properties that only a
 * real database can: concurrent spends cannot overspend, one request id buys once,
 * sync is idempotent, a revocation lowers the balance, an expired window
 * refuses, and the daily-best rules hold (one credit per player, board and UK day,
 * paid by the rank the score held when it was set, on the event's own board).
 *
 *   CANDY_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/candy/store.db.test.ts
 *
 * Refuses to run when DATABASE_URL is the same endpoint as PROD_DATABASE_URL.
 * It creates its own players, boards, scores and a private test championship
 * (never `fright-fest-2026`), and deletes all of it afterwards.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { CANDY_FRIGHT_FEST_2026, dailyBestAmount, type CandyConfig } from "./fright-fest-2026";
import { createCandyStore } from "./store";

const url = process.env.DATABASE_URL ?? "";
const endpoint = (u: string) => {
  try {
    return new URL(u).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return "";
  }
};
const isProd = !!process.env.PROD_DATABASE_URL && endpoint(url) === endpoint(process.env.PROD_DATABASE_URL);
const enabled = process.env.CANDY_DB_TEST === "1" && !!url && !isProd;

describe.skipIf(!enabled)("candy store against Postgres", () => {
  const sql = neon(enabled ? url : "postgres://skipped@localhost/skipped");
  const tag = randomBytes(4).toString("hex");
  const event = `candy-test-${tag}`;
  const slug = `candy-test-${tag}`;
  const actor = `candy-db-test-${tag}@example.invalid`;
  const config: CandyConfig = {
    ...CANDY_FRIGHT_FEST_2026,
    id: event,
    opensAt: "2020-01-01T00:00:00Z",
    closesAt: "2099-01-01T00:00:00Z",
    spendUntil: "2099-02-01T00:00:00Z",
  };
  const store = createCandyStore(sql, config);
  const p1 = `candy-test-p1-${tag}`;
  const p2 = `candy-test-p2-${tag}`;
  const p3 = `candy-test-p3-${tag}`;
  const ids: Record<string, string> = {};
  // The window tests run in their own event, on a window in 2025 (in the past: only finished UK days pay), so they
  // never meet the wide one above.
  const slugW = `candy-testw-${tag}`;
  const eventW = `candy-testw-${tag}`;
  const configW: CandyConfig = { ...config, id: eventW, opensAt: "2025-10-28T00:00:00Z", closesAt: "2025-11-02T00:00:00Z" };
  const storeW = createCandyStore(sql, configW);
  const d = ["d1", "d2", "d3", "t1", "t2", "t3", "t4", "t5", "n1"].map((k) => `candy-test-${k}-${tag}`);
  const [d1, d2, d3, t1, t2, t3, t4, t5, n1] = d;
  let p1Public = "";
  let p2Public = "";

  const player = async (id: string) => {
    const rows = await sql`INSERT INTO players (id, email) VALUES (${id}, ${id + "@example.invalid"}) RETURNING public_id`;
    return String(rows[0].public_id);
  };
  const run = (playerId: string, game: string, status = "accepted") =>
    sql`
      INSERT INTO championship_runs (event_id, game_slug, player_id, token_hash, expires_at, submitted_at, status, score)
      VALUES (${event}, ${game}, ${playerId}, ${randomBytes(32).toString("hex")}, now() + interval '1 hour', now(), ${status}, 100)
    `;
  /**
   * A score row. `playerId` null is an anonymous, handle-only score. `at` null is this time yesterday, a finished
   * UK day, because only finished days pay a daily best.
   */
  const score = (board: string, playerId: string | null, value: number, at: string | null = null) =>
    sql`INSERT INTO scores (board_id, handle, score, player_id, created_at) VALUES (${board}, ${playerId ? "h-" + tag : "anon"}, ${value}, ${playerId}, COALESCE(${at}::timestamptz, now() - interval '1 day'))`;
  const board = async (key: string, candy: number, sort: "asc" | "desc" = "desc", gameSlug = slug) => {
    const id = `${gameSlug}-${key}`;
    await sql`INSERT INTO boards (id, game_slug, title, sort, candy) VALUES (${id}, ${gameSlug}, ${"Test " + key}, ${sort}, ${candy})`;
    return id;
  };
  const dailyBest = async (playerId: string, eventId = event) =>
    (await sql`SELECT amount, ref, award_key FROM candy_ledger WHERE player_id = ${playerId} AND event_id = ${eventId} AND kind = 'daily_best' ORDER BY ref`) as Record<string, unknown>[];
  const ledger = async (playerId: string) =>
    (await sql`SELECT kind, amount, ref, revoked_at, revoked_by, award_key, player_pack_id FROM candy_ledger WHERE player_id = ${playerId} AND event_id = ${event} ORDER BY id`) as Record<string, unknown>[];
  const packCount = async (playerId: string) =>
    Number((await sql`SELECT count(*)::int AS n FROM player_packs WHERE player_id = ${playerId}`)[0].n);

  beforeAll(async () => {
    p1Public = await player(p1);
    p2Public = await player(p2);
    await player(p3);
    for (const id of d) await player(id);
    ids.a = await board("a", 10);
    ids.b = await board("b", 0);
    ids.big = await board("big", 40);
    ids.old = await board("old", 30);
    await sql`INSERT INTO championship_events (id) VALUES (${event})`;
    await sql`INSERT INTO championship_games (event_id, game_slug, status, opened_at) VALUES (${event}, 'g1', 'open', now() - interval '1 day'), (${event}, 'g2', 'open', now() - interval '1 day'), (${event}, 'g3', 'pending', NULL)`;
  });

  afterAll(async () => {
    await sql`DELETE FROM players WHERE id = ANY(${[p1, p2, p3, ...d]}::text[])`;
    await sql`DELETE FROM championship_events WHERE id = ${event}`;
    await sql`DELETE FROM boards WHERE game_slug = ANY(${[slug, slugW]}::text[])`;
    await sql`DELETE FROM candy_log WHERE actor_email = ${actor}`;
  });

  it("credits a daily best once, and a repeat sync pays nothing", async () => {
    await score(ids.a, p1, 100);
    await score(ids.b, p1, 100); // board rated 0: pays nothing yet
    expect(await store.sync(p1)).toEqual({ credited: 1, amount: 10 });
    expect(await store.sync(p1)).toEqual({ credited: 0, amount: 0 });
    // two syncs at once also pay once
    await Promise.all([store.sync(p1), store.sync(p1), store.sync(p1)]);
    expect(await store.balance(p1)).toBe(10);
    expect((await ledger(p1)).map((r) => r.kind)).toEqual(["daily_best"]);
  });

  it("rating a board after the score still pays; a later change never re-prices", async () => {
    expect(await store.setBoardCandy({ boardId: ids.b, candy: 5, actorEmail: actor })).toBe("changed");
    expect(await store.setBoardCandy({ boardId: ids.b, candy: 5, actorEmail: actor })).toBe("unchanged");
    expect(await store.sync(p1)).toEqual({ credited: 1, amount: 5 });
    await store.setBoardCandy({ boardId: ids.a, candy: 40, actorEmail: actor });
    expect(await store.sync(p1)).toEqual({ credited: 0, amount: 0 });
    expect(await store.balance(p1)).toBe(15);
    await expect(store.setBoardCandy({ boardId: ids.a, candy: 41, actorEmail: actor })).rejects.toThrow();
    expect(await store.setBoardCandy({ boardId: "no-such-board", candy: 3, actorEmail: actor })).toBe("not-found");
    await store.setBoardCandy({ boardId: ids.a, candy: 10, actorEmail: actor });
    const log = await sql`SELECT count(*)::int AS n FROM candy_log WHERE actor_email = ${actor} AND action = 'set-value'`;
    expect(Number(log[0].n)).toBe(3);
  });

  it("a score outside the window pays nothing", async () => {
    const early = createCandyStore(sql, { ...config, opensAt: "2098-01-01T00:00:00Z", closesAt: "2099-01-01T00:00:00Z" });
    expect(await early.sync(p1)).toEqual({ credited: 0, amount: 0 });
  });

  it("pays the first accepted run per counting board, and never the all-boards bonus from live boards", async () => {
    await run(p1, "g1");
    await run(p1, "g1"); // a second accepted run on the same board pays nothing more
    await run(p1, "g3"); // a pending board does not count
    expect(await store.sync(p1)).toEqual({ credited: 1, amount: 10 });
    expect(await store.balance(p1)).toBe(25);
    await run(p1, "g2");
    expect(await store.sync(p1)).toEqual({ credited: 1, amount: 10 }); // g2 run only: a run on every live board no longer pays the bonus
    expect(await store.sync(p1)).toEqual({ credited: 0, amount: 0 });
    expect(await store.balance(p1)).toBe(35);
    expect((await ledger(p1)).filter((r) => r.kind === "all_boards")).toHaveLength(0);
  });

  it("revokes a run credit when the board has no accepted run left, and restores it if one returns", async () => {
    await sql`UPDATE championship_runs SET status = 'disqualified' WHERE player_id = ${p1} AND game_slug = 'g2'`;
    await store.sync(p1);
    expect(await store.balance(p1)).toBe(25);
    const g2 = (await ledger(p1)).find((r) => r.ref === "g2")!;
    expect(g2.revoked_by).toBe("system");
    await sql`UPDATE championship_runs SET status = 'accepted' WHERE player_id = ${p1} AND game_slug = 'g2'`;
    await store.sync(p1);
    expect(await store.balance(p1)).toBe(35);
    expect((await ledger(p1)).find((r) => r.ref === "g2")!.revoked_at).toBeNull();
  });

  it("an admin revocation lowers the balance, is logged, stays revoked through a sync, and cannot touch a spend", async () => {
    const before = await store.balance(p1);
    const row = (await ledger(p1)).find((r) => r.kind === "ranked_run" && r.ref === "g1")!;
    const id = Number((await sql`SELECT id FROM candy_ledger WHERE award_key = ${String(row.award_key)}`)[0].id);
    expect(await store.revokeCredit({ ledgerId: id, actorEmail: actor, reason: "Test revocation" })).toBe(true);
    expect(await store.revokeCredit({ ledgerId: id, actorEmail: actor, reason: "Again" })).toBe(false);
    expect(await store.balance(p1)).toBe(before - 10);
    await store.sync(p1);
    expect(await store.balance(p1)).toBe(before - 10);
    const log = await store.readLog(50);
    expect(log.some((l) => l.action === "revoke-credit" && l.reason === "Test revocation")).toBe(true);
    expect((await store.listRecent(200)).some((r) => r.id === id && r.revokedBy === actor)).toBe(true);
  });

  it("two concurrent spends cannot overspend", async () => {
    await score(ids.old, p2, 100); // 30 candy: exactly one standard pack
    await store.sync(p2);
    expect(await store.balance(p2)).toBe(30);
    const req = () => randomBytes(8).toString("hex");
    const results = await Promise.all([
      store.spend(p2, "hpo-standard", req()),
      store.spend(p2, "inet-standard", req()),
      store.spend(p2, "brr-standard", req()),
    ]);
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.status === "insufficient")).toHaveLength(2);
    expect(await store.balance(p2)).toBe(0);
    expect(await packCount(p2)).toBe(1);
  });

  it("the same request id buys once, however many times it is sent", async () => {
    await score(ids.big, p3, 100); // 40
    await store.sync(p3);
    const requestId = randomBytes(8).toString("hex");
    const results = await Promise.all(Array.from({ length: 4 }, () => store.spend(p3, "tr-standard", requestId)));
    const ok = results.flatMap((r) => (r.status === "ok" ? [r] : []));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok.filter((r) => !r.alreadySpent)).toHaveLength(1);
    expect(new Set(ok.map((r) => r.packPublicId)).size).toBe(1);
    expect(await store.balance(p3)).toBe(10);
    expect(await packCount(p3)).toBe(1);
    // sent again later, still the same pack and the same balance
    const again = await store.spend(p3, "tr-standard", requestId);
    expect(again).toMatchObject({ status: "ok", alreadySpent: true, balance: 10 });
    // the same id for a different pack is a client bug, and buys nothing
    expect(await store.spend(p3, "tr-rare", requestId)).toEqual({ status: "bad-request" });
    expect(await packCount(p3)).toBe(1);
  });

  it("the bought pack is a normal sealed pack linked to its debit", async () => {
    const debit = (await ledger(p3)).find((r) => r.kind === "spend")!;
    expect(debit.amount).toBe(-30);
    expect(debit.ref).toBe("tr-standard");
    const packs = await sql`
      SELECT pp.id, pp.pack_id, pp.pack_version, pp.source, pp.source_ref, pp.grant_key, pp.opened_at, pp.revoked_at
      FROM player_packs pp WHERE pp.player_id = ${p3}
    `;
    expect(packs).toHaveLength(1);
    expect(Number(packs[0].id)).toBe(Number(debit.player_pack_id));
    expect(packs[0]).toMatchObject({ pack_id: "tr-standard", pack_version: 1, source: "event", opened_at: null, revoked_at: null });
    expect(packs[0].grant_key).toBe(debit.award_key);
  });

  it("a revoked credit that was already spent leaves a negative balance that blocks spending", async () => {
    const id = Number((await sql`SELECT id FROM candy_ledger WHERE player_id = ${p3} AND kind = 'daily_best'`)[0].id);
    expect(await store.revokeCredit({ ledgerId: id, actorEmail: actor, reason: "Farmed" })).toBe(true);
    expect(await store.balance(p3)).toBe(-30);
    expect(await store.spend(p3, "hpo-standard", randomBytes(8).toString("hex"))).toEqual({ status: "insufficient", balance: -30, price: 30 });
    const spendId = Number((await sql`SELECT id FROM candy_ledger WHERE player_id = ${p3} AND kind = 'spend'`)[0].id);
    expect(await store.revokeCredit({ ledgerId: spendId, actorEmail: actor, reason: "No" })).toBe(false);
  });

  it("refuses to spend after the window has closed, or before it opens", async () => {
    const expired = createCandyStore(sql, { ...config, spendUntil: "2021-01-01T00:00:00Z" });
    expect(await expired.spend(p1, "hpo-standard", randomBytes(8).toString("hex"))).toEqual({ status: "closed", reason: "expired" });
    const early = createCandyStore(sql, { ...config, opensAt: "2098-01-01T00:00:00Z" });
    expect(await early.spend(p1, "hpo-standard", randomBytes(8).toString("hex"))).toEqual({ status: "closed", reason: "not-open-yet" });
    expect(await packCount(p1)).toBe(0);
  });

  it("pays placings only once the championship is finalised, from the frozen snapshot, by rank", async () => {
    const before1 = await store.balance(p1);
    expect((await ledger(p1)).filter((r) => r.kind === "placing")).toHaveLength(0);
    const snapshot = {
      overall: [
        { publicId: p1Public, eligible: true },
        { publicId: p2Public, eligible: false },
      ],
      boards: [
        { slug: "g1", counting: true, entries: [{ rank: 1, publicId: p1Public }, { rank: 2, publicId: p2Public }] },
        { slug: "g2", counting: true, entries: [{ rank: 5, publicId: p1Public }] },
        { slug: "g3", counting: false, entries: [{ rank: 1, publicId: p1Public }] },
      ],
    };
    await sql`UPDATE championship_events SET status = 'verification' WHERE id = ${event}`;
    await store.sync(p1);
    expect(await store.balance(p1)).toBe(before1); // verification is not final
    expect((await ledger(p1)).filter((r) => r.kind === "all_boards")).toHaveLength(0);
    await sql`UPDATE championship_events SET status = 'finalised', final_standings = ${JSON.stringify(snapshot)}::jsonb, finalised_at = now() WHERE id = ${event}`;
    const before2 = await store.balance(p2);
    // 1st on g1 (40) + 5th on g2 (20) + the all-boards bonus (20, eligible in the snapshot); g3 does not count
    expect(await store.sync(p1)).toEqual({ credited: 3, amount: 80 });
    expect(await store.sync(p1)).toEqual({ credited: 0, amount: 0 });
    expect(await store.sync(p2)).toEqual({ credited: 1, amount: 30 }); // 2nd on g1
    expect(await store.balance(p1)).toBe(before1 + 80);
    expect((await ledger(p1)).filter((r) => r.kind === "all_boards")).toHaveLength(1);
    expect((await ledger(p2)).filter((r) => r.kind === "all_boards")).toHaveLength(0); // not eligible
    expect(await store.balance(p2)).toBe(before2 + 30);
    expect((await ledger(p2)).find((r) => r.kind === "placing")!.ref).toBe("g1#2");
  });

  it("pays a day only once it is over, so a sync during the day never locks in an early score", async () => {
    ids.today = await board("today", 10);
    await sql`INSERT INTO scores (board_id, handle, score, player_id, created_at) VALUES (${ids.today}, ${"h-" + tag}, 50, ${n1}, now())`;
    expect(await store.sync(n1)).toEqual({ credited: 0, amount: 0 }); // today is not over yet
    await score(ids.today, n1, 30); // yesterday: a finished day
    expect(await store.sync(n1)).toEqual({ credited: 1, amount: 10 });
    expect((await dailyBest(n1)).map((r) => r.award_key)).toHaveLength(1); // today's 50 still waits for midnight
  });

  describe("daily best, in a window of its own (28 Oct to 2 Nov 2025)", () => {
    const W = { hi: "", lo: "", anon: "", zero: "", pre: "", edge: "", tier40: "", tier2: "" };

    beforeAll(async () => {
      W.hi = await board("hi", 40, "desc", slugW);
      W.lo = await board("lo", 40, "asc", slugW);
      W.anon = await board("anon", 40, "desc", slugW);
      W.zero = await board("zero", 0, "desc", slugW);
      W.pre = await board("pre", 40, "desc", slugW);
      W.edge = await board("edge", 40, "desc", slugW);
      W.tier40 = await board("tier40", 40, "desc", slugW);
      W.tier2 = await board("tier2", 2, "desc", slugW);
    });

    it("pays two scores in one UK day once, at the best one's rank as of when it was set", async () => {
      await score(W.hi, d1, 100, "2025-10-29T09:00:00Z");
      await score(W.hi, d2, 300, "2025-10-29T08:00:00Z");
      await score(W.hi, d3, 400, "2025-10-29T12:00:00Z");
      await score(W.hi, d1, 350, "2025-10-29T15:00:00Z"); // d1's best of the day: 400 is better and earlier, so 2nd
      expect(await storeW.sync(d1)).toEqual({ credited: 1, amount: 30 });
      const rows = await dailyBest(d1, eventW);
      expect(rows).toHaveLength(1);
      expect(rows[0].ref).toBe(`${W.hi}#2025-10-29#2`);
      expect(rows[0].award_key).toBe(`candy:${eventW}:daily_best:${d1}:${W.hi}:2025-10-29`);
      expect(await storeW.sync(d1)).toEqual({ credited: 0, amount: 0 });
    });

    it("pays two different days twice", async () => {
      await score(W.hi, d1, 200, "2025-10-30T10:00:00Z"); // rows by then: 100, 300, 400, 350, 200: three are better, so 4th
      expect(await storeW.sync(d1)).toEqual({ credited: 1, amount: 20 });
      expect((await dailyBest(d1, eventW)).map((r) => [r.ref, r.amount])).toEqual([
        [`${W.hi}#2025-10-29#2`, 30],
        [`${W.hi}#2025-10-30#4`, 20],
      ]);
    });

    it("a later, better score by someone else never changes an existing credit", async () => {
      await score(W.hi, d2, 999, "2025-10-29T20:00:00Z");
      expect(await storeW.sync(d1)).toEqual({ credited: 0, amount: 0 });
      expect((await dailyBest(d1, eventW)).map((r) => r.amount)).toEqual([30, 20]);
      // and d2's own best of that day (999, rank 1 then) pays in full
      expect(await storeW.sync(d2)).toEqual({ credited: 1, amount: 40 });
    });

    it("ranks an asc board lowest first", async () => {
      await score(W.lo, d2, 40, "2025-10-29T09:00:00Z");
      await score(W.lo, d1, 50, "2025-10-29T10:00:00Z");
      await score(W.lo, d3, 60, "2025-10-29T11:00:00Z");
      for (const p of [d1, d2, d3]) await storeW.sync(p);
      const on = async (p: string) => (await dailyBest(p, eventW)).filter((r) => String(r.ref).startsWith(`${W.lo}#`)).map((r) => [r.ref, r.amount]);
      expect(await on(d2)).toEqual([[`${W.lo}#2025-10-29#1`, 40]]);
      expect(await on(d1)).toEqual([[`${W.lo}#2025-10-29#2`, 30]]);
      expect(await on(d3)).toEqual([[`${W.lo}#2025-10-29#3`, 30]]);
    });

    it("an anonymous score ranks but never earns", async () => {
      await score(W.anon, null, 900, "2025-10-29T08:00:00Z");
      await score(W.anon, d1, 800, "2025-10-29T09:00:00Z");
      await storeW.sync(d1);
      const rows = (await dailyBest(d1, eventW)).filter((r) => String(r.ref).startsWith(`${W.anon}#`));
      expect(rows.map((r) => [r.ref, r.amount])).toEqual([[`${W.anon}#2025-10-29#2`, 30]]); // pushed to 2nd by the anonymous row
      const all = await sql`SELECT count(*)::int AS n FROM candy_ledger WHERE event_id = ${eventW} AND ref LIKE ${W.anon + "#%"}`;
      expect(Number(all[0].n)).toBe(1);
    });

    it("a board at 0 pays nothing, and rating it later pays the earlier day on the next sync, without re-pricing", async () => {
      await score(W.zero, d1, 70, "2025-10-29T09:00:00Z");
      expect(await storeW.sync(d1)).toEqual({ credited: 0, amount: 0 });
      expect(await storeW.setBoardCandy({ boardId: W.zero, candy: 8, actorEmail: actor })).toBe("changed");
      expect(await storeW.sync(d1)).toEqual({ credited: 1, amount: 8 });
      await storeW.setBoardCandy({ boardId: W.zero, candy: 40, actorEmail: actor });
      expect(await storeW.sync(d1)).toEqual({ credited: 0, amount: 0 });
      expect((await dailyBest(d1, eventW)).filter((r) => String(r.ref).startsWith(`${W.zero}#`)).map((r) => r.amount)).toEqual([8]);
    });

    it("pays nothing for days outside the window", async () => {
      await score(W.edge, d1, 500, "2025-10-27T23:59:59Z"); // the second before opening
      await score(W.edge, d1, 500, "2025-11-02T00:00:00Z"); // closesAt is exclusive
      expect(await storeW.sync(d1)).toEqual({ credited: 0, amount: 0 });
    });

    it("ignores scores from before the event, even to rank: a strong old score does not push an in-window best down", async () => {
      await score(W.pre, d3, 100000, "2025-10-20T09:00:00Z"); // far better, but set before 28 Oct
      await score(W.pre, d1, 5, "2025-10-29T09:00:00Z");
      expect(await storeW.sync(d1)).toEqual({ credited: 1, amount: 40 }); // 1st on the Halloween board, not 2nd
      expect((await dailyBest(d1, eventW)).filter((r) => String(r.ref).startsWith(`${W.pre}#`)).map((r) => r.ref)).toEqual([`${W.pre}#2025-10-29#1`]);
      expect(await storeW.sync(d3)).toEqual({ credited: 0, amount: 0 }); // d3's in-window scores were paid already; the old 100000 pays nothing
    });

    it.each([
      { name: "a 40 board", key: "tier40", value: 40, amounts: [40, 30, 20, 10, 2] },
      { name: "a 2 board", key: "tier2", value: 2, amounts: [2, 2, 1, 1, 1] },
    ])("pays the tiers on $name: 1st, 2nd-3rd, 4th-10th, top half, elsewhere", async ({ key, value, amounts }) => {
      const id = W[key as "tier40" | "tier2"];
      await sql`
        INSERT INTO scores (board_id, handle, score, player_id, created_at)
        SELECT ${id}, 'anon', 1000 - i, NULL, '2025-10-28T01:00:00Z'::timestamptz + i * interval '1 minute' FROM generate_series(0, 23) AS i
      `;
      const subjects = [
        [t1, 2000, 1, 25], // better: none; 25 rows by then
        [t2, 1500, 2, 26], // better: 2000
        [t3, 995, 8, 27], // better: 2000, 1500 and the fillers 1000..996
        [t4, 990, 14, 28], // better: 13; ceil(28 / 2) = 14, so the top half
        [t5, 978, 27, 29], // better: 26; ceil(29 / 2) = 15, so elsewhere
      ] as const;
      for (const [i, [p, value2]] of subjects.entries()) await score(id, p, value2, `2025-10-30T10:0${i}:00Z`);
      for (const [i, [p, , rank, n]] of subjects.entries()) {
        await storeW.sync(p);
        const row = (await dailyBest(p, eventW)).find((r) => String(r.ref).startsWith(`${id}#`))!;
        expect(row.ref, p).toBe(`${id}#2025-10-30#${rank}`);
        expect(row.amount, p).toBe(amounts[i]);
        expect(dailyBestAmount(value, rank, n), p).toBe(amounts[i]); // the TypeScript rule and the SQL agree
      }
    }, 60_000);
  });

  it("reads history and the admin lists without leaking private player columns", async () => {
    const history = await store.history(p1, 50);
    expect(history.length).toBeGreaterThan(3);
    expect(history.find((h) => h.kind === "daily_best")?.gameSlug).toBe(slug);
    const feed = await store.listRecent(200);
    const mine = feed.filter((r) => r.player.publicId === p1Public);
    expect(mine.length).toBeGreaterThan(3);
    expect(mine.find((r) => r.kind === "daily_best")?.gameSlug).toBe(slug);
    expect(JSON.stringify(feed)).not.toMatch(/candy-test-p\d-/);
    const list = await store.listBoards(slug);
    expect(list.map((b) => b.id).sort()).toEqual(Object.values(ids).sort());
    expect(list.find((b) => b.id === ids.a)).toMatchObject({ candy: 10, sort: "desc", scoresInWindow: 1, playersInWindow: 1 });
    expect((await store.payingBoards()).some((b) => b.id === ids.a && b.candy === 10)).toBe(true);
    expect((await store.payingBoards()).some((b) => b.id === ids.b)).toBe(true); // rated 5 by now
    const top = await store.topEarners(100);
    const me = top.find((t) => t.player.publicId === p1Public)!;
    expect(me.credited).toBeGreaterThan(0);
    expect(me.dailyBestCount).toBeGreaterThanOrEqual(2);
    expect(me.bestRank).toBe(1);
    expect(me.dailyBestTotal).toBeLessThanOrEqual(me.credited);
    expect(JSON.stringify(top)).not.toMatch(/candy-test-p\d-/);
    const only = await store.listRecent(200, p1Public);
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((r) => r.player.publicId === p1Public)).toBe(true);
    const stats = await store.stats();
    expect(stats.credited).toBeGreaterThan(0);
  });
});
