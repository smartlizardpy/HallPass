import { describe, expect, it } from "vitest";
import { packVersion } from "./catalogue";
import { revealLine, slotLines } from "./opening";

describe("the words", () => {
  it("say what each card is, and whether it is new", () => {
    expect(revealLine(2, 3, "ff26-the-last-bell", true)).toBe("Card 2 of 3: Legendary, The Last Bell, new for your binder.");
    expect(revealLine(1, 3, "ff26-cobweb-bell", false)).toBe("Card 1 of 3: Common, Cobweb Bell, already in your binder.");
  });
  it("print a pack's contents with the published odds", () => {
    expect(slotLines(packVersion("ff26-participation", 1)!.version)).toEqual([
      "Card 1: Survivor 2026, always",
      "Cards 2–3: Common 60%, Uncommon 25%, Rare 10%, Epic 4%, Legendary 1%",
    ]);
    expect(slotLines(packVersion("ff26-overall-winner", 1)!.version)).toEqual([
      "Card 1: Overall Champion 2026, always",
      "Card 2: The Last Bell, always",
      "Card 3: Epic 80%, Legendary 20%",
    ]);
  });
});
