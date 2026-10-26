/**
 * The store's SQL is exercised against real Postgres separately (store.db.test.ts,
 * opt-in). These tests pin what must never regress quietly: nothing reads a
 * player's private columns, every credit is idempotent, a spend is one guarded
 * transaction, and bad input never reaches the database.
 */
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { CANDY_FRIGHT_FEST_2026 as C, isAchievementCandy, placingAmount, awardKey } from "./fright-fest-2026";
import { FRIGHT_FEST_2026 } from "../championship/fright-fest-2026";
import { CATALOGUE, currentVersion, getPack } from "../collectibles/catalogue";
import { describeEntry, shopItems } from "./present";
import { createCandyStore, REQUEST_ID_RE } from "./store";

function fakeSql(rowsFor: (text: string) => unknown[] = () => []) {
  const texts: string[] = [];
  const values: unknown[][] = [];
  const fn = ((strings: TemplateStringsArray, ...v: unknown[]) => {
    texts.push(strings.join("?"));
    values.push(v);
    return Promise.resolve(rowsFor(strings.join("?")));
  }) as unknown as NeonQueryFunction<false, false> & { transaction: unknown };
  const batches: number[] = [];
  (fn as unknown as { transaction: unknown }).transaction = async (build: (tx: typeof fn) => Promise<unknown[]>[]) => {
    const queries = build(fn as never);
    batches.push(queries.length);
    return Promise.all(queries);
  };
  return { sql: fn as NeonQueryFunction<false, false>, texts, values, batches };
}

/** The stand-alone balance read (not the `bal` CTE inside the spend statement). */
const BALANCE_READ = /^\s*SELECT COALESCE\(sum/;
const PLAYER = "g-player-1";
const REQ = "11111111-2222-4333-8444-555555555555";
const KEY = `candy:fright-fest-2026:spend:${PLAYER}:${REQ}`;

async function everyQuery() {
  const { sql, texts } = fakeSql((t) => (t.includes("INSERT INTO player_packs") ? [{ public_id: "pub", balance: 0 }] : []));
  const s = createCandyStore(sql);
  await s.sync(PLAYER);
  await s.balance(PLAYER);
  await s.history(PLAYER);
  await s.spend(PLAYER, "hpo-standard", REQ);
  await s.listAchievements("last-bell");
  await s.listAchievements();
  await s.setAchievementCandy({ achievementId: 3, candy: 10, actorEmail: "a@b" });
  await s.revokeCredit({ ledgerId: 4, actorEmail: "a@b", reason: "r" });
  await s.listRecent();
  await s.stats();
  await s.readLog();
  return texts;
}

describe("candy config", () => {
  it("earns inside the championship's window and spends until 1 Dec 00:00Z, exclusive", () => {
    expect(C.opensAt).toBe(FRIGHT_FEST_2026.opensAt);
    expect(C.closesAt).toBe(FRIGHT_FEST_2026.closesAt);
    expect(C.id).toBe(FRIGHT_FEST_2026.id);
    expect(C.spendUntil).toBe("2026-12-01T00:00:00Z");
    expect(C.spendUntilLabel).toBe("30 Nov 2026, 23:59 UK");
  });

  it("prices exactly the four everyday packs at 30 and the four Rare packs at 100, all published", () => {
    expect(C.prices).toEqual({
      "hpo-standard": 30, "inet-standard": 30, "brr-standard": 30, "tr-standard": 30,
      "hpo-rare": 100, "inet-rare": 100, "brr-rare": 100, "tr-rare": 100,
    });
    for (const id of Object.keys(C.prices)) expect(getPack(id), id).toBeDefined();
    // Nothing from the championship rewards is for sale.
    for (const p of CATALOGUE.packs.filter((p) => p.id.startsWith("ff26-"))) expect(C.prices[p.id]).toBeUndefined();
  });

  it("pays 10 per board, 20 for every board, and 40 / 30 / 20 for places 1, 2-3, 4-10", () => {
    expect([C.rankedRun, C.allBoards]).toEqual([10, 20]);
    expect([1, 2, 3, 4, 10, 11, 0, -1, 1.5].map((r) => placingAmount(C, r))).toEqual([40, 30, 30, 20, 20, 0, 0, 0, 0]);
  });

  it("keeps achievement values whole numbers from 0 to 40", () => {
    expect([0, 2, 40].map((n) => isAchievementCandy(C, n))).toEqual([true, true, true]);
    expect([-1, 41, 2.5, NaN].map((n) => isAchievementCandy(C, n))).toEqual([false, false, false, false]);
    for (const tier of C.rubric) for (const p of tier.presets) expect(isAchievementCandy(C, p)).toBe(true);
  });

  it("builds award keys in the documented shape", () => {
    expect(awardKey(C, "ranked_run", "p1", "last-bell")).toBe("candy:fright-fest-2026:ranked_run:p1:last-bell");
    expect(awardKey(C, "all_boards", "p1")).toBe("candy:fright-fest-2026:all_boards:p1");
  });
});

describe("candy store", () => {
  it("never selects a player's Google name, email or photo", async () => {
    const texts = await everyQuery();
    expect(texts.length).toBeGreaterThan(10);
    for (const text of texts) {
      expect(text).not.toMatch(/\bp\.(name|email|image|\*)|players\.(name|email|image)\b|SELECT \*\s+FROM players/i);
    }
  });

  it("every credit insert is idempotent on its award key", async () => {
    const texts = await everyQuery();
    const credits = texts.filter((t) => t.includes("INSERT INTO candy_ledger") && !t.includes("'spend'"));
    expect(credits).toHaveLength(4);
    for (const t of credits) expect(t).toMatch(/ON CONFLICT \(award_key\) DO NOTHING/);
    for (const kind of ["achievement", "ranked_run", "all_boards", "placing"]) {
      expect(credits.some((t) => t.includes(`:${kind}:`)), kind).toBe(true);
    }
  });

  it("syncs in ONE transaction behind the player's advisory lock", async () => {
    const { sql, texts, values, batches } = fakeSql();
    await createCandyStore(sql).sync(PLAYER);
    expect(batches).toEqual([7]);
    expect(texts[0]).toMatch(/pg_advisory_xact_lock/);
    expect(values[0]).toEqual([`candy:${PLAYER}`]);
  });

  it("only credits achievements unlocked in the window and rated above 0", async () => {
    const { sql, texts, values } = fakeSql();
    await createCandyStore(sql).sync(PLAYER);
    const i = texts.findIndex((t) => t.includes(":achievement:"));
    expect(texts[i]).toMatch(/pa\.unlocked_at >= \?::timestamptz AND pa\.unlocked_at < \?::timestamptz/);
    expect(texts[i]).toMatch(/a\.candy > 0/);
    expect(values[i]).toContain(C.opensAt);
    expect(values[i]).toContain(C.closesAt);
  });

  it("credits runs only from ACCEPTED runs on counting boards, and placings only from the finalised snapshot", async () => {
    const { sql, texts, values } = fakeSql();
    await createCandyStore(sql).sync(PLAYER);
    const run = texts.find((t) => t.includes(":ranked_run:") && t.includes("INSERT"))!;
    expect(run).toMatch(/r\.status = 'accepted'/);
    expect(run).toMatch(/g\.status IN \('open','paused'\) AND g\.opened_at IS NOT NULL/);
    const all = texts.find((t) => t.includes(":all_boards:") && t.includes("INSERT"))!;
    expect(all).toMatch(/NOT EXISTS/);
    expect(all).toMatch(/r\.status = 'accepted'/);
    const j = texts.findIndex((t) => t.includes(":placing:"));
    expect(texts[j]).toMatch(/ev\.status IN \('finalised','archived'\) AND ev\.final_standings IS NOT NULL/);
    expect(texts[j]).toMatch(/final_standings->'boards'/);
    expect(values[j]).toContainEqual([1, 2, 4]);
    expect(values[j]).toContainEqual([1, 3, 10]);
    expect(values[j]).toContainEqual([40, 30, 20]);
  });

  it("revokes a run credit only when no accepted run is left, and restores only a system revocation", async () => {
    const { sql, texts } = fakeSql();
    await createCandyStore(sql).sync(PLAYER);
    const revoke = texts.find((t) => t.includes("revoked_by = 'system'") && t.includes("SET revoked_at = now()"))!;
    expect(revoke).toMatch(/l\.kind = 'ranked_run' AND l\.revoked_at IS NULL/);
    expect(revoke).toMatch(/NOT EXISTS/);
    const restore = texts.find((t) => t.includes("SET revoked_at = NULL"))!;
    expect(restore).toMatch(/l\.revoked_by = 'system'/);
    expect(restore).toMatch(/AND EXISTS/);
  });

  it("totals what THIS sync wrote from the RETURNING rows", async () => {
    const rows = (t: string) => (t.includes(":achievement:") ? [{ amount: 5 }, { amount: 8 }] : t.includes(":ranked_run:") && t.includes("INSERT") ? [{ amount: 10 }] : []);
    const { sql } = fakeSql(rows);
    expect(await createCandyStore(sql).sync(PLAYER)).toEqual({ credited: 3, amount: 23 });
  });

  it("the balance counts unrevoked rows of this event only, and may be negative", async () => {
    const { sql, texts } = fakeSql(() => [{ n: -5 }]);
    expect(await createCandyStore(sql).balance(PLAYER)).toBe(-5);
    expect(texts[0]).toMatch(/revoked_at IS NULL/);
    expect(texts[0]).toMatch(/event_id = \?/);
  });
});

describe("spend", () => {
  it("refuses an unpriced pack, a championship pack and a malformed request id before the database", async () => {
    const { sql, texts } = fakeSql();
    const s = createCandyStore(sql);
    expect(await s.spend(PLAYER, "nope", REQ)).toEqual({ status: "bad-pack" });
    expect(await s.spend(PLAYER, "ff26-participation", REQ)).toEqual({ status: "bad-pack" });
    expect(await s.spend(PLAYER, "constructor", REQ)).toEqual({ status: "bad-pack" });
    expect(await s.spend(PLAYER, "hpo-standard", "short")).toEqual({ status: "bad-request" });
    expect(await s.spend(PLAYER, "hpo-standard", "has spaces in it!")).toEqual({ status: "bad-request" });
    expect(texts).toEqual([]);
    expect(REQUEST_ID_RE.test(REQ)).toBe(true);
  });

  it("is one transaction: lock, then one statement that checks, grants and debits together", async () => {
    const { sql, texts, values, batches } = fakeSql((t) => (t.includes("INSERT INTO player_packs") ? [{ public_id: "pack-1", balance: 70 }] : []));
    const out = await createCandyStore(sql).spend(PLAYER, "hpo-standard", REQ);
    expect(out).toEqual({ status: "ok", alreadySpent: false, packPublicId: "pack-1", packId: "hpo-standard", price: 30, balance: 70 });
    expect(batches).toEqual([2]);
    expect(texts[0]).toMatch(/pg_advisory_xact_lock/);
    expect(values[0]).toEqual([`candy:${PLAYER}`]);
    const stmt = texts[1];
    expect(stmt).toMatch(/bal\.n >= \?::int/);
    expect(stmt).toMatch(/now\(\) >= \?::timestamptz AND now\(\) < \?::timestamptz/);
    expect(stmt).toMatch(/INSERT INTO player_packs[\s\S]*'event'/);
    expect(stmt).toMatch(/ON CONFLICT \(grant_key\) DO NOTHING/);
    expect(stmt).toMatch(/INSERT INTO candy_ledger[\s\S]*'spend'[\s\S]*pk\.id/);
    expect(stmt).toMatch(/ON CONFLICT \(award_key\) DO NOTHING/);
    expect(stmt).toMatch(/revoked_at IS NULL/);
    // The grant key IS the debit's award key, and the debit carries the price negated.
    expect(values[1]).toContain(KEY);
    expect(values[1].filter((v) => v === KEY)).toHaveLength(2);
    expect(values[1]).toContain(-30);
    expect(values[1]).toContain(currentVersion(getPack("hpo-standard")!).v);
    expect(values[1]).toContain(C.spendUntil);
  });

  it("prices a Rare pack at 100", async () => {
    const { sql, values } = fakeSql((t) => (t.includes("INSERT INTO player_packs") ? [{ public_id: "p", balance: 0 }] : []));
    const out = await createCandyStore(sql).spend(PLAYER, "tr-rare", REQ);
    expect(out).toMatchObject({ status: "ok", price: 100 });
    expect(values[1]).toContain(-100);
  });

  it("reports a replayed request as the same pack, not a second purchase", async () => {
    const { sql } = fakeSql((t) =>
      t.includes("FROM candy_ledger l JOIN player_packs pp") ? [{ ref: "hpo-standard", public_id: "pack-1" }] : BALANCE_READ.test(t) ? [{ n: 70 }] : [],
    );
    expect(await createCandyStore(sql).spend(PLAYER, "hpo-standard", REQ)).toEqual({
      status: "ok", alreadySpent: true, packPublicId: "pack-1", packId: "hpo-standard", price: 30, balance: 70,
    });
  });

  it("refuses a request id reused for a different pack", async () => {
    const { sql } = fakeSql((t) => (t.includes("FROM candy_ledger l JOIN player_packs pp") ? [{ ref: "hpo-standard", public_id: "pack-1" }] : []));
    expect(await createCandyStore(sql).spend(PLAYER, "tr-rare", REQ)).toEqual({ status: "bad-request" });
  });

  it("says closed (not yet / expired) and insufficient, in that order of precedence", async () => {
    const state = (started: boolean, open: boolean) => (t: string) =>
      t.includes("AS started") ? [{ started, open }] : BALANCE_READ.test(t) ? [{ n: 12 }] : [];
    expect(await createCandyStore(fakeSql(state(false, true)).sql).spend(PLAYER, "hpo-standard", REQ)).toEqual({ status: "closed", reason: "not-open-yet" });
    expect(await createCandyStore(fakeSql(state(true, false)).sql).spend(PLAYER, "hpo-standard", REQ)).toEqual({ status: "closed", reason: "expired" });
    expect(await createCandyStore(fakeSql(state(true, true)).sql).spend(PLAYER, "hpo-standard", REQ)).toEqual({ status: "insufficient", balance: 12, price: 30 });
  });
});

describe("admin", () => {
  it("sets a value only between 0 and 40, and logs in the same statement", async () => {
    const { sql, texts } = fakeSql();
    const s = createCandyStore(sql);
    await expect(s.setAchievementCandy({ achievementId: 1, candy: 41, actorEmail: "a" })).rejects.toThrow(/0 to 40/);
    await expect(s.setAchievementCandy({ achievementId: 1, candy: 1.5, actorEmail: "a" })).rejects.toThrow(/0 to 40/);
    await expect(s.setAchievementCandy({ achievementId: 0, candy: 1, actorEmail: "a" })).rejects.toThrow(/Invalid/);
    expect(texts).toEqual([]);
    await s.setAchievementCandy({ achievementId: 1, candy: 12, actorEmail: "a" });
    expect(texts[0]).toMatch(/INSERT INTO candy_log/);
    expect(texts[0]).toMatch(/old\.candy <> \?::int/);
  });

  it("maps the outcome of a set", async () => {
    const out = (found: number, changed: number) => createCandyStore(fakeSql(() => [{ found, changed, logged: changed }]).sql).setAchievementCandy({ achievementId: 1, candy: 5, actorEmail: "a" });
    expect(await out(0, 0)).toBe("not-found");
    expect(await out(1, 0)).toBe("unchanged");
    expect(await out(1, 1)).toBe("changed");
  });

  it("revokes a credit with a reason, never a spend, behind the player's lock, logged in the same statement", async () => {
    const { sql, texts, batches } = fakeSql((t) => (t.includes("UPDATE candy_ledger") ? [{ id: 4 }] : []));
    const s = createCandyStore(sql);
    await expect(s.revokeCredit({ ledgerId: 4, actorEmail: "a", reason: "  " })).rejects.toThrow(/reason/i);
    expect(texts).toEqual([]);
    expect(await s.revokeCredit({ ledgerId: 4, actorEmail: "a", reason: "Farmed" })).toBe(true);
    expect(batches).toEqual([2]);
    expect(texts[0]).toMatch(/pg_advisory_xact_lock/);
    expect(texts[1]).toMatch(/kind <> 'spend' AND revoked_at IS NULL/);
    expect(texts[1]).toMatch(/INSERT INTO candy_log/);
    expect(await s.revokeCredit({ ledgerId: -1, actorEmail: "a", reason: "x" })).toBe(false);
  });

  it("the achievement list can be filtered by game with a bound parameter", async () => {
    const { sql, values } = fakeSql();
    await createCandyStore(sql).listAchievements("last-bell");
    expect(values[0]).toContain("last-bell");
  });
});

describe("presentation", () => {
  const base = { id: 1, amount: 10, createdAt: "2026-10-28T10:00:00.000Z", revoked: false, achievementName: null };
  it("words each kind of row for the player", () => {
    const titles = new Map([["duskfall", "Duskfall"]]);
    expect(describeEntry({ ...base, kind: "achievement", ref: "duskfall/first_win", achievementName: "First win" }, titles)).toMatchObject({ label: "First win", game: "Duskfall" });
    expect(describeEntry({ ...base, kind: "ranked_run", ref: "last-bell" }, titles).label).toBe("First ranked run: Last Bell");
    expect(describeEntry({ ...base, kind: "all_boards", ref: null }, titles).label).toBe("A result on every board");
    expect(describeEntry({ ...base, kind: "placing", ref: "last-bell#2" }, titles).label).toBe("Placed 2nd on Last Bell");
    expect(describeEntry({ ...base, kind: "placing", ref: "last-bell#11" }, titles).label).toBe("Placed 11th on Last Bell");
    expect(describeEntry({ ...base, kind: "spend", amount: -30, ref: "hpo-standard" }, titles).label).toBe("Bought HallPass Originals Pack");
  });
  it("lists the shelf cheapest first and marks what the balance covers", () => {
    const shop = shopItems(30);
    expect(shop).toHaveLength(8);
    expect(shop.slice(0, 4).every((i) => i.price === 30 && i.affordable)).toBe(true);
    expect(shop.slice(4).every((i) => i.price === 100 && !i.affordable)).toBe(true);
    expect(shopItems(-5).every((i) => !i.affordable)).toBe(true);
  });
});
