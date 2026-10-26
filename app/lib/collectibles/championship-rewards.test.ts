import { describe, expect, it, vi } from "vitest";
import { CHAMPIONSHIPS } from "../championship/config";
import { FRIGHT_FEST_2026 as C } from "../championship/fright-fest-2026";
import { getPack } from "./catalogue";
import { describeRewards, grantsFromSnapshot, payChampionshipRewards, type RewardsDeps } from "./championship-rewards";

const awards = {
  overallChampion: "pub-a",
  gameChampions: { "last-bell": "pub-b" },
  participants: ["pub-a", "pub-c"],
};

function deps(over: Partial<RewardsDeps> = {}): RewardsDeps & { keys: string[] } {
  const keys: string[] = [];
  const granted = new Set<string>();
  return {
    keys,
    finalStandings: async () => ({ boards: [], overall: [], awards }),
    internalIds: async (ids) => new Map(ids.filter((id) => id !== "pub-gone").map((id) => [id, `g-${id.slice(4)}`])),
    grantPack: vi.fn(async (input) => {
      keys.push(input.grantKey);
      const created = !granted.has(input.grantKey);
      granted.add(input.grantKey);
      return { created, pack: {} as never };
    }),
    ...over,
  };
}

describe("every championship reward is a real pack", () => {
  it("names packs that exist in the catalogue", () => {
    for (const c of CHAMPIONSHIPS) {
      const ids = [c.rewards.participation, c.rewards.overallChampion, ...Object.values(c.rewards.gameChampion)];
      for (const id of ids) expect(getPack(id), `${c.id}: ${id}`).toBeDefined();
    }
  });
});

describe("grantsFromSnapshot", () => {
  it("reads the frozen awards, in config order, and nothing from live data", () => {
    expect(grantsFromSnapshot(C, { awards })).toEqual([
      { kind: "overall-champion", publicId: "pub-a", packId: "ff26-overall-winner" },
      { kind: "game-champion", publicId: "pub-b", packId: "ff26-winner-last-bell", gameSlug: "last-bell" },
      { kind: "participation", publicId: "pub-a", packId: "ff26-participation" },
      { kind: "participation", publicId: "pub-c", packId: "ff26-participation" },
    ]);
  });
  it("is null when nothing was finalised", () => {
    expect(grantsFromSnapshot(C, null)).toBeNull();
    expect(grantsFromSnapshot(C, { boards: [] })).toBeNull();
  });
});

describe("payChampionshipRewards", () => {
  it("grants each award once, with the championship's grant keys, and is safe to run again", async () => {
    const d = deps();
    const first = await payChampionshipRewards(C, d);
    expect(first).toEqual({ decided: 4, created: 4, already: 0, missingPlayer: 0, unknownPack: 0, failed: 0 });
    expect(d.keys).toEqual([
      "fright-fest-2026:overall:g-a",
      "fright-fest-2026:champion:last-bell:g-b",
      "fright-fest-2026:participation:g-a",
      "fright-fest-2026:participation:g-c",
    ]);
    const second = await payChampionshipRewards(C, d);
    expect(second).toMatchObject({ created: 0, already: 4 });
    expect(describeRewards(second as never)).toBe("4 rewards: 0 granted now, 4 already granted.");
  });
  it("skips a deleted account, keeps going past a failure, and refuses before finalisation", async () => {
    const d = deps({
      finalStandings: async () => ({ awards: { overallChampion: null, gameChampions: {}, participants: ["pub-gone", "pub-x", "pub-y"] } }),
    });
    let calls = 0;
    d.grantPack = async () => {
      if (++calls === 1) throw new Error("relation player_packs does not exist");
      return { created: true, pack: {} as never };
    };
    expect(await payChampionshipRewards(C, d)).toMatchObject({ decided: 3, missingPlayer: 1, failed: 1, created: 1 });
    expect(await payChampionshipRewards(C, deps({ finalStandings: async () => null }))).toEqual({ error: "not-final" });
  });
});
