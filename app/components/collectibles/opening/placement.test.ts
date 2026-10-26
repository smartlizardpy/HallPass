import { describe, expect, it } from "vitest";
import { chooseLayout, placeCards, summaryHeight } from "./placement";

const md = { w: 200, h: 280 };
const lg = { w: 260, h: 364 };

describe("chooseLayout", () => {
  it("deals a row when three cards fit across", () => {
    expect(chooseLayout({ w: 830, h: 600 }, md)).toBe("row");
  });
  it("goes one at a time on a phone", () => {
    expect(chooseLayout({ w: 366, h: 600 }, md)).toBe("focus");
  });
  it("goes one at a time when the table is too short for a row and its captions", () => {
    expect(chooseLayout({ w: 900, h: 340 }, md)).toBe("focus");
  });
});

describe("placeCards: row", () => {
  const base = { layout: "row" as const, table: { w: 830, h: 600 }, card: md, count: 3, flipped: [false, false, false], current: 0, summary: false };

  it("centres the row and keeps every card on the table", () => {
    const p = placeCards(base);
    expect(p.map((x) => Math.round(x.x))).toEqual([187, 415, 643]);
    for (const x of p) {
      expect(x.x - md.w / 2).toBeGreaterThanOrEqual(0);
      expect(x.x + md.w / 2).toBeLessThanOrEqual(830);
      expect(x.s).toBe(1);
    }
  });

  it("does not move a card when it is turned over", () => {
    const before = placeCards(base);
    const after = placeCards({ ...base, flipped: [true, false, false] });
    expect(after).toEqual(before);
  });
});

describe("placeCards: focus (phones)", () => {
  const base = { layout: "focus" as const, table: { w: 366, h: 600 }, card: lg, count: 3, flipped: [false, false, false], current: 0, summary: false };

  it("puts the current card in front at full size, the rest stacked behind it", () => {
    const p = placeCards(base);
    expect(p[0]).toMatchObject({ x: 183, s: 1, z: 30 });
    expect(p[1].z).toBeLessThan(p[0].z);
    expect(p[2].z).toBeLessThan(p[1].z);
    expect(p[1].y).toBeGreaterThan(p[0].y);
    expect(p[1].s).toBeLessThan(1);
  });

  it("sends a card that has been seen to the tray, small, below the card in front", () => {
    const p = placeCards({ ...base, flipped: [true, false, false], current: 1 });
    expect(p[1]).toMatchObject({ s: 1, z: 30 });
    expect(p[0].s).toBeLessThan(0.35);
    expect(p[0].y).toBeGreaterThan(p[1].y + lg.h / 2);
    expect(p[0].y).toBeLessThanOrEqual(600);
  });

  it("keeps the card in front on the table on a short phone", () => {
    const p = placeCards({ ...base, table: { w: 340, h: 470 }, card: md });
    expect(p[0].y - md.h / 2).toBeGreaterThanOrEqual(0);
  });
});

describe("placeCards: summary", () => {
  it("fans the hand on a phone without leaving the table's width", () => {
    const p = placeCards({ layout: "focus", table: { w: 358, h: 300 }, card: lg, count: 3, flipped: [true, true, true], current: 2, summary: true });
    for (const x of p) {
      const half = (lg.w * x.s) / 2;
      expect(x.x - half).toBeGreaterThanOrEqual(0);
      expect(x.x + half).toBeLessThanOrEqual(358);
    }
    expect(p[1].z).toBeGreaterThan(p[0].z);
    expect(p[1].z).toBeGreaterThan(p[2].z);
    expect(p[0].y + (lg.h * p[0].s) / 2).toBeLessThanOrEqual(summaryHeight("focus", lg) + 12);
  });

  it("keeps the row on wide screens, inside the summary's height", () => {
    const p = placeCards({ layout: "row", table: { w: 830, h: 360 }, card: md, count: 3, flipped: [true, true, true], current: 2, summary: true });
    expect(p[0].y + md.h / 2).toBeLessThanOrEqual(summaryHeight("row", md));
  });
});
