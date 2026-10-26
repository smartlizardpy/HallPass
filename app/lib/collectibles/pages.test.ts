import { describe, expect, it } from "vitest";
import { CATALOGUE, getCollectible } from "./catalogue";
import { collectionProgress } from "./progress";
import { batches, binderGroups, cardPath, cardSources, formatOdds, formatProgress, freeSlots, newIds, packViews, type OwnedEntry } from "./pages";

const entry = (id: string, extra: Partial<OwnedEntry> = {}): OwnedEntry => ({
  collectibleId: id,
  owned: 1,
  firstPulledAt: "2026-10-28T10:00:00Z",
  favourite: false,
  featuredPosition: null,
  isNew: false,
  ...extra,
});

describe("binder grouping", () => {
  const binder = [entry("ff26-survivor", { isNew: true }), entry("ff26-the-last-bell", { owned: 2 })];
  const progress = collectionProgress(binder);

  it("lists every collection with every card, in number order, owned ones paired", () => {
    const groups = binderGroups(binder, progress, { collection: "all", rarity: "all" });
    expect(groups.map((g) => g.collection)).toEqual(CATALOGUE.collections.slice().sort((a, b) => a.sort - b.sort).map((c) => c.id));
    const ff = groups[0];
    expect(ff.cells.map((c) => c.card.number)).toEqual([...ff.cells.map((c) => c.card.number)].sort((a, b) => a - b));
    expect(ff.cells.filter((c) => c.entry).length).toBe(2);
    expect(ff.cells.length).toBe(ff.progress.total);
  });
  it("filters by collection and rarity without changing progress", () => {
    const groups = binderGroups(binder, progress, { collection: "ff26", rarity: "legendary" });
    expect(groups).toHaveLength(1);
    expect(groups[0].cells.every((c) => c.card.rarity === "legendary")).toBe(true);
    expect(groups[0].progress.owned).toBe(2);
  });
  it("formats progress", () => {
    expect(formatProgress({ owned: 12, total: 20, percent: 60 })).toBe("12 of 20 · 60%");
  });
  it("finds NEW cards and batches them", () => {
    expect(newIds(binder)).toEqual(["ff26-survivor"]);
    expect(batches(Array.from({ length: 205 }, (_, i) => i), 100).map((b) => b.length)).toEqual([100, 100, 5]);
    expect(batches([], 100)).toEqual([]);
  });
  it("reports who holds each featured slot", () => {
    const slots = freeSlots([entry("a", { featuredPosition: 2 })], 6);
    expect(slots).toHaveLength(6);
    expect(slots[1]).toEqual({ slot: 2, heldBy: "a" });
    expect(slots[0].heldBy).toBeNull();
  });
});

describe("pack pages", () => {
  it("formats odds in rarity order, skipping zero rarities", () => {
    expect(formatOdds({ legendary: 20, epic: 80 }).map((o) => `${o.label} ${o.percent}`)).toEqual(["Epic 80", "Legendary 20"]);
  });
  it("describes every pack's current version, with odds summing to 100", () => {
    const views = packViews();
    expect(views).toHaveLength(CATALOGUE.packs.length);
    for (const v of views) {
      expect(v.slots).toHaveLength(v.pack.versions[v.pack.versions.length - 1].size);
      for (const s of v.slots) {
        if (s.kind === "fixed") expect(s.card).toBeDefined();
        else expect(s.odds!.reduce((n, o) => n + o.percent, 0)).toBe(100);
      }
    }
  });
});

describe("how a card can be obtained", () => {
  it("names the fixed pack for a commemorative card, and never chance", () => {
    const c = getCollectible("ff26-overall-champion")!;
    const src = cardSources(c);
    expect(src.length).toBeGreaterThan(0);
    expect(src.every((s) => s.how === "fixed")).toBe(true);
  });
  it("marks standard cards as chance in their collection's packs", () => {
    const c = CATALOGUE.collectibles.find((x) => x.collection === "hpo" && x.pool === "standard" && x.rarity === "common")!;
    expect(cardSources(c)).toEqual([{ pack: CATALOGUE.packs.find((p) => p.id === "hpo-standard")!, how: "chance" }]);
  });
  it("builds a share path with only the card id", () => {
    expect(cardPath("ff26-survivor")).toBe("/collectibles/ff26-survivor");
  });
});
