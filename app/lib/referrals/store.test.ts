/**
 * The store's SQL is checked here for shape and guards with a fake `sql`; the
 * properties only a real Postgres proves (a race for the last slot, idempotence)
 * are in store.db.test.ts (opt-in).
 */
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { REFERRAL_FRIGHT_FEST_2026 as C } from "./config";
import { createReferralStore, hasBurst } from "./store";

function fakeSql(rowsFor: (text: string) => unknown[] = () => []) {
  const texts: string[] = [];
  const values: unknown[][] = [];
  const batches: string[][] = [];
  const fn = ((strings: TemplateStringsArray, ...v: unknown[]) => {
    const t = strings.join("?");
    texts.push(t);
    values.push(v);
    return Promise.resolve(rowsFor(t));
  }) as unknown as NeonQueryFunction<false, false> & { transaction: unknown };
  (fn as unknown as { transaction: unknown }).transaction = async (build: (tx: typeof fn) => Promise<unknown[]>[]) => {
    const before = texts.length;
    const queries = build(fn as never);
    batches.push(texts.slice(before));
    return Promise.all(queries);
  };
  return { sql: fn as NeonQueryFunction<false, false>, texts, values, batches };
}

const TOKEN = "7CDFGHJKMNPQ";
const NOW = Date.parse("2026-10-29T12:00:00Z");

describe("claim", () => {
  it("never reaches the database for a malformed token", async () => {
    const f = fakeSql();
    expect(await createReferralStore(f.sql).claim("p", "nope", NOW)).toBe("ignored");
    expect(f.texts).toHaveLength(0);
  });

  it("is ignored outside the event window", async () => {
    const f = fakeSql();
    expect(await createReferralStore(f.sql).claim("p", TOKEN, Date.parse("2026-11-03T00:00:00Z"))).toBe("ignored");
    expect(f.texts).toHaveLength(0);
  });

  it("is ignored when an admin has switched referrals off", async () => {
    const f = fakeSql((t) => (t.includes("FROM referral_settings") ? [{ enabled: false, bonus: 10, cap: 4 }] : []));
    expect(await createReferralStore(f.sql).claim("p", TOKEN, NOW)).toBe("ignored");
    expect(f.texts.some((t) => t.includes("INSERT INTO referrals"))).toBe(false);
  });

  it("keeps the FIRST attribution, refuses self-referral, and decides newness in SQL", async () => {
    const f = fakeSql((t) => (t.includes("INSERT INTO referrals") ? [{ status: "pending" }] : []));
    expect(await createReferralStore(f.sql).claim("p", TOKEN, NOW)).toBe("attributed");
    const q = f.texts.find((t) => t.includes("INSERT INTO referrals"))!;
    expect(q).toContain("ON CONFLICT (event_id, referred_id) DO NOTHING");
    expect(q).toContain("c.player_id <> me.id");
    expect(q).toContain("p.created_at >=");
    expect(q).toContain("championship_runs");
  });

  it("reports a returning player as such", async () => {
    const f = fakeSql((t) => (t.includes("INSERT INTO referrals") ? [{ status: "ineligible" }] : []));
    expect(await createReferralStore(f.sql).claim("p", TOKEN, NOW)).toBe("returning");
  });
});

describe("qualifyReferrer", () => {
  it("is one transaction: lock first, then credit, mark, cap", async () => {
    const f = fakeSql();
    await createReferralStore(f.sql).qualifyReferrer("referrer");
    expect(f.batches).toHaveLength(1);
    const [lock, credit, mark, cap] = f.batches[0];
    expect(lock).toContain("pg_advisory_xact_lock");
    expect(credit).toContain("INSERT INTO candy_ledger");
    expect(credit).toContain("ON CONFLICT (award_key) DO NOTHING");
    expect(credit).toContain("'referral'");
    expect(mark).toContain("status = 'rewarded'");
    expect(cap).toContain("status = 'capped'");
  });

  it("counts only ACCEPTED runs inside the window, and counts revoked slots against the cap", async () => {
    const f = fakeSql();
    await createReferralStore(f.sql).qualifyReferrer("referrer");
    const credit = f.batches[0][1];
    expect(credit).toContain("cr.status = 'accepted'");
    expect(credit).toContain("cr.submitted_at >=");
    expect(credit).toContain("IN ('rewarded','revoked')");
  });

  it("passes the effective bonus and cap from the admin's settings", async () => {
    const f = fakeSql((t) => (t.includes("FROM referral_settings") ? [{ enabled: true, bonus: 7, cap: 3 }] : []));
    await createReferralStore(f.sql).qualifyReferrer("referrer");
    const i = f.texts.findIndex((t) => t.includes("INSERT INTO candy_ledger"));
    expect(f.values[i]).toContain(7);
    expect(f.values[i]).toContain(3);
  });

  it("does nothing at all when referrals are disabled", async () => {
    const f = fakeSql((t) => (t.includes("FROM referral_settings") ? [{ enabled: false, bonus: 10, cap: 4 }] : []));
    expect(await createReferralStore(f.sql).qualifyReferrer("referrer")).toEqual({ rewarded: 0, amount: 0 });
    expect(f.batches).toHaveLength(0);
  });

  it("reports what THIS call paid", async () => {
    const f = fakeSql((t) => (t.includes("INSERT INTO candy_ledger") ? [{ amount: 10 }] : []));
    expect(await createReferralStore(f.sql).qualifyReferrer("referrer")).toEqual({ rewarded: 1, amount: 10 });
  });
});

describe("qualifyReferred", () => {
  it("is null (and cheap) for a player nobody referred", async () => {
    const f = fakeSql();
    expect(await createReferralStore(f.sql).qualifyReferred("p")).toBeNull();
    expect(f.batches).toHaveLength(0);
  });
  it("pays the referrer of a pending referral", async () => {
    const f = fakeSql((t) => (t.includes("SELECT referrer_id") ? [{ referrer_id: "a" }] : []));
    await createReferralStore(f.sql).qualifyReferred("p");
    expect(f.batches).toHaveLength(1);
  });
});

describe("mine", () => {
  it("returns counts and the remaining slots, never who", async () => {
    const f = fakeSql((t) => {
      if (t.includes("AS pending")) return [{ pending: 1, used: 3, candy: 30, visits: 9 }];
      if (t.includes("referral_codes")) return [{ token: TOKEN }];
      return [];
    });
    const m = await createReferralStore(f.sql).mine("me", NOW);
    expect(m).toMatchObject({ token: TOKEN, pending: 1, rewarded: 3, candy: 30, remaining: 1, visits: 9, windowOpen: true });
    expect(JSON.stringify(m)).not.toContain("referred");
  });
  it("never reports a negative number of remaining rewards", async () => {
    const f = fakeSql((t) => (t.includes("AS pending") ? [{ pending: 0, used: 9, candy: 90, visits: 0 }] : t.includes("SELECT token") ? [{ token: TOKEN }] : []));
    expect((await createReferralStore(f.sql).mine("me", NOW)).remaining).toBe(0);
  });
});

describe("admin", () => {
  it("revoke needs a reason and a real id, and is one transaction", async () => {
    const f = fakeSql((t) => (t.includes("UPDATE referrals") ? [{ id: 1 }] : []));
    const s = createReferralStore(f.sql);
    expect(await s.revoke({ referralId: 1, actorEmail: "a@b", reason: "   " })).toBe(false);
    expect(await s.revoke({ referralId: -1, actorEmail: "a@b", reason: "x" })).toBe(false);
    expect(f.batches).toHaveLength(0);
    expect(await s.revoke({ referralId: 1, actorEmail: "a@b", reason: "farming" })).toBe(true);
    expect(f.batches).toHaveLength(1);
    const q = f.batches[0][1];
    expect(q).toContain("status = 'rewarded'");
    expect(q).toContain("INSERT INTO candy_log");
    expect(q).toContain("INSERT INTO referral_log");
  });

  it("settings are bounded", async () => {
    const f = fakeSql();
    const s = createReferralStore(f.sql);
    expect(await s.setSettings({ enabled: true, bonus: 10, cap: 21, actorEmail: "a@b" })).toBe(false);
    expect(await s.setSettings({ enabled: true, bonus: -1, cap: 4, actorEmail: "a@b" })).toBe(false);
    expect(await s.setSettings({ enabled: true, bonus: 1.5, cap: 4, actorEmail: "a@b" })).toBe(false);
    expect(f.batches).toHaveLength(0);
    expect(await s.setSettings({ enabled: false, bonus: 10, cap: 4, actorEmail: "a@b" })).toBe(true);
    expect(f.batches).toHaveLength(1);
  });

  it("no admin query selects an email or a Google name", async () => {
    const f = fakeSql();
    const s = createReferralStore(f.sql);
    await s.listReferrals();
    await s.stats();
    for (const t of f.texts) {
      expect(t).not.toMatch(/\bemail\b/i);
      expect(t).not.toMatch(/\bp?\.?name\b/);
    }
  });
});

describe("hasBurst", () => {
  const m = 60_000;
  it("flags three accounts within ten minutes", () => {
    expect(hasBurst([0, 2 * m, 9 * m])).toBe(true);
  });
  it("does not flag three spread over an hour, or only two close together", () => {
    expect(hasBurst([0, 30 * m, 60 * m])).toBe(false);
    expect(hasBurst([0, m])).toBe(false);
  });
});

describe("config", () => {
  it("caps a player at four rewards by default", () => {
    expect(C.cap).toBe(4);
    expect(C.bonus).toBe(10);
  });
});
