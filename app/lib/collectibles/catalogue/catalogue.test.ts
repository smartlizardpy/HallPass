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
    expect(CATALOGUE.collections).toHaveLength(5);
    expect(CATALOGUE.collectibles).toHaveLength(68);
    expect(CATALOGUE.packs.map((p) => p.id)).toEqual([
      "ff26-participation", "ff26-winner-last-bell", "ff26-winner-shadow-core", "ff26-winner-survive-till-dawn",
      "ff26-overall-winner", "hpo-standard", "inet-standard", "brr-standard", "tr-standard",
    ]);
    for (const p of CATALOGUE.packs) expect(currentVersion(p).size).toBe(3);
  });

  it("odds tables sum to 100", () => {
    for (const t of Object.values(ODDS)) expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(100);
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

  it("every rarity a random slot can roll has an eligible card (all five, in every collection)", () => {
    for (const col of CATALOGUE.collections) for (const r of RARITIES) expect(eligibleCards(CATALOGUE, col.id).some((c) => c.rarity === r), `${col.id}/${r}`).toBe(true);
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
    // 59 → common (first of 5), 60 → uncommon, 99 → legendary
    const std = v.slots[1];
    expect(rollSlot(CATALOGUE, std, seq(59, 0))).toBe("ff26-cobweb-bell");
    expect(rollSlot(CATALOGUE, std, seq(60, 0))).toBe("ff26-room-000");
    expect(rollSlot(CATALOGUE, std, seq(84, 0))).toBe("ff26-room-000");
    expect(rollSlot(CATALOGUE, std, seq(85, 0))).toBe("ff26-shadow-dash");
    expect(rollSlot(CATALOGUE, std, seq(99, 0))).toBe("ff26-the-last-bell");
  });

  it("the overall pack gives the Last Bell and an epic-or-better third card", () => {
    const v = currentVersion(CATALOGUE.packs.find((p) => p.id === "ff26-overall-winner")!);
    expect(rollPack(CATALOGUE, v, seq(0))).toEqual(["ff26-overall-champion", "ff26-the-last-bell", "ff26-blood-moon"]);
    expect(rollPack(CATALOGUE, v, seq(80, 0))[2]).toBe("ff26-the-last-bell");
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
