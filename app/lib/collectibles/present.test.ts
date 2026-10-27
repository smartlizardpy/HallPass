import { describe, expect, it } from "vitest";
import { CATALOGUE, getCollectible } from "./catalogue";
import { artPixels, cardLabel, cardNumber, packLook, RARITY_LABEL, RARITY_RANK } from "./present";

describe("presentation facts", () => {
  it("numbers a card within its collection", () => {
    // A current card counts among the cards still in its set; a retired one keeps its own number.
    expect(cardNumber(getCollectible("ff26-survivor")!)).toBe("01/20");
    expect(cardNumber(getCollectible("ff26-overall-champion")!)).toBe("05/20");
    expect(cardNumber(getCollectible("ff26-the-last-bell")!)).toBe("15/35");
    const set = CATALOGUE.collectibles.filter((c) => c.collection === "legends").sort((a, b) => a.number - b.number);
    expect(set.map(cardNumber)).toEqual(set.map((_, i) => `${String(i + 1).padStart(2, "0")}/${set.length}`));
  });
  it("draws every rarity in words and pips, in order", () => {
    expect(Object.values(RARITY_LABEL)).toEqual(["Common", "Uncommon", "Rare", "Epic", "Legendary"]);
    expect(Object.values(RARITY_RANK)).toEqual([1, 2, 3, 4, 5]);
  });
  it("knows each card's native art size, so it scales by whole numbers", () => {
    for (const c of CATALOGUE.collectibles.filter((c) => c.art.layout !== "full")) expect([32, 48]).toContain(artPixels(c));
    expect(artPixels(getCollectible("hpo-hall-pass")!)).toBe(48);
  });
  it("labels a card in plain words", () => {
    expect(cardLabel(getCollectible("ff26-the-last-bell")!)).toBe("The Last Bell. Legendary card, number 15 of 35 in Fright Fest 2026.");
    expect(cardLabel(getCollectible("ff26-overall-champion")!)).toBe("THE GOLDEN TICKET (Overall Champion). Legendary card, number 5 of 20 in Fright Fest 2026.");
  });
  it("draws every pack in its collection's wrapper", () => {
    for (const p of CATALOGUE.packs) expect(packLook(p.id)?.wrapper).toMatch(/^(prize-bag|hall-pass-tag|browser-sleeve|snack-sachet|tea-box)$/);
  });
});
