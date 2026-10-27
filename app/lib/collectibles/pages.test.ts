import { describe, expect, it } from "vitest";
import { CATALOGUE, currentVersion, getCollectible, RARITIES } from "./catalogue";
import { RARITY_LABEL } from "./present";
import { collectionProgress } from "./progress";
import { batches, binderGroups, cardPath, cardSources, formatOdds, formatProgress, freeSlots, newIds, packGroups, packViews, slotLine, type OwnedEntry } from "./pages";

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
    // The retired demo sets (hpo, inet, brr, tr) show only to people who own one of their cards.
    expect(groups.map((g) => g.collection)).toEqual(CATALOGUE.collections.filter((c) => !c.retired).sort((a, b) => a.sort - b.sort).map((c) => c.id));
    const ff = groups[0];
    const current = ff.cells.filter((c) => !c.card.retired).map((c) => c.card.number);
    expect(current).toEqual([...current].sort((a, b) => a - b));
    expect(ff.cells.at(-1)!.card.retired).toBe(true); // an owned retired card sits after the current set
    expect(ff.cells.filter((c) => c.entry).length).toBe(2);
    // 20 current cards plus the one retired demo card this player owns.
    expect(ff.cells.length).toBe(ff.progress.total + 1);
    expect(ff.cells.filter((c) => c.card.retired && !c.entry)).toEqual([]);
  });
  it("shows a retired collection to the people who own a card in it, and nobody else", () => {
    const owner = [entry("hpo-hall-pass")];
    const groups = binderGroups(owner, collectionProgress(owner), { collection: "all", rarity: "all" });
    expect(groups.map((g) => g.collection)).toContain("hpo");
    expect(groups.find((g) => g.collection === "hpo")!.cells.map((c) => c.card.id)).toHaveLength(12);
  });
  it("filters by collection and rarity without changing progress", () => {
    const groups = binderGroups(binder, progress, { collection: "ff26", rarity: "legendary" });
    expect(groups).toHaveLength(1);
    expect(groups[0].cells.every((c) => c.card.rarity === "legendary")).toBe(true);
    // Only the survivor card is a current card; the retired demo Last Bell is owned but outside the set to complete.
    expect(groups[0].progress.owned).toBe(1);
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
    // Closed packs (the retired demo sets) are not described: nothing grants them any more.
    expect(views).toHaveLength(CATALOGUE.packs.filter((p) => !p.closed).length);
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
    const c = CATALOGUE.collectibles.find((x) => x.collection === "turkish" && x.pool === "standard" && x.rarity === "common")!;
    // The Rare pack's first slot is a standard roll too, so a common can come from it.
    expect(cardSources(c)).toEqual([
      { pack: CATALOGUE.packs.find((p) => p.id === "turkish-standard")!, how: "chance" },
      { pack: CATALOGUE.packs.find((p) => p.id === "turkish-rare")!, how: "chance" },
    ]);
    // A retired demo card, or one whose only packs are closed, can no longer be pulled.
    expect(cardSources(getCollectible("hpo-hall-pass")!)).toEqual([]);
  });
  it("builds a share path with only the card id", () => {
    expect(cardPath("ff26-survivor")).toBe("/collectibles/ff26-survivor");
  });
});

describe("pack contents text", () => {
  it("publishes every pack, fixed card, rarity and percentage word for word", () => {
    for (const { pack, slots } of packViews()) {
      expect(slots.length).toBeGreaterThan(0);
      const catalogueSlots = currentVersion(pack).slots;
      for (const s of slots) {
        const raw = catalogueSlots[s.n - 1];
        const line = slotLine(s);
        if (raw.kind === "fixed") {
          const card = getCollectible(raw.collectible);
          expect(card, `${pack.id} slot ${s.n}`).toBeDefined();
          expect(line).toBe(`Slot ${s.n}. Always ${card!.name} (${RARITY_LABEL[card!.rarity].toLowerCase()}).`);
        } else {
          const expected = RARITIES.filter((r) => raw.rarityWeights[r])
            .map((r) => `${raw.rarityWeights[r]}% ${r}`)
            .join(", ");
          expect(line).toBe(`Slot ${s.n}. One card from ${s.poolName}: ${expected}.`);
        }
      }
    }
  });
  it("reads the sentence the page has always shown", () => {
    const ff = packViews().find((v) => v.pack.id === "ff26-participation")!;
    expect(slotLine(ff.slots[1])).toBe("Slot 2. One card from Fright Fest 2026: 60% common, 25% uncommon, 10% rare, 5% epic.");
  });
  it("groups every pack once: events by name, the rest as everyday", () => {
    const groups = packGroups();
    expect(groups.flatMap((g) => g.packs.map((v) => v.pack.id)).sort()).toEqual(packViews().map((v) => v.pack.id).sort());
    expect(groups[0].title).toBe("Fright Fest 2026 packs");
    expect(groups[groups.length - 1].title).toBe("Everyday packs");
    expect(groups[0].packs.every((v) => v.pack.collection === "ff26")).toBe(true);
  });
});
