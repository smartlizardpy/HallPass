/**
 * The store's SQL is exercised against real Postgres separately (store.db.test.ts,
 * opt-in). These tests pin what must never regress quietly: nothing reads a
 * player's private columns, every credit is idempotent, a spend is one guarded
 * transaction, and bad input never reaches the database.
 */
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { CANDY_FRIGHT_FEST_2026 as C, isGameCandy, placingAmount, awardKey, dailyBestPct, dailyBestAmount } from "./fright-fest-2026";
import { FRIGHT_FEST_2026 } from "../championship/fright-fest-2026";
import { CATALOGUE, currentVersion, getPack } from "../collectibles/catalogue";
import { candyInfo, describeEntry, gamePayouts, shopItems } from "./present";
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
  await s.listBoards("last-bell");
  await s.listBoards();
  await s.payingBoards();
  await s.setBoardCandy({ boardId: "last-bell-score", candy: 10, actorEmail: "a@b" });
  await s.revokeCredit({ ledgerId: 4, actorEmail: "a@b", reason: "r" });
  await s.listRecent();
  await s.topEarners();
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

  it("keeps board values whole numbers from 0 to 40", () => {
    expect([0, 2, 40].map((n) => isGameCandy(C, n))).toEqual([true, true, true]);
    expect([-1, 41, 2.5, NaN].map((n) => isGameCandy(C, n))).toEqual([false, false, false, false]);
    for (const tier of C.rubric) for (const p of tier.presets) expect(isGameCandy(C, p)).toBe(true);
    expect(C.maxGameCandy).toBe(40);
  });

  it("lists the daily-best shares and the owner's rubric", () => {
    expect(C.dailyBest).toEqual([
      { label: "1st", pct: 100 }, { label: "2nd–3rd", pct: 75 }, { label: "4th–10th", pct: 50 },
      { label: "Top half", pct: 25 }, { label: "On the board", pct: 5 },
    ]);
    expect(C.rubric.map((t) => [t.label, ...t.presets])).toEqual([
      ["Doesn't pay", 0], ["Clicker or idle game", 2], ["Easy game", 5], ["Normal game", 8, 10, 12],
      ["Challenging game", 15, 20], ["Difficult game", 25, 30], ["Exceptional game", 40],
    ]);
  });

  it("picks the share by rank, and the top half by ceil(n / 2)", () => {
    expect([1, 2, 3, 4, 10].map((r) => dailyBestPct(r, 100))).toEqual([100, 75, 75, 50, 50]);
    expect([11, 50, 51, 100].map((r) => dailyBestPct(r, 100))).toEqual([25, 25, 5, 5]);
    expect([12, 13].map((r) => dailyBestPct(r, 23))).toEqual([25, 5]); // ceil(23 / 2) = 12
    expect([12, 13].map((r) => dailyBestPct(r, 24))).toEqual([25, 5]); // ceil(24 / 2) = 12
    expect([13, 14].map((r) => dailyBestPct(r, 25))).toEqual([25, 5]); // ceil(25 / 2) = 13
    expect([1, 2, 3].map((r) => dailyBestPct(r, 2))).toEqual([100, 75, 75]); // a tier above beats "top half"
    expect([0, -1, 1.5].map((r) => dailyBestPct(r, 10))).toEqual([0, 0, 0]);
  });

  it("pays integer amounts: 40 / 30 / 20 / 10 / 2 on a 40 board and 2 / 2 / 1 / 1 / 1 on a 2 board", () => {
    const ranks = [1, 2, 4, 20, 80]; // 1st, 2nd-3rd, 4th-10th, top half, elsewhere, on a board of 100 rows
    expect(ranks.map((r) => dailyBestAmount(40, r, 100))).toEqual([40, 30, 20, 10, 2]);
    expect(ranks.map((r) => dailyBestAmount(2, r, 100))).toEqual([2, 2, 1, 1, 1]);
    expect([0, -3, 1.5].map((v) => dailyBestAmount(v, 1, 10))).toEqual([0, 0, 0]);
    expect(dailyBestAmount(1, 80, 100)).toBe(1); // never below 1 on a paying board
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
    for (const kind of ["daily_best", "ranked_run", "all_boards", "placing"]) {
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

  it("pays a daily best only for signed-in scores in the window, on a rated board, by UK day", async () => {
    const { sql, texts, values } = fakeSql();
    await createCandyStore(sql).sync(PLAYER);
    const i = texts.findIndex((t) => t.includes(":daily_best:"));
    const t = texts[i];
    expect(t).toMatch(/WHERE s\.player_id = \?/);
    expect(values[i]).toContain(PLAYER);
    expect(t).toMatch(/b\.game_slug IS NOT NULL AND b\.candy > 0/);
    expect(t).toMatch(/s\.created_at >= \?::timestamptz AND s\.created_at < \?::timestamptz/);
    expect(t).toMatch(/AT TIME ZONE 'Europe\/London'/);
    expect(t).toMatch(/DISTINCT ON \(s\.board_id, \(s\.created_at AT TIME ZONE 'Europe\/London'\)::date\)/);
    // rank.ts order: score by the board's sort, then the earlier created_at, then the lower id
    expect(t).toMatch(/CASE WHEN b\.sort = 'asc' THEN s\.score END ASC,\s*CASE WHEN b\.sort <> 'asc' THEN s\.score END DESC,\s*s\.created_at ASC, s\.id ASC/);
    // rank as of the moment it was set, on the Halloween board only: rows from opensAt to its own time, strictly better by the sort
    expect(t).toMatch(/x\.created_at >= \?::timestamptz AND x\.created_at <= best\.created_at/);
    expect(t).toMatch(/x\.score < best\.score ELSE x\.score > best\.score/);
    expect(values[i].filter((v) => v === C.opensAt)).toHaveLength(2);
    expect(t).toMatch(/WHEN r\.rank = 1 THEN 100\s*WHEN r\.rank <= 3 THEN 75\s*WHEN r\.rank <= 10 THEN 50\s*WHEN r\.rank <= \(r\.n \+ 1\) \/ 2 THEN 25\s*ELSE 5/);
    expect(t).toMatch(/GREATEST\(1, \(d\.candy::int \* d\.pct \+ 50\) \/ 100\)/);
    expect(t).toMatch(/':daily_best:' \|\| \?::text \|\| ':' \|\| d\.board_id \|\| ':' \|\| d\.day/);
    expect(t).toMatch(/d\.board_id \|\| '#' \|\| d\.day \|\| '#' \|\| d\.rank/);
    expect(t).not.toMatch(/achievement/i);
    expect(values[i]).toContain(C.closesAt);
  });

  it("never reads achievements any more", async () => {
    for (const t of await everyQuery()) expect(t).not.toMatch(/player_achievements|FROM achievements|JOIN achievements/);
  });

  it("credits runs only from ACCEPTED runs on counting boards, and placings only from the finalised snapshot", async () => {
    const { sql, texts, values } = fakeSql();
    await createCandyStore(sql).sync(PLAYER);
    const run = texts.find((t) => t.includes(":ranked_run:") && t.includes("INSERT"))!;
    expect(run).toMatch(/r\.status = 'accepted'/);
    expect(run).toMatch(/g\.status IN \('open','paused'\) AND g\.opened_at IS NOT NULL/);
    const all = texts.find((t) => t.includes(":all_boards:") && t.includes("INSERT"))!;
    expect(all).toMatch(/ev\.status IN \('finalised','archived'\) AND ev\.final_standings IS NOT NULL/);
    expect(all).toMatch(/final_standings->'overall'/);
    expect(all).toMatch(/o\.entry->>'eligible'\) = 'true'/);
    expect(all).not.toMatch(/championship_runs/); // never from live boards
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
    const rows = (t: string) => (t.includes(":daily_best:") ? [{ amount: 5 }, { amount: 8 }] : t.includes(":ranked_run:") && t.includes("INSERT") ? [{ amount: 10 }] : []);
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
  it("sets a board value only between 0 and 40, and logs in the same statement", async () => {
    const { sql, texts } = fakeSql();
    const s = createCandyStore(sql);
    const set = (boardId: string, candy: number) => s.setBoardCandy({ boardId, candy, actorEmail: "a" });
    await expect(set("b1", 41)).rejects.toThrow(/0 to 40/);
    await expect(set("b1", 1.5)).rejects.toThrow(/0 to 40/);
    await expect(set("B 1;", 1)).rejects.toThrow(/Invalid/);
    await expect(set("", 1)).rejects.toThrow(/Invalid/);
    expect(texts).toEqual([]);
    await set("b1", 12);
    expect(texts[0]).toMatch(/INSERT INTO candy_log/);
    expect(texts[0]).toMatch(/old\.candy <> \?::int/);
    expect(texts[0]).toMatch(/game_slug IS NOT NULL/);
    expect(texts[0]).toMatch(/'boardId', old\.id/);
  });

  it("maps the outcome of a set", async () => {
    const out = (found: number, changed: number) => createCandyStore(fakeSql(() => [{ found, changed, logged: changed }]).sql).setBoardCandy({ boardId: "b1", candy: 5, actorEmail: "a" });
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

  it("the board list can be filtered by game with a bound parameter, and counts only signed-in scores in the window", async () => {
    const { sql, texts, values } = fakeSql((t) => (t.includes("FROM boards b") ? [{ id: "b1", game_slug: "g", title: "Score", sort: "asc", candy: 5, scores: 7, players: 3 }] : []));
    const out = await createCandyStore(sql).listBoards("last-bell");
    expect(values[0]).toContain("last-bell");
    expect(texts[0]).toMatch(/s\.player_id IS NOT NULL/);
    expect(texts[0]).toMatch(/b\.game_slug IS NOT NULL/);
    expect(out).toEqual([{ id: "b1", gameSlug: "g", title: "Score", sort: "asc", candy: 5, scoresInWindow: 7, playersInWindow: 3 }]);
  });

  it("the public payout list reads only rated boards of a game", async () => {
    const { sql, texts } = fakeSql();
    await createCandyStore(sql).payingBoards();
    expect(texts[0]).toMatch(/game_slug IS NOT NULL AND candy > 0/);
  });
});

describe("topEarners and the per-player filter", () => {
  const row = {
    credited: 120, daily_best_total: 100, daily_best_count: 6, best_rank: 2, spent: 30, balance: 90,
    p_public_id: "00000000-0000-4000-8000-000000000001", p_handle: null, p_username: null,
  };

  it("maps rows to public names and totals, counting only unrevoked credits", async () => {
    const { sql, texts, values } = fakeSql(() => [row]);
    const out = await createCandyStore(sql).topEarners(10);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ credited: 120, dailyBestTotal: 100, dailyBestCount: 6, bestRank: 2, spent: 30, balance: 90 });
    expect(out[0].player.publicId).toBe(row.p_public_id);
    expect(Object.keys(out[0].player).sort()).toEqual(["name", "publicId"]);
    expect(texts[0]).toMatch(/FILTER \(WHERE amount > 0 AND revoked_at IS NULL\)/);
    expect(texts[0]).toMatch(/kind = 'daily_best' AND revoked_at IS NULL/);
    expect(texts[0]).not.toMatch(/achievement|date_trunc/i);
    expect(texts[0]).toMatch(/ORDER BY t\.credited DESC/);
    expect(values[0]).toContain("fright-fest-2026");
    expect(values[0]).toContain(10);
  });

  it("has no best rank for a player without a daily-best credit", async () => {
    const { sql } = fakeSql(() => [{ ...row, daily_best_total: 0, daily_best_count: 0, best_rank: null }]);
    expect((await createCandyStore(sql).topEarners(1))[0].bestRank).toBeNull();
  });

  it("clamps the limit and defaults to 25", async () => {
    const a = fakeSql();
    await createCandyStore(a.sql).topEarners();
    expect(a.values[0]).toContain(25);
    const b = fakeSql();
    await createCandyStore(b.sql).topEarners(9999);
    expect(b.values[0]).toContain(100);
  });

  it("listRecent filters to one player by public id when given", async () => {
    const { sql, texts, values } = fakeSql();
    await createCandyStore(sql).listRecent(50, row.p_public_id);
    expect(texts[0]).toMatch(/p\.public_id::text = \?::text/);
    expect(values[0]).toContain(row.p_public_id);
  });
});

describe("presentation", () => {
  const base = { id: 1, amount: 10, createdAt: "2026-10-28T10:00:00.000Z", revoked: false, gameSlug: null };
  it("words each kind of row for the player", () => {
    const titles = new Map([["duskfall", "Duskfall"]]);
    expect(describeEntry({ ...base, kind: "daily_best", ref: "duskfall-score#2026-10-29#3", gameSlug: "duskfall" }, titles)).toMatchObject({
      kind: "daily_best", label: "Best score on 29 Oct · 3rd", game: "Duskfall",
    });
    expect(describeEntry({ ...base, kind: "daily_best", ref: "x#2026-11-01#1", gameSlug: "unknown-game" }, titles)).toMatchObject({ label: "Best score on 1 Nov · 1st", game: "unknown-game" });
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

describe("the public payouts and rules", () => {
  it("lists paying boards by candy then game title, with the slug standing in for a missing title", () => {
    const titles = new Map([["a", "Alpha"], ["b", "Beta"]]);
    const boards = [
      { id: "b-1", gameSlug: "b", title: "Score", candy: 8 },
      { id: "a-1", gameSlug: "a", title: "Score", candy: 8 },
      { id: "z-1", gameSlug: "zed", title: "Time", candy: 40 },
      { id: "a-0", gameSlug: "a", title: "Unrated", candy: 0 },
    ];
    expect(gamePayouts(boards, titles)).toEqual([
      { boardId: "z-1", slug: "zed", title: "zed", boardTitle: "Time", candy: 40 },
      { boardId: "a-1", slug: "a", title: "Alpha", boardTitle: "Score", candy: 8 },
      { boardId: "b-1", slug: "b", title: "Beta", boardTitle: "Score", candy: 8 },
    ]);
  });

  it("publishes maxGameCandy and the daily-best shares, and no achievement ceiling", () => {
    const { rules } = candyInfo(C, 0);
    expect(rules.maxGameCandy).toBe(40);
    expect(rules.dailyBest).toEqual([
      { label: "1st", pct: 100 }, { label: "2nd–3rd", pct: 75 }, { label: "4th–10th", pct: 50 },
      { label: "Top half", pct: 25 }, { label: "On the board", pct: 5 },
    ]);
    expect(rules).not.toHaveProperty("maxAchievementCandy");
    expect(rules).toMatchObject({ rankedRun: 10, allBoards: 20 });
  });
});
