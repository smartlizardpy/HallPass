/**
 * The referral store's SQL against a REAL Postgres — opt-in (see db-test-support.ts):
 *
 *   HALLPASS_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/referrals/store.db.test.ts
 *
 * Needs migrations 048 to 052. The fake-`sql` tests check statement shape; this
 * proves what only a database can: first touch holds, a returning player and a
 * self-referral are refused, a reward is paid once however many requests race,
 * the cap holds when friends qualify at the same moment, a flagged run does not
 * qualify, and a revoked payout keeps using its slot. It makes a private event
 * (never `fright-fest-2026`) and deletes everything it made.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { dbTestConnection, dbTestEnabled } from "../db-test-support";
import { REFERRAL_FRIGHT_FEST_2026, type ReferralConfig } from "./config";
import { createReferralStore } from "./store";

describe.skipIf(!dbTestEnabled)("referral store against Postgres", { timeout: 90_000 }, () => {
  const sql = neon(dbTestConnection);
  const tag = randomBytes(4).toString("hex");
  const event = `ref-test-${tag}`;
  const actor = `ref-db-test-${tag}@example.invalid`;
  const config: ReferralConfig = {
    ...REFERRAL_FRIGHT_FEST_2026,
    eventId: event,
    opensAt: "2020-01-01T00:00:00Z",
    closesAt: "2099-01-01T00:00:00Z",
  };
  const store = createReferralStore(sql, config);
  const made: string[] = [];

  const player = async (key: string, createdAt: string | null = null) => {
    const id = `ref-test-${key}-${tag}`;
    made.push(id);
    await sql`INSERT INTO players (id, email, created_at) VALUES (${id}, ${id + "@example.invalid"}, COALESCE(${createdAt}::timestamptz, now()))`;
    return id;
  };
  const run = (playerId: string, status = "accepted") =>
    sql`
      INSERT INTO championship_runs (event_id, game_slug, player_id, token_hash, expires_at, submitted_at, status, score)
      VALUES (${event}, 'g1', ${playerId}, ${randomBytes(32).toString("hex")}, now() + interval '1 hour', now(), ${status}, 100)
    `;
  const status = async (referredId: string) =>
    String((await sql`SELECT status FROM referrals WHERE event_id = ${event} AND referred_id = ${referredId}`)[0]?.status ?? "none");
  const credits = async (referrerId: string) =>
    (await sql`SELECT amount, revoked_at FROM candy_ledger WHERE player_id = ${referrerId} AND event_id = ${event} AND kind = 'referral' ORDER BY id`) as Record<string, unknown>[];
  const balance = async (id: string) =>
    Number((await sql`SELECT COALESCE(sum(amount), 0)::int AS b FROM candy_ledger WHERE player_id = ${id} AND event_id = ${event} AND revoked_at IS NULL`)[0].b);
  /** A friend who has landed on `token`, and (optionally) has an accepted run. */
  const friend = async (key: string, token: string, played = true) => {
    const id = await player(key);
    expect(await store.claim(id, token)).toBe("attributed");
    if (played) await run(id);
    return id;
  };

  beforeAll(async () => {
    await sql`INSERT INTO championship_events (id) VALUES (${event})`;
    await sql`INSERT INTO championship_games (event_id, game_slug, status, opened_at) VALUES (${event}, 'g1', 'open', now() - interval '1 day')`;
  });

  afterAll(async () => {
    await sql`DELETE FROM players WHERE id = ANY(${made}::text[])`;
    await sql`DELETE FROM championship_events WHERE id = ${event}`;
    await sql`DELETE FROM referral_settings WHERE event_id = ${event}`;
    await sql`DELETE FROM referral_counters WHERE event_id = ${event}`;
    await sql`DELETE FROM referral_log WHERE actor_email = ${actor}`;
    await sql`DELETE FROM candy_log WHERE actor_email = ${actor}`;
  });

  it("gives one stable, unguessable token per player, even when asked at once", async () => {
    const a = await player("code");
    const tokens = await Promise.all([store.getOrCreateCode(a), store.getOrCreateCode(a), store.getOrCreateCode(a)]);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toMatch(/^[0-9CDFGHJKMNPQRTVWXY]{12}$/);
    expect(tokens[0]).not.toContain(a);
  });

  it("counts visits and tallies, and refuses an unknown token", async () => {
    const a = await player("visit");
    const token = await store.getOrCreateCode(a);
    expect(await store.recordVisit(token)).toBe(true);
    expect(await store.recordVisit(token)).toBe(true);
    expect(await store.recordVisit("CCCCCCCCCCCC")).toBe(false);
    expect((await store.mine(a)).visits).toBe(2);
    await store.track("post_copy");
    await store.track("post_copy");
    expect((await store.stats()).counters.post_copy).toBe(2);
  });

  it("first touch wins; self-referral and returning players are refused", async () => {
    const a = await player("ft-a");
    const b = await player("ft-b");
    const ta = await store.getOrCreateCode(a);
    const tb = await store.getOrCreateCode(b);
    const f = await player("ft-friend");
    expect(await store.claim(f, ta)).toBe("attributed");
    expect(await store.claim(f, tb)).toBe("ignored"); // a later link never overwrites
    expect(Number((await sql`SELECT count(*)::int AS n FROM referrals WHERE event_id = ${event} AND referred_id = ${f}`)[0].n)).toBe(1);
    expect(String((await sql`SELECT referrer_id FROM referrals WHERE event_id = ${event} AND referred_id = ${f}`)[0].referrer_id)).toBe(a);
    expect(await store.claim(a, ta)).toBe("ignored"); // self
    const old = await player("ft-old", "2019-01-01T00:00:00Z");
    expect(await store.claim(old, ta)).toBe("returning");
    expect(await status(old)).toBe("ineligible");
    expect(await store.claim(await player("ft-bad"), "nope")).toBe("ignored");
  });

  it("pays nothing before a ranked run, and nothing for a flagged one", async () => {
    const a = await player("q-a");
    const t = await store.getOrCreateCode(a);
    const f = await friend("q-f", t, false);
    expect((await store.qualifyReferrer(a)).rewarded).toBe(0);
    await run(f, "flagged");
    expect((await store.qualifyReferrer(a)).rewarded).toBe(0);
    expect(await status(f)).toBe("pending");
    await run(f, "accepted");
    expect(await store.qualifyReferred(f)).toEqual({ rewarded: 1, amount: 10 });
    expect(await status(f)).toBe("rewarded");
    expect(await balance(a)).toBe(10);
  });

  it("pays once however many requests race", async () => {
    const a = await player("r-a");
    const t = await store.getOrCreateCode(a);
    const f = await friend("r-f", t);
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => store.qualifyReferred(f)));
    expect(results.reduce((n, r) => n + (r?.rewarded ?? 0), 0)).toBe(1);
    expect(await credits(a)).toHaveLength(1);
    expect((await store.qualifyReferrer(a)).rewarded).toBe(0);
    expect(await balance(a)).toBe(10);
  });

  it("holds the cap, and a race for the last slot has one winner", async () => {
    const small = createReferralStore(sql, { ...config, cap: 2 });
    await small.setSettings({ enabled: true, bonus: 10, cap: 2, actorEmail: actor });
    try {
      const a = await player("c-a");
      const t = await small.getOrCreateCode(a);
      const f1 = await friend("c-f1", t);
      const f2 = await friend("c-f2", t);
      const f3 = await friend("c-f3", t);
      const f4 = await friend("c-f4", t);
      // Four friends qualify at the same instant for two slots.
      await Promise.all([f1, f2, f3, f4].map((f) => small.qualifyReferred(f)));
      const states = await Promise.all([f1, f2, f3, f4].map(status));
      expect(states.filter((s) => s === "rewarded")).toHaveLength(2);
      expect(states.filter((s) => s === "capped")).toHaveLength(2);
      expect(await balance(a)).toBe(20);
      const me = await small.mine(a);
      expect(me).toMatchObject({ rewarded: 2, remaining: 0, candy: 20 });
      // A friend who arrives after the cap is still attributed and still plays, but pays nothing.
      const late = await friend("c-late", t);
      await small.qualifyReferred(late);
      expect(await status(late)).toBe("capped");
      expect(await balance(a)).toBe(20);
    } finally {
      await sql`DELETE FROM referral_settings WHERE event_id = ${event}`;
    }
  });

  it("pays the oldest runs first when several are owed", async () => {
    const small = createReferralStore(sql, { ...config, cap: 1 });
    await small.setSettings({ enabled: true, bonus: 10, cap: 1, actorEmail: actor });
    try {
      const a = await player("o-a");
      const t = await small.getOrCreateCode(a);
      const first = await friend("o-first", t, false);
      const second = await friend("o-second", t, false);
      await sql`INSERT INTO championship_runs (event_id, game_slug, player_id, token_hash, expires_at, submitted_at, status, score)
                VALUES (${event}, 'g1', ${second}, ${randomBytes(32).toString("hex")}, now() + interval '1 hour', now() - interval '2 hour', 'accepted', 1)`;
      await sql`INSERT INTO championship_runs (event_id, game_slug, player_id, token_hash, expires_at, submitted_at, status, score)
                VALUES (${event}, 'g1', ${first}, ${randomBytes(32).toString("hex")}, now() + interval '1 hour', now() - interval '1 hour', 'accepted', 1)`;
      await small.qualifyReferrer(a);
      expect(await status(second)).toBe("rewarded"); // its run was earlier
      expect(await status(first)).toBe("capped");
    } finally {
      await sql`DELETE FROM referral_settings WHERE event_id = ${event}`;
    }
  });

  it("revoke lowers the balance, keeps the slot used, and cannot be done twice", async () => {
    const small = createReferralStore(sql, { ...config, cap: 1 });
    await small.setSettings({ enabled: true, bonus: 10, cap: 1, actorEmail: actor });
    try {
      const a = await player("v-a");
      const t = await small.getOrCreateCode(a);
      const f1 = await friend("v-f1", t);
      await small.qualifyReferrer(a);
      expect(await balance(a)).toBe(10);
      const id = Number((await sql`SELECT id FROM referrals WHERE event_id = ${event} AND referred_id = ${f1}`)[0].id);
      expect(await small.revoke({ referralId: id, actorEmail: actor, reason: "test" })).toBe(true);
      expect(await small.revoke({ referralId: id, actorEmail: actor, reason: "again" })).toBe(false);
      expect(await balance(a)).toBe(0);
      expect(await status(f1)).toBe("revoked");
      const f2 = await friend("v-f2", t);
      await small.qualifyReferred(f2);
      expect(await status(f2)).toBe("capped"); // the revoked slot is not handed back
      expect(await balance(a)).toBe(0);
      const logged = await sql`SELECT (SELECT count(*) FROM referral_log WHERE actor_email = ${actor} AND action = 'revoke' AND referral_id = ${id})::int AS r, (SELECT count(*) FROM candy_log WHERE actor_email = ${actor} AND ledger_id IS NOT NULL)::int AS c`;
      expect(Number(logged[0].r)).toBe(1);
      expect(Number(logged[0].c)).toBeGreaterThanOrEqual(1);
    } finally {
      await sql`DELETE FROM referral_settings WHERE event_id = ${event}`;
    }
  });

  it("an admin switch-off stops attribution and payment", async () => {
    await store.setSettings({ enabled: false, bonus: 10, cap: 4, actorEmail: actor });
    try {
      const a = await player("s-a");
      const t = await store.getOrCreateCode(a);
      expect(await store.claim(await player("s-f"), t)).toBe("ignored");
      expect(await store.qualifyReferrer(a)).toEqual({ rewarded: 0, amount: 0 });
    } finally {
      await sql`DELETE FROM referral_settings WHERE event_id = ${event}`;
    }
  });

  it("refuses a claim outside the window", async () => {
    const closed = createReferralStore(sql, { ...config, closesAt: "2021-01-01T00:00:00Z" });
    const a = await player("w-a");
    const t = await closed.getOrCreateCode(a);
    expect(await closed.claim(await player("w-f"), t)).toBe("ignored");
  });

  it("the admin list shows public names only, with flags", async () => {
    const a = await player("l-a");
    const t = await store.getOrCreateCode(a);
    await friend("l-1", t);
    await friend("l-2", t);
    await friend("l-3", t);
    const rows = await store.listReferrals(50);
    const mine = rows.filter((r) => r.referrer.name && r.flags.length >= 0);
    expect(mine.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("example.invalid");
    expect(rows.some((r) => r.flags.includes("burst"))).toBe(true);
  });
});
