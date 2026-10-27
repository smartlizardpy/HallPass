import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE, cardsIn, collectionSymbolSrc, currentVersion, eligibleCards, PACK_PRINT_PX, packEmblemSrc, packFoilSrc, packPrintSrc, validateCatalogue } from "./index";
import { computeLock, type CatalogueLock } from "./lock";
import { rollPack, rollSlot } from "./roll";
import { ODDS } from "./odds";
import { RARITIES } from "./types";

const LOCK_PATH = join(__dirname, "catalogue.lock.json");
const PUBLIC = join(__dirname, "../../../../public");

describe("catalogue", () => {
  it("is valid", () => {
    expect(validateCatalogue(CATALOGUE)).toEqual([]);
  });

  it("has the launch shape", () => {
    // 5 live collections + 4 retired demo sets; 68 demo rows kept for their owners + 63 curated, 5 of them the ff26 prize ids re-used.
    expect(CATALOGUE.collections.filter((c) => !c.retired).map((c) => c.id)).toEqual(["ff26", "legends", "brainrot", "turkish", "gaming"]);
    expect(CATALOGUE.collections.filter((c) => c.retired).map((c) => c.id).sort()).toEqual(["brr", "hpo", "inet", "tr"]);
    expect(CATALOGUE.collectibles).toHaveLength(68 - 5 + 63);
    const live = (id: string) => CATALOGUE.collectibles.filter((c) => c.collection === id && !c.retired);
    expect(["ff26", "legends", "brainrot", "turkish", "gaming"].map((id) => live(id).length)).toEqual([20, 12, 13, 9, 9]);
    expect(CATALOGUE.packs.map((p) => p.id)).toEqual([
      "ff26-participation", "ff26-winner-last-bell", "ff26-winner-shadow-core", "ff26-winner-survive-till-dawn",
      "ff26-overall-winner", "hpo-standard", "inet-standard", "brr-standard", "tr-standard",
      "hpo-rare", "inet-rare", "brr-rare", "tr-rare",
      "legends-standard", "brainrot-standard", "turkish-standard", "gaming-standard",
      "legends-rare", "brainrot-rare", "turkish-rare", "gaming-rare",
    ]);
    for (const p of CATALOGUE.packs) expect(currentVersion(p).size).toBe(3);
    // The demo sets' packs are closed (nothing grants them) but keep every version for sealed copies.
    expect(CATALOGUE.packs.filter((p) => p.closed).map((p) => p.collection).sort()).toEqual(["brr", "brr", "hpo", "hpo", "inet", "inet", "tr", "tr"]);
  });

  it("odds tables sum to 100", () => {
    for (const t of Object.values(ODDS)) expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("the Rare packs are one standard roll then two rare-or-better; Everyday packs are three standard rolls", () => {
    for (const col of ["hpo", "inet", "turkish"]) {
      const pack = CATALOGUE.packs.find((p) => p.id === `${col}-rare`)!;
      expect(pack.versions).toHaveLength(1);
      expect(pack.description).toMatch(/Halloween Candy/);
      expect(currentVersion(pack).slots).toEqual([
        { kind: "random", pool: col, rarityWeights: ODDS.standard },
        { kind: "random", pool: col, rarityWeights: ODDS.rareOrBetter },
        { kind: "random", pool: col, rarityWeights: ODDS.rareOrBetter },
      ]);
    }
  });

  it("a pool missing a tier moves that weight one tier down, and only in the new pack versions", () => {
    const slots = (id: string) => currentVersion(CATALOGUE.packs.find((p) => p.id === id)!).slots.map((s) => (s.kind === "random" ? s.rarityWeights : null));
    expect(slots("legends-rare")).toEqual([ODDS.standardNoEpic, ODDS.rareOrBetterNoEpic, ODDS.rareOrBetterNoEpic]);
    expect(ODDS.standardNoEpic).toEqual({ common: 60, uncommon: 25, rare: 14, legendary: 1 }); // epic 4 → rare
    expect(ODDS.rareOrBetterNoEpic).toEqual({ rare: 95, legendary: 5 }); // epic 20 → rare
    expect(slots("brainrot-standard")).toEqual([ODDS.standardNoLegendary, ODDS.standardNoLegendary, ODDS.standardNoLegendary]);
    expect(slots("gaming-rare")).toEqual([ODDS.standardNoLegendary, ODDS.rareOrBetterNoLegendary, ODDS.rareOrBetterNoLegendary]);
    expect(ODDS.standardNoLegendary).toEqual({ common: 60, uncommon: 25, rare: 10, epic: 5 }); // legendary 1 → epic
    expect(ODDS.rareOrBetterNoLegendary).toEqual({ rare: 75, epic: 25 }); // legendary 5 → epic
    expect(slots("turkish-rare")).toEqual([ODDS.standard, ODDS.rareOrBetter, ODDS.rareOrBetter]); // turkish has all five tiers
    for (const id of ["ff26-participation", "ff26-winner-last-bell", "ff26-winner-shadow-core", "ff26-winner-survive-till-dawn", "ff26-overall-winner"]) {
      expect(CATALOGUE.packs.find((p) => p.id === id)!.versions.map((v) => v.v), id).toEqual([1, 2]);
    }
  });

  it("the Fright Fest prize cards are fixed-slot only: no pool can roll them, in any version", () => {
    const prize = CATALOGUE.collectibles.filter((c) => c.pool === "commemorative");
    expect(prize.map((c) => c.id).sort()).toEqual([
      "ff26-champion-last-bell", "ff26-champion-shadow-core", "ff26-champion-survive-till-dawn", "ff26-overall-champion", "ff26-survivor",
    ]);
    const pools = new Set(CATALOGUE.packs.flatMap((p) => p.versions.flatMap((v) => v.slots.flatMap((s) => (s.kind === "random" ? [s.pool] : [])))));
    for (const pool of pools) for (const c of prize) expect(eligibleCards(CATALOGUE, pool).map((x) => x.id)).not.toContain(c.id);
    expect(prize.find((c) => c.id === "ff26-overall-champion")!.name).toMatch(/GOLDEN TICKET/);
    // The Golden Ticket is fixed in the Overall pack and appears nowhere else.
    const holders = CATALOGUE.packs.filter((p) => p.versions.some((v) => v.slots.some((s) => s.kind === "fixed" && s.collectible === "ff26-overall-champion")));
    expect(holders.map((p) => p.id)).toEqual(["ff26-overall-winner"]);
  });

  it("the curated set keeps the manifest's rarities and counts per pool", () => {
    const tally = (col: string) => Object.fromEntries(RARITIES.map((r) => [r, eligibleCards(CATALOGUE, col).filter((c) => c.rarity === r).length]));
    expect(tally("legends")).toEqual({ common: 4, uncommon: 3, rare: 2, epic: 0, legendary: 3 });
    expect(tally("brainrot")).toEqual({ common: 6, uncommon: 3, rare: 2, epic: 2, legendary: 0 });
    expect(tally("turkish")).toEqual({ common: 2, uncommon: 3, rare: 2, epic: 1, legendary: 1 });
    expect(tally("gaming")).toEqual({ common: 3, uncommon: 3, rare: 2, epic: 1, legendary: 0 });
    expect(tally("ff26")).toEqual({ common: 7, uncommon: 3, rare: 3, epic: 2, legendary: 0 });
  });

  it("never lets a commemorative or retired card into a random slot", () => {
    for (const p of CATALOGUE.packs) {
      for (const v of p.versions) {
        for (const s of v.slots) {
          if (s.kind !== "random") continue;
          for (const c of eligibleCards(CATALOGUE, s.pool)) {
            expect(c.pool).toBe("standard");
            expect(c.retired).toBeUndefined();
          }
        }
      }
    }
    expect(CATALOGUE.collectibles.filter((c) => c.pool === "commemorative").map((c) => c.id).sort()).toEqual([
      "ff26-champion-last-bell", "ff26-champion-shadow-core", "ff26-champion-survive-till-dawn", "ff26-overall-champion", "ff26-survivor",
    ]);
  });

  it("every rarity a current pack version can roll has an eligible card", () => {
    for (const p of CATALOGUE.packs) {
      for (const s of currentVersion(p).slots) {
        if (s.kind !== "random") continue;
        for (const r of RARITIES) if ((s.rarityWeights[r] ?? 0) > 0) expect(eligibleCards(CATALOGUE, s.pool).some((c) => c.rarity === r), `${p.id}/${r}`).toBe(true);
      }
    }
  });

  it("catches a broken catalogue", () => {
    const broken = { ...CATALOGUE, packs: [{ ...CATALOGUE.packs[0], versions: [{ v: 1, size: 2, slots: [{ kind: "random" as const, pool: "ff26", rarityWeights: { common: 99 } }] }] }] };
    const problems = validateCatalogue(broken).join("\n");
    expect(problems).toMatch(/size 2 does not match 1 slots/);
    expect(problems).toMatch(/sum to 99/);
  });

  it("has art on disk for every card, emblem and symbol, at the right size", () => {
    const pngSize = (path: string) => {
      const b = readFileSync(path);
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    for (const c of CATALOGUE.collectibles) {
      const file = join(PUBLIC, c.art.src);
      expect(existsSync(file), c.art.src).toBe(true);
      if (c.art.layout === "full") {
        // Finished 5:7 faces: a high-resolution reveal image and a light binder thumbnail, both WebP.
        expect(c.art.status, c.id).toBe("final");
        expect(existsSync(join(PUBLIC, c.art.thumb!)), c.art.thumb).toBe(true);
        // The one animated card (158 frames) is the exception to the 600 KB still-image budget.
        expect(statSync(file).size, `${c.art.src} over its budget`).toBeLessThanOrEqual((c.art.src.includes("whaaa") ? 4500 : 600) * 1024);
        expect(statSync(join(PUBLIC, c.art.thumb!)).size, `${c.art.thumb} over 120 KB`).toBeLessThanOrEqual(120 * 1024);
        continue;
      }
      expect(statSync(file).size, `${c.art.src} over 2 KB`).toBeLessThanOrEqual(2048);
      const [w, h] = pngSize(file);
      const want = c.rarity === "common" || c.rarity === "uncommon" ? 32 : 48;
      expect([w, h], c.id).toEqual([want, want]);
    }
    for (const col of CATALOGUE.collections) {
      expect(pngSize(join(PUBLIC, packEmblemSrc(col.id)))).toEqual([48, 48]);
      expect(pngSize(join(PUBLIC, collectionSymbolSrc(col.id)))).toEqual([16, 16]);
      expect(cardsIn(col.id).length).toBeGreaterThan(0);
    }
  });

  it("has a print and a foil mask for every pack, at the print size", () => {
    const pngSize = (path: string) => {
      const b = readFileSync(path);
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    for (const p of CATALOGUE.packs) {
      for (const src of [packPrintSrc(p.id), packFoilSrc(p.id)]) {
        const file = join(PUBLIC, src);
        expect(existsSync(file), src).toBe(true);
        expect(statSync(file).size, `${src} over 8 KB`).toBeLessThanOrEqual(8192);
        expect(pngSize(file), src).toEqual([PACK_PRINT_PX.w, PACK_PRINT_PX.h]);
      }
    }
  });
});

describe("rolling", () => {
  const seq = (...ns: number[]) => {
    let i = 0;
    return (max: number) => {
      const n = ns[i++ % ns.length];
      expect(n).toBeLessThan(max);
      return n;
    };
  };

  it("fixed slots return their card, random slots follow the weights", () => {
    const v = currentVersion(CATALOGUE.packs.find((p) => p.id === "ff26-participation")!);
    expect(rollSlot(CATALOGUE, v.slots[0], seq(0))).toBe("ff26-survivor");
    // 59 → common (first of 5), 60 → uncommon, 99 → the last tier
    const std = currentVersion(CATALOGUE.packs.find((p) => p.id === "ff26-participation")!).slots[1];
    const rarityOf = (roll: number) => CATALOGUE.collectibles.find((c) => c.id === rollSlot(CATALOGUE, std, seq(roll, 0)))!.rarity;
    expect([59, 60, 84, 85, 95, 99].map(rarityOf)).toEqual(["common", "uncommon", "uncommon", "rare", "epic", "epic"]);
    expect(v.slots[0]).toEqual({ kind: "fixed", collectible: "ff26-survivor" });
  });

  it("the overall pack (v2) gives the Golden Ticket and two epics", () => {
    const pack = CATALOGUE.packs.find((p) => p.id === "ff26-overall-winner")!;
    for (let i = 0; i < 200; i++) {
      const [ticket, a, b] = rollPack(CATALOGUE, currentVersion(pack));
      expect(ticket).toBe("ff26-overall-champion");
      for (const id of [a, b]) expect(CATALOGUE.collectibles.find((c) => c.id === id)).toMatchObject({ rarity: "epic", pool: "standard" });
    }
  });

  it("a SEALED v1 Fright Fest pack still opens, after its pool lost its demo cards", () => {
    // v1 can roll a legendary the curated pool no longer has: the roller falls to the nearest lower tier.
    const v1 = CATALOGUE.packs.find((p) => p.id === "ff26-participation")!.versions[0];
    for (let n = 0; n < 100; n++) {
      const ids = rollPack(CATALOGUE, v1, (max) => Math.min(n, max - 1));
      expect(ids[0]).toBe("ff26-survivor");
      for (const id of ids.slice(1)) expect(CATALOGUE.collectibles.find((c) => c.id === id)).toMatchObject({ pool: "standard", collection: "ff26" });
    }
    const rolled = rollSlot(CATALOGUE, v1.slots[1], seq(99, 0));
    expect(CATALOGUE.collectibles.find((c) => c.id === rolled)!.rarity).toBe("epic");
  });

  it("every pack opens, on every current version, with the real RNG (no throw, only eligible cards)", () => {
    for (const p of CATALOGUE.packs) {
      for (let i = 0; i < 300; i++) {
        const ids = rollPack(CATALOGUE, currentVersion(p));
        expect(ids).toHaveLength(3);
        for (const id of ids) expect(CATALOGUE.collectibles.some((c) => c.id === id), `${p.id}: ${id}`).toBe(true);
      }
    }
  });

  it("the real RNG only ever yields eligible cards, and respects rare-or-better", () => {
    const v = currentVersion(CATALOGUE.packs.find((p) => p.id === "ff26-winner-last-bell")!);
    for (let i = 0; i < 300; i++) {
      const [champ, rare] = rollPack(CATALOGUE, v);
      expect(champ).toBe("ff26-champion-last-bell");
      expect(["rare", "epic", "legendary"]).toContain(CATALOGUE.collectibles.find((c) => c.id === rare)!.rarity);
    }
  });
});

describe("catalogue.lock.json", () => {
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as CatalogueLock;
  const live = computeLock(CATALOGUE);

  it("published pack versions never change", () => {
    for (const [key, hash] of Object.entries(lock.packs)) {
      expect(live.packs[key], `${key} was removed or edited: add a new version instead`).toBe(hash);
    }
  });

  it("published collectibles never disappear", () => {
    for (const id of lock.collectibles) expect(live.collectibles, `${id} was deleted: retire it instead`).toContain(id);
  });

  it("anything new is locked too (regenerate with UPDATE_CATALOGUE_LOCK=1)", () => {
    expect(Object.keys(live.packs).sort()).toEqual(Object.keys(lock.packs).sort());
    expect(live.collectibles).toEqual([...lock.collectibles].sort());
  });
});

// `UPDATE_CATALOGUE_LOCK=1 npx vitest run app/lib/collectibles/catalogue` adds NEW entries to the lock.
// It never rewrites or removes an existing hash, so it cannot be used to bless an edit.
if (process.env.UPDATE_CATALOGUE_LOCK === "1") {
  const old = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as CatalogueLock;
  const live = computeLock(CATALOGUE);
  const merged: CatalogueLock = { packs: { ...live.packs, ...old.packs }, collectibles: [...new Set([...old.collectibles, ...live.collectibles])].sort() };
  writeFileSync(LOCK_PATH, JSON.stringify(merged, null, 2) + "\n");
}
