import { describe, expect, it } from "vitest";
import { CARD_PX, chooseFit, placeCards, summaryHeight } from "./placement";

const md = { w: 200, h: 280 };
const lg = { w: 260, h: 364 };

describe("chooseFit", () => {
  it("deals a row of medium cards when three fit across", () => {
    expect(chooseFit({ w: 830, h: 600 })).toEqual({ layout: "row", size: "md" });
  });
  it("uses a row of small cards on a short, wide screen (a phone on its side)", () => {
    expect(chooseFit({ w: 820, h: 290 })).toEqual({ layout: "row", size: "sm" });
  });
  it("goes one at a time on a phone, as large as the height allows", () => {
    expect(chooseFit({ w: 366, h: 575 })).toEqual({ layout: "focus", size: "lg" });
    expect(chooseFit({ w: 366, h: 420 })).toEqual({ layout: "focus", size: "md" });
    expect(chooseFit({ w: 296, h: 250 })).toEqual({ layout: "focus", size: "sm" });
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

  it("keeps the card in front, below its count, on the table on a short phone", () => {
    const p = placeCards({ ...base, table: { w: 340, h: 470 }, card: md });
    expect(p[0].y - md.h / 2).toBeGreaterThanOrEqual(28);
  });

  it("keeps every card on a small phone's table, the tray clear of the card in front", () => {
    const sm = CARD_PX.sm;
    for (const table of [{ w: 296, h: 260 }, { w: 296, h: 330 }]) {
      const p = placeCards({ ...base, table, card: sm, flipped: [true, false, false], current: 1 });
      const box = (i: number) => ({ l: p[i].x - (sm.w * p[i].s) / 2, r: p[i].x + (sm.w * p[i].s) / 2, t: p[i].y - (sm.h * p[i].s) / 2, b: p[i].y + (sm.h * p[i].s) / 2 });
      const [tray, front] = [box(0), box(1)];
      expect(front.t).toBeGreaterThanOrEqual(28);
      expect(tray.b).toBeLessThanOrEqual(table.h);
      expect(tray.r).toBeLessThanOrEqual(table.w);
      const overlap = tray.l < front.r && tray.r > front.l && tray.t < front.b && tray.b > front.t;
      expect(overlap).toBe(false);
    }
  });

  it("puts the tray beside the card when the table is short and wide", () => {
    const sm = CARD_PX.sm;
    const p = placeCards({ ...base, table: { w: 560, h: 240 }, card: sm, flipped: [true, true, false], current: 2 });
    expect(p[0].x).toBeGreaterThan(p[2].x + sm.w / 2);
    expect(p[1].y).toBeGreaterThan(p[0].y);
    for (const i of [0, 1]) expect(p[i].y + (sm.h * p[i].s) / 2).toBeLessThanOrEqual(240);
  });

  it("shrinks the card in front to fit a table shorter than the card", () => {
    const sm = CARD_PX.sm;
    const p = placeCards({ ...base, table: { w: 540, h: 200 }, card: sm });
    expect(p[0].s).toBeLessThan(1);
    expect(p[0].y - (sm.h * p[0].s) / 2).toBeGreaterThanOrEqual(28);
    for (const x of p) expect(x.y + (sm.h * x.s) / 2).toBeLessThanOrEqual(200);
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
