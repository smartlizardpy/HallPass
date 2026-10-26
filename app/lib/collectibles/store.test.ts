/**
 * The store's SQL is exercised against real Postgres separately (PGlite; see
 * docs/collectibles-design.md). These tests pin the properties that must never
 * regress quietly: no query reads a player's private columns, and every write
 * carries its guard.
 */
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createCollectiblesStore } from "./store";
import { collectionProgress } from "./progress";

const PACK = "11111111-1111-1111-1111-111111111111";

function fakeSql(rowsFor: (text: string) => unknown[] = () => []) {
  const texts: string[] = [];
  const values: unknown[][] = [];
  const fn = ((strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?");
    texts.push(text);
    values.push(v);
    return Promise.resolve(rowsFor(text));
  }) as unknown as NeonQueryFunction<false, false> & { transaction: unknown };
  (fn as unknown as { transaction: unknown }).transaction = async (build: (tx: typeof fn) => Promise<unknown[]>[]) => {
    const queries = build(fn as never);
    return Promise.all(queries);
  };
  return { sql: fn as NeonQueryFunction<false, false>, texts, values };
}

const sealed = { public_id: PACK, pack_id: "ff26-participation", pack_version: 1, source: "event", granted_at: "2026-10-28T00:00:00Z", opened_at: null, revoked_at: null };

async function everyQuery() {
  const { sql, texts } = fakeSql((t) => (t.includes("FROM player_packs pp") && t.includes("public_id = ?::uuid") ? [sealed] : []));
  const s = createCollectiblesStore(sql);
  await s.readPack("p", PACK);
  await s.readPulls("p", PACK);
  await s.grantPack({ playerId: "p", packId: "hpo-standard", grantKey: "k", source: "event" }).catch(() => {});
  await s.adminGrantPack({ playerId: "p", packId: "hpo-standard", grantKey: "k", source: "admin", actorEmail: "a", reason: "r" }).catch(() => {});
  await s.listSealed("p");
  await s.listOpened("p");
  await s.openPack({ playerId: "p", publicId: PACK }).catch(() => {});
  await s.binder("p");
  await s.setPrefs({ playerId: "p", collectibleId: "hpo-hall-pass", favourite: true });
  await s.markSeen("p", ["hpo-hall-pass"]);
  await s.findPublicPlayer("alice");
  await s.featured("p");
  await s.revokePack({ publicId: PACK, actorEmail: "a", reason: "r" });
  await s.revokePull({ pullId: 1, actorEmail: "a", reason: "r" });
  await s.readLog();
  await s.findPlayerForAdmin("alice");
  await s.findPlayerForAdmin("@Alice");
  await s.findPlayerForAdmin("22222222-2222-2222-2222-222222222222");
  await s.listRecentPacks();
  return texts;
}

describe("collectibles store", () => {
  it("never selects a player's Google name, email or photo", async () => {
    const texts = await everyQuery();
    expect(texts.length).toBeGreaterThan(10);
    for (const text of texts) {
      expect(text).not.toMatch(/\bp\.(name|email|image|\*)|players\.(name|email|image)\b|SELECT \*\s+FROM players/i);
    }
  });

  it("grants are idempotent by grant_key", async () => {
    const texts = await everyQuery();
    const grant = texts.find((t) => t.includes("INSERT INTO player_packs") && !t.includes("collectibles_log"))!;
    expect(grant).toMatch(/ON CONFLICT \(grant_key\) DO NOTHING/);
    const admin = texts.find((t) => t.includes("INSERT INTO collectibles_log") && t.includes("'grant-pack'"))!;
    expect(admin).toMatch(/ON CONFLICT \(grant_key\) DO NOTHING/);
  });

  it("opens in one guarded statement behind the player's advisory lock", async () => {
    const texts = await everyQuery();
    expect(texts.some((t) => /pg_advisory_xact_lock/.test(t))).toBe(true);
    const open = texts.find((t) => t.includes("UPDATE player_packs SET opened_at = now()"))!;
    expect(open).toMatch(/opened_at IS NULL AND revoked_at IS NULL/);
    expect(open).toMatch(/player_id = \?/);
    expect(open).toMatch(/INSERT INTO collectible_pulls/);
    expect(open).toMatch(/d\.nth = 1 AND NOT EXISTS/); // was_new computed in SQL
    expect(open).toMatch(/revoked_at IS NULL/);
  });

  it("every admin change logs in the same statement and only touches what is unrevoked", async () => {
    const texts = await everyQuery();
    const revPack = texts.find((t) => t.includes("revoked_by =") && t.includes("UPDATE player_packs"))!;
    expect(revPack).toMatch(/opened_at IS NULL AND revoked_at IS NULL/);
    expect(revPack).toMatch(/INSERT INTO collectibles_log/);
    const revPull = texts.find((t) => t.includes("UPDATE collectible_pulls SET revoked_at"))!;
    expect(revPull).toMatch(/revoked_at IS NULL/);
    expect(revPull).toMatch(/INSERT INTO collectibles_log/);
  });

  it("the admin lookups ignore profile privacy but never read private columns, and the feed is bounded", async () => {
    const { sql, texts, values } = fakeSql();
    const s = createCollectiblesStore(sql);
    await s.findPlayerForAdmin("@Alice");
    await s.findPlayerForAdmin("22222222-2222-2222-2222-222222222222");
    await s.findPlayerForAdmin("   ");
    await s.listRecentPacks(7);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/p\.username = \?/);
    expect(texts[0]).not.toMatch(/profile_visibility/);
    expect(values[0]).toEqual(["alice"]);
    expect(texts[1]).toMatch(/p\.public_id = \?::uuid/);
    expect(texts[2]).toMatch(/FROM player_packs pp JOIN players p/);
    expect(texts[2]).toMatch(/ORDER BY pp\.granted_at DESC/);
    expect(texts[2]).toMatch(/LIMIT \?/);
    expect(values[2]).toEqual([7]);
    expect(texts[2]).toMatch(/'id', c\.id/);
  });

  it("prefs require ownership and the showcase requires a public profile", async () => {
    const texts = await everyQuery();
    const prefs = texts.find((t) => t.includes("INSERT INTO player_collectible_prefs") && t.includes("clear AS"))!;
    expect(prefs).toMatch(/SELECT ok FROM owned/);
    expect(prefs).toMatch(/revoked_at IS NULL/);
    expect(texts.find((t) => t.includes("p.username = ?"))).toMatch(/profile_visibility = 'public'/);
    expect(texts.find((t) => t.includes("pf.featured_position IS NOT NULL"))).toMatch(/revoked_at IS NULL/);
  });

  it("refuses unknown packs, bad slots and missing reasons before touching the database", async () => {
    const { sql, texts } = fakeSql();
    const s = createCollectiblesStore(sql);
    await expect(s.grantPack({ playerId: "p", packId: "nope", grantKey: "k", source: "event" })).rejects.toThrow(/Unknown pack/);
    await expect(s.grantPack({ playerId: "p", packId: "hpo-standard", grantKey: "k", source: "event", packVersion: 9 })).rejects.toThrow(/Unknown version/);
    await expect(s.setPrefs({ playerId: "p", collectibleId: "hpo-hall-pass", featuredPosition: 7 })).rejects.toThrow(/1 to 6/);
    await expect(s.revokePull({ pullId: 1, actorEmail: "a", reason: "  " })).rejects.toThrow(/reason/i);
    expect(texts).toEqual([]);
  });

  it("opens from the PINNED version and passes the rolled ids to the statement", async () => {
    const { sql, values } = fakeSql((t) => (t.includes("public_id = ?::uuid") && !t.includes("UPDATE") ? [sealed] : []));
    const s = createCollectiblesStore(sql);
    await s.openPack({ playerId: "p", publicId: PACK, randomInt: () => 0 }).catch(() => {});
    const ids = values.flat().find((v) => Array.isArray(v)) as string[];
    expect(ids).toEqual(["ff26-survivor", "ff26-cobweb-bell", "ff26-cobweb-bell"]);
  });
});

describe("collectionProgress", () => {
  it("counts distinct owned cards per collection, from the ledger", () => {
    const p = collectionProgress([{ collectibleId: "hpo-hall-pass" }, { collectibleId: "hpo-reactor" }, { collectibleId: "ff26-survivor" }]);
    expect(p.find((x) => x.collection === "hpo")).toEqual({ collection: "hpo", owned: 2, total: 12, percent: 16 });
    expect(p.find((x) => x.collection === "ff26")).toMatchObject({ owned: 1, total: 20, percent: 5 });
    expect(p.find((x) => x.collection === "tr")).toMatchObject({ owned: 0, percent: 0 });
  });
});
