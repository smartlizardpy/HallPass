/**
 * The candy store's SQL against a REAL Postgres — opt-in, because it needs a
 * database with migrations 048, 049 and 050 applied. The fake-`sql` tests in
 * store.test.ts check statement shape; this one proves the properties that only a
 * real database can: concurrent spends cannot overspend, one request id buys once,
 * sync is idempotent, a revocation lowers the balance, and an expired window
 * refuses.
 *
 *   CANDY_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/candy/store.db.test.ts
 *
 * Refuses to run when DATABASE_URL is the same endpoint as PROD_DATABASE_URL.
 * It creates its own players, achievements and a private test championship (never
 * `fright-fest-2026`), and deletes all of it afterwards.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { CANDY_FRIGHT_FEST_2026, type CandyConfig } from "./fright-fest-2026";
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
  const ids: Record<string, number> = {};
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
  const unlock = (playerId: string, achievementId: number) =>
    sql`INSERT INTO player_achievements (player_id, achievement_id, progress, unlocked_at) VALUES (${playerId}, ${achievementId}, 1, now())`;
  const ledger = async (playerId: string) =>
    (await sql`SELECT kind, amount, ref, revoked_at, revoked_by, award_key, player_pack_id FROM candy_ledger WHERE player_id = ${playerId} AND event_id = ${event} ORDER BY id`) as Record<string, unknown>[];
  const packCount = async (playerId: string) =>
    Number((await sql`SELECT count(*)::int AS n FROM player_packs WHERE player_id = ${playerId}`)[0].n);

  beforeAll(async () => {
    p1Public = await player(p1);
    p2Public = await player(p2);
    await player(p3);
    const ach = async (key: string, candy: number) =>
      Number((await sql`INSERT INTO achievements (slug, key, name, candy) VALUES (${slug}, ${key}, ${"Test " + key}, ${candy}) RETURNING id`)[0].id);
    ids.a = await ach("a", 10);
    ids.b = await ach("b", 0);
    ids.big = await ach("big", 40);
    ids.old = await ach("old", 30);
    await sql`INSERT INTO championship_events (id) VALUES (${event})`;
    await sql`INSERT INTO championship_games (event_id, game_slug, status, opened_at) VALUES (${event}, 'g1', 'open', now() - interval '1 day'), (${event}, 'g2', 'open', now() - interval '1 day'), (${event}, 'g3', 'pending', NULL)`;
  });

  afterAll(async () => {
    await sql`DELETE FROM players WHERE id = ANY(${[p1, p2, p3]}::text[])`;
    await sql`DELETE FROM championship_events WHERE id = ${event}`;
    await sql`DELETE FROM achievements WHERE slug = ${slug}`;
    await sql`DELETE FROM candy_log WHERE actor_email = ${actor}`;
  });

  it("credits an achievement once, and a repeat sync pays nothing", async () => {
    await unlock(p1, ids.a);
    await unlock(p1, ids.b); // rated 0: pays nothing yet
    expect(await store.sync(p1)).toEqual({ credited: 1, amount: 10 });
    expect(await store.sync(p1)).toEqual({ credited: 0, amount: 0 });
    // two syncs at once also pay once
    await Promise.all([store.sync(p1), store.sync(p1), store.sync(p1)]);
    expect(await store.balance(p1)).toBe(10);
    expect((await ledger(p1)).map((r) => r.kind)).toEqual(["achievement"]);
  });

  it("rating an achievement after the unlock still pays; a later change never re-prices", async () => {
    expect(await store.setAchievementCandy({ achievementId: ids.b, candy: 5, actorEmail: actor })).toBe("changed");
    expect(await store.setAchievementCandy({ achievementId: ids.b, candy: 5, actorEmail: actor })).toBe("unchanged");
    expect(await store.sync(p1)).toEqual({ credited: 1, amount: 5 });
    await store.setAchievementCandy({ achievementId: ids.a, candy: 40, actorEmail: actor });
    expect(await store.sync(p1)).toEqual({ credited: 0, amount: 0 });
    expect(await store.balance(p1)).toBe(15);
    await expect(store.setAchievementCandy({ achievementId: ids.a, candy: 41, actorEmail: actor })).rejects.toThrow();
    await store.setAchievementCandy({ achievementId: ids.a, candy: 10, actorEmail: actor });
    const log = await sql`SELECT count(*)::int AS n FROM candy_log WHERE actor_email = ${actor} AND action = 'set-value'`;
    expect(Number(log[0].n)).toBe(3);
  });

  it("an unlock outside the window pays nothing", async () => {
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
    await unlock(p2, ids.old); // 30 candy: exactly one standard pack
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
    await unlock(p3, ids.big); // 40
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
    const id = Number((await sql`SELECT id FROM candy_ledger WHERE player_id = ${p3} AND kind = 'achievement'`)[0].id);
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

  it("reads history and the admin lists without leaking private player columns", async () => {
    const history = await store.history(p1, 50);
    expect(history.length).toBeGreaterThan(3);
    expect(history.find((h) => h.kind === "achievement")?.achievementName).toMatch(/^Test /);
    const feed = await store.listRecent(200);
    const mine = feed.filter((r) => r.player.publicId === p1Public);
    expect(mine.length).toBeGreaterThan(3);
    expect(JSON.stringify(feed)).not.toMatch(/candy-test-p\d-/);
    const list = await store.listAchievements(slug);
    expect(list.map((a) => a.key).sort()).toEqual(["a", "b", "big", "old"]);
    expect(list.find((a) => a.key === "a")?.unlockedInWindow).toBe(1);
    const stats = await store.stats();
    expect(stats.credited).toBeGreaterThan(0);
  });
});
