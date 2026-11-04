/**
 * Pins what must never regress quietly: every write is idempotent and takes the
 * player's lock, a purchase is one guarded transaction, selling only ever pays
 * the catalogue's 20%, and bad input never reaches the database.
 */
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { MARKET_PRICES, SELL_BACK_PCT, sellBackValue, streakBonus, ukDay } from "./config";
import { createHallTokensStore, REQUEST_ID_RE } from "./store";
import { getPack } from "../collectibles/catalogue";

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

const PLAYER = "g-player-1";
const REQ = "11111111-2222-4333-8444-555555555555";

describe("config", () => {
  it("only sells packs that exist, are permanent, and are not Fright Fest or candy-only", () => {
    for (const id of Object.keys(MARKET_PRICES)) {
      const pack = getPack(id);
      expect(pack, id).toBeDefined();
      expect(pack!.collection).not.toBe("ff26");
      expect(id.endsWith("-standard")).toBe(true);
      expect(MARKET_PRICES[id]).toBeGreaterThan(0);
    }
  });
  it("pays 20% of a card's base value on sell-back", () => {
    expect(SELL_BACK_PCT).toBe(20);
    expect(sellBackValue("common")).toBe(2);
    expect(sellBackValue("legendary")).toBe(80);
  });
  it("scales and caps the streak bonus, and pays nothing under 2 days", () => {
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(3)).toBe(6);
    expect(streakBonus(99)).toBe(20);
  });
  it("names the UK day, not the UTC one", () => {
    expect(ukDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
  });
});

describe("buyPack", () => {
  it("rejects an unpriced pack, a candy-only pack and a bad request id before the database", async () => {
    const { sql, texts } = fakeSql();
    const s = createHallTokensStore(sql);
    expect(await s.buyPack(PLAYER, "legends-rare", REQ)).toEqual({ status: "bad-pack" });
    expect(await s.buyPack(PLAYER, "ff26-participation", REQ)).toEqual({ status: "bad-pack" });
    expect(await s.buyPack(PLAYER, "legends-standard", "short")).toEqual({ status: "bad-request" });
    expect(texts).toHaveLength(0);
    expect(REQUEST_ID_RE.test(REQ)).toBe(true);
  });

  it("is one two-statement transaction: lock, then a balance-guarded debit + grant", async () => {
    const { sql, texts, batches } = fakeSql((t) => (t.includes("INSERT INTO player_packs") ? [{ public_id: "pub", balance: 40 }] : []));
    const r = await createHallTokensStore(sql).buyPack(PLAYER, "legends-standard", REQ);
    expect(r).toMatchObject({ status: "ok", alreadyBought: false, packPublicId: "pub", price: 100, balance: 40 });
    expect(batches).toEqual([2]);
    expect(texts[0]).toContain("pg_advisory_xact_lock");
    expect(texts[1]).toContain("bal.n >=");
    expect(texts[1]).toContain("ON CONFLICT (grant_key) DO NOTHING");
    expect(texts[1]).toContain("ON CONFLICT (award_key) DO NOTHING");
  });

  it("reports insufficient tokens when nothing was inserted and no prior spend exists", async () => {
    const { sql } = fakeSql((t) => (t.includes("sum(amount)") && !t.includes("INSERT") ? [{ n: 30 }] : []));
    expect(await createHallTokensStore(sql).buyPack(PLAYER, "legends-standard", REQ)).toEqual({ status: "insufficient", balance: 30, price: 100 });
  });

  it("returns the same pack for a replayed request id", async () => {
    const { sql } = fakeSql((t) =>
      t.includes("JOIN player_packs") ? [{ ref: "legends-standard", public_id: "pub" }] : t.includes("sum(amount)") && !t.includes("INSERT") ? [{ n: 7 }] : [],
    );
    expect(await createHallTokensStore(sql).buyPack(PLAYER, "legends-standard", REQ)).toMatchObject({ status: "ok", alreadyBought: true, packPublicId: "pub", balance: 7 });
  });

  it("refuses a request id reused for a different pack", async () => {
    const { sql } = fakeSql((t) => (t.includes("JOIN player_packs") ? [{ ref: "gaming-standard", public_id: "pub" }] : []));
    expect(await createHallTokensStore(sql).buyPack(PLAYER, "legends-standard", REQ)).toEqual({ status: "bad-request" });
  });
});

describe("earnForPlay", () => {
  it("ignores a malformed slug or day without touching the database", async () => {
    const { sql, texts } = fakeSql();
    const s = createHallTokensStore(sql);
    expect(await s.earnForPlay(PLAYER, "Bad Slug!", "2026-11-04")).toBe(0);
    expect(await s.earnForPlay(PLAYER, "last-bell", "tomorrow")).toBe(0);
    expect(texts).toHaveLength(0);
  });

  it("is idempotent and capped in SQL, and sums what was credited", async () => {
    const { sql, texts } = fakeSql((t) => (t.includes("'play'") && t.includes("INSERT") ? [{ amount: 5 }] : t.includes("'streak'") ? [{ amount: 6 }] : []));
    expect(await createHallTokensStore(sql).earnForPlay(PLAYER, "last-bell", "2026-11-04")).toBe(11);
    expect(texts[1]).toContain("ON CONFLICT (award_key) DO NOTHING");
    expect(texts[1]).toContain("<=");
  });
});

describe("sellBack", () => {
  it("rejects an unknown card before the database", async () => {
    const { sql, texts } = fakeSql();
    expect(await createHallTokensStore(sql).sellBack(PLAYER, "nope")).toEqual({ status: "bad-card" });
    expect(texts).toHaveLength(0);
  });

  it("revokes a spare copy and credits in one guarded statement", async () => {
    const { sql, texts, values } = fakeSql((t) => (t.includes("AS credited") ? [{ credited: 1 }] : t.includes("sum(amount)") ? [{ n: 12 }] : []));
    const { COLLECTIBLES } = await import("../collectibles/catalogue/collectibles");
    const card = COLLECTIBLES.find((c) => c.rarity === "common")!;
    const r = await createHallTokensStore(sql).sellBack(PLAYER, card.id);
    expect(r).toEqual({ status: "ok", collectibleId: card.id, credited: 2, balance: 12 });
    const stmt = texts.find((t) => t.includes("AS credited"))!;
    expect(stmt).toContain("> 1");
    expect(stmt).toContain("ON CONFLICT (award_key) DO NOTHING");
    expect(values.flat()).toContain(2);
  });

  it("says no-spare-copy when nothing was sold", async () => {
    const { sql } = fakeSql((t) => (t.includes("AS credited") ? [{ credited: 0 }] : []));
    const { COLLECTIBLES } = await import("../collectibles/catalogue/collectibles");
    expect(await createHallTokensStore(sql).sellBack(PLAYER, COLLECTIBLES[0].id)).toEqual({ status: "no-spare-copy" });
  });
});
