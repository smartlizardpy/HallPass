/**
 * The championship store's SQL is exercised against real Postgres separately
 * (see docs/championship-design.md, "Verification"); these tests pin the two
 * properties that must never regress quietly: no query reads a player's
 * private columns, and every write carries its guard.
 */
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createChampionshipStore, publicPlayer } from "./store";

function fakeSql() {
  const texts: string[] = [];
  const fn = (strings: TemplateStringsArray) => {
    texts.push(strings.join("?"));
    return Promise.resolve([]);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, texts };
}

async function everyQuery() {
  const { sql, texts } = fakeSql();
  const s = createChampionshipStore(sql);
  const E = "fright-fest-2026";
  await s.readEvent(E);
  await s.issueToken({ eventId: E, gameSlug: "g", playerId: "p", tokenHash: "h", seed: null, ttlSec: 1, limit: 1, windowSec: 1 });
  await s.findRun({ tokenHash: "h", playerId: "p", eventId: E, gameSlug: "g" });
  await s.completeRun({ runId: 1, playerId: "p", eventId: E, gameSlug: "g", status: "accepted", score: 1, tiebreak: null, meta: {}, checks: {}, flags: [], reason: null, minGapSec: 1 });
  await s.bestRuns(E, [{ slug: "g", metric: { sort: "desc", label: "", format: "integer", tiebreakLabel: "", tiebreakSort: "asc", tiebreakFormat: "integer" } }]);
  await s.playerRuns(E, "p");
  await s.listRuns(E, {});
  await s.runCounts(E);
  await s.reviewRun({ eventId: E, runId: 1, action: "approve-run", actorEmail: "a", actorPlayerId: null, reason: null });
  await s.setGameStatus({ eventId: E, gameSlug: "g", action: "open-game", actorEmail: "a", reason: null });
  await s.setEventState({ eventId: E, action: "suspend", actorEmail: "a", reason: null });
  await s.finalise({ eventId: E, actorEmail: "a", snapshot: {} });
  await s.finalStandings(E);
  await s.readLog(E);
  await s.publicPlayers(["00000000-0000-0000-0000-000000000000"]);
  await s.internalIds(["00000000-0000-0000-0000-000000000000"]);
  return texts;
}

describe("championship store", () => {
  it("never selects a player's Google name, email or photo", async () => {
    for (const text of await everyQuery()) {
      expect(text).not.toMatch(/\bp\.(name|email|image|\*)|players\.(name|email|image)\b|SELECT \*\s+FROM players/i);
    }
  });

  it("guards every write", async () => {
    const texts = await everyQuery();
    const complete = texts.find((t) => t.startsWith("\n      UPDATE championship_runs SET"))!;
    expect(complete).toMatch(/status = 'issued'/);
    expect(complete).toMatch(/AND player_id = \?/);
    const review = texts.find((t) => t.includes("reviewed_by ="))!;
    expect(review).toMatch(/player_id IS DISTINCT FROM/); // nobody reviews their own run
    expect(review).toMatch(/status IN \('scheduled','verification'\)/); // nothing changes after finalisation
    expect(review).toMatch(/INSERT INTO championship_log/);
    const finalise = texts.find((t) => t.includes("final_standings ="))!;
    expect(finalise).toMatch(/status = 'verification'/);
    expect(finalise).toMatch(/NOT EXISTS \(SELECT 1 FROM championship_runs WHERE event_id = \? AND status = 'flagged'\)/);
  });

  it("names players publicly, never from private columns", () => {
    expect(publicPlayer({ p_public_id: "11111111-1111-1111-1111-111111111111", p_handle: null, p_username: "ana" }).name).toBe("@ana");
    expect(publicPlayer({ p_public_id: "11111111-1111-1111-1111-111111111111", p_handle: "ANA", p_username: "ana" }).name).toBe("ANA");
    expect(publicPlayer({ p_public_id: "11111111-1111-1111-1111-111111111111", name: "Ana Real" }).name).not.toContain("Ana Real");
  });
});
