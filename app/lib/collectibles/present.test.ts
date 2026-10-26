import { describe, expect, it } from "vitest";
import { CATALOGUE, getCollectible } from "./catalogue";
import { artPixels, cardLabel, cardNumber, packLook, RARITY_LABEL, RARITY_RANK } from "./present";

describe("presentation facts", () => {
  it("numbers a card within its collection", () => {
    const c = getCollectible("ff26-the-last-bell")!;
    expect(cardNumber(c)).toMatch(/^\d{2}\/20$/);
  });
  it("draws every rarity in words and pips, in order", () => {
    expect(Object.values(RARITY_LABEL)).toEqual(["Common", "Uncommon", "Rare", "Epic", "Legendary"]);
    expect(Object.values(RARITY_RANK)).toEqual([1, 2, 3, 4, 5]);
  });
  it("knows each card's native art size, so it scales by whole numbers", () => {
    for (const c of CATALOGUE.collectibles) expect([32, 48]).toContain(artPixels(c));
    expect(artPixels(getCollectible("ff26-survivor")!)).toBe(48);
  });
  it("labels a card in plain words", () => {
    expect(cardLabel(getCollectible("ff26-the-last-bell")!)).toMatch(/^The Last Bell\. Legendary card, number \d+ of 20 in Fright Fest 2026\.$/);
  });
  it("draws every pack in its collection's wrapper", () => {
    for (const p of CATALOGUE.packs) expect(packLook(p.id)?.wrapper).toMatch(/^(prize-bag|hall-pass-tag|browser-sleeve|snack-sachet|tea-box)$/);
  });
});
