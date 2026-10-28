import { describe, expect, it } from "vitest";
import { awardsFrom, grantKey, publicAwards } from "./awards";
import { FRIGHT_FEST_2026 as C } from "./fright-fest-2026";
import { buildStandings, type BestRun } from "./standings";
import type { GameState } from "./types";

const SC = C.games[1].slug;
let id = 1;
const run = (game: string, p: string, score: number, tb = 1): BestRun => ({
  runId: id++, gameSlug: game, playerId: `g-${p}`, publicId: `pub-${p}`, name: p, avatar: "", score, tiebreak: tb, submittedAt: "2026-10-29T10:00:00Z",
});
const open = (slug: string): GameState => ({ slug, status: "open", openedAt: "2026-10-28T00:00:00Z" });

describe("awards", () => {
  it("pays the overall champion, each board's winner and every eligible player, with stable keys", () => {
    const s = buildStandings(C, "verification", [open("last-bell"), open(SC)], [
      run("last-bell", "solo", 480 - 40), // wins Last Bell, never played SCP: Lockdown
      run("last-bell", "both", 300),
      run(SC, "both", 100_000, 0),
    ]);
    const awards = awardsFrom(C, s);
    expect(awards.map((a) => [a.kind, a.publicId, a.packId, a.gameSlug ?? null])).toEqual([
      ["overall-champion", "pub-both", "ff26-overall-winner", null],
      ["game-champion", "pub-solo", "ff26-winner-last-bell", "last-bell"],
      ["game-champion", "pub-both", "ff26-winner-scp-lockdown", SC],
      ["participation", "pub-both", "ff26-participation", null],
    ]);
    expect(awards.map((a) => a.grantKey)).toEqual([
      "fright-fest-2026:overall:g-both",
      "fright-fest-2026:champion:last-bell:g-solo",
      `fright-fest-2026:champion:${SC}:g-both`,
      "fright-fest-2026:participation:g-both",
    ]);
    expect(grantKey(C, "participation", "g-x")).toBe("fright-fest-2026:participation:g-x");
  });

  it("awards nothing for a board that never counted, and no overall champion without an eligible player", () => {
    const s = buildStandings(C, "verification", [open("last-bell"), open(SC)], [run("last-bell", "a", 300)]);
    expect(awardsFrom(C, s).map((a) => a.kind)).toEqual(["game-champion"]);
    expect(awardsFrom(C, buildStandings(C, "verification", [open("last-bell")], []))).toEqual([]);
  });

  it("has a public form with public ids only", () => {
    const s = buildStandings(C, "verification", [open("last-bell")], [run("last-bell", "a", 300), run("last-bell", "b", 200)]);
    const pub = publicAwards(awardsFrom(C, s));
    expect(pub).toEqual({ overallChampion: "pub-a", gameChampions: { "last-bell": "pub-a" }, participants: ["pub-a", "pub-b"] });
    expect(JSON.stringify(pub)).not.toMatch(/g-a|g-b/);
  });
});
