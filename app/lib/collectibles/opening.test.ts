import { describe, expect, it } from "vitest";
import { packVersion } from "./catalogue";
import { FLIP_MS, HOLD_MS, revealLine, slotLines, tearCommits, tearProgress } from "./opening";

const at = (x: number, y: number, t = 0) => ({ x, y, t });

describe("timings", () => {
  it("never take longer for a common card, and stay inside the published ranges", () => {
    expect(Object.values(FLIP_MS)).toEqual([...Object.values(FLIP_MS)].sort((a, b) => a - b));
    for (const ms of Object.values(FLIP_MS)) {
      expect(ms).toBeGreaterThanOrEqual(450);
      expect(ms).toBeLessThanOrEqual(800);
    }
    expect(HOLD_MS).toEqual({ common: 0, uncommon: 0, rare: 150, epic: 300, legendary: 600 });
  });
});

describe("the tear gesture", () => {
  it("counts movement along the seal, in either direction", () => {
    expect(tearProgress(at(0, 0), at(100, 10), 200).progress).toBeCloseTo(0.5);
    expect(tearProgress(at(200, 0), at(60, -20), 200).progress).toBeCloseTo(0.7);
  });
  it("ignores a drag outside the 35° cone, and a twitch", () => {
    expect(tearProgress(at(0, 0), at(50, 60), 200)).toEqual({ progress: 0, inCone: false });
    expect(tearProgress(at(0, 0), at(2, 1), 200).progress).toBe(0);
  });
  it("commits at 60 % or on a flick, and springs back otherwise", () => {
    expect(tearCommits(0.6, null, null)).toBe(true);
    expect(tearCommits(0.4, at(0, 0, 0), at(30, 0, 50))).toBe(false);
    expect(tearCommits(0.3, at(0, 0, 0), at(60, 0, 50))).toBe(true);
    expect(tearCommits(0.1, at(0, 0, 0), at(80, 0, 20))).toBe(false);
  });
});

describe("the words", () => {
  it("say what each card is, and whether it is new", () => {
    expect(revealLine(2, 3, "ff26-the-last-bell", true)).toBe("Card 2 of 3: Legendary, The Last Bell, new.");
    expect(revealLine(1, 3, "ff26-cobweb-bell", false)).toBe("Card 1 of 3: Common, Cobweb Bell, duplicate.");
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
