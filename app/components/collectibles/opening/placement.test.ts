import { describe, expect, it } from "vitest";
import { BADGE_H, BANNER_H, bestPull, CAPTION_H, CARD_PX, chooseFit, placeCards, summaryHeight, TAG_H } from "./placement";

const { lg, xl } = CARD_PX;
const box = (p: { x: number; y: number; s: number }, c: { w: number; h: number }) => ({
  l: p.x - (c.w * p.s) / 2,
  r: p.x + (c.w * p.s) / 2,
  t: p.y - (c.h * p.s) / 2,
  b: p.y + (c.h * p.s) / 2,
});

describe("chooseFit", () => {
  it("gives a laptop the extra-large card with the tray beside it", () => {
    expect(chooseFit({ w: 1180, h: 610 })).toEqual({ tray: "side", size: "xl" });
  });
  it("still fits a large card on a Chromebook with its browser bars (about 640 px tall)", () => {
    expect(chooseFit({ w: 1180, h: 486 })).toEqual({ tray: "side", size: "lg" });
  });
  it("gives a phone the large card and dots", () => {
    expect(chooseFit({ w: 390, h: 660 })).toEqual({ tray: "dots", size: "lg" });
    expect(chooseFit({ w: 360, h: 566 })).toEqual({ tray: "dots", size: "lg" });
  });
  it("steps down on short screens", () => {
    expect(chooseFit({ w: 366, h: 420 }).size).toBe("md");
    expect(chooseFit({ w: 296, h: 300 }).size).toBe("sm");
  });
  it("never uses the extra-large card on a narrow screen", () => {
    expect(chooseFit({ w: 420, h: 900 }).size).toBe("lg");
  });
});

describe("placeCards: one at a time", () => {
  const base = { tray: "side" as const, table: { w: 1180, h: 610 }, card: xl, count: 3, flipped: [false, false, false], current: 0, summary: false };

  it("puts the card in front between the plate and the tag, the rest stacked just behind it", () => {
    const p = placeCards(base);
    const front = box(p[0], xl);
    expect(p[0]).toMatchObject({ x: 590, s: 1, z: 30 });
    expect(front.t).toBeGreaterThanOrEqual(BANNER_H);
    expect(front.b).toBeLessThanOrEqual(610 - TAG_H);
    expect(p[1].z).toBeLessThan(p[0].z);
    expect(p[2].z).toBeLessThan(p[1].z);
    expect(p[1].s).toBeLessThan(1);
    expect(p[1].y - p[0].y).toBeLessThanOrEqual(16);
  });

  it("sends a seen card to the tray beside the card in front, small, clear of it and on the table", () => {
    const p = placeCards({ ...base, flipped: [true, true, false], current: 2 });
    const front = box(p[2], xl);
    for (const i of [0, 1]) {
      const t = box(p[i], xl);
      expect(t.l).toBeGreaterThan(front.r);
      expect(t.r).toBeLessThanOrEqual(1180);
      expect(t.t).toBeGreaterThanOrEqual(0);
      expect(p[i].s).toBeLessThan(0.25);
    }
    expect(p[1].y).toBeGreaterThan(p[0].y);
  });

  it("on a phone, fades a seen card behind the one in front", () => {
    const p = placeCards({ ...base, tray: "dots", table: { w: 390, h: 660 }, card: lg, flipped: [true, false, false], current: 1 });
    expect(p[1]).toMatchObject({ x: 195, s: 1, z: 30 });
    expect(p[0].o).toBe(0);
    expect(p[0].z).toBeLessThan(p[1].z);
  });

  it("shrinks the card in front a little rather than overlap the plate or the tag", () => {
    const p = placeCards({ ...base, table: { w: 1180, h: 486 }, card: lg });
    const front = box(p[0], lg);
    expect(p[0].s).toBeLessThan(1);
    expect(p[0].s).toBeGreaterThanOrEqual(0.9);
    expect(front.t).toBeGreaterThanOrEqual(BANNER_H - 0.5);
    expect(front.b).toBeLessThanOrEqual(486 - TAG_H + 0.5);
  });

  it("does not move the card in front when it is turned over", () => {
    expect(placeCards({ ...base, flipped: [true, false, false] })[0]).toEqual(placeCards(base)[0]);
  });
});

describe("bestPull", () => {
  it("is the rarest card, and of equals the last turned over", () => {
    expect(bestPull([1, 3, 5])).toBe(2);
    expect(bestPull([4, 4, 1])).toBe(1);
    expect(bestPull([2])).toBe(0);
  });
});

describe("placeCards: results", () => {
  const flipped = [true, true, true];

  it("on a laptop puts the best pull in the middle, larger, with the others level at the bottom either side", () => {
    const table = { w: 640, h: 520 };
    const p = placeCards({ tray: "side", table, card: xl, count: 3, flipped, current: 2, summary: true, best: 2 });
    const [a, b, best] = [box(p[0], xl), box(p[1], xl), box(p[2], xl)];
    expect(p[2].x).toBeCloseTo(320, 5);
    expect(p[2].s).toBeGreaterThan(p[0].s);
    expect(a.r).toBeLessThan(best.l);
    expect(b.l).toBeGreaterThan(best.r);
    expect(a.b).toBeCloseTo(best.b, 5);
    expect(b.b).toBeCloseTo(best.b, 5);
    for (const x of [a, b, best]) {
      expect(x.l).toBeGreaterThanOrEqual(0);
      expect(x.r).toBeLessThanOrEqual(table.w);
    }
    expect(best.t).toBeGreaterThanOrEqual(BADGE_H - 0.5);
    expect(best.b).toBeLessThanOrEqual(table.h - CAPTION_H + 0.5);
  });

  it("shrinks the three together to fit a narrow column", () => {
    const p = placeCards({ tray: "side", table: { w: 520, h: 520 }, card: xl, count: 3, flipped, current: 2, summary: true, best: 0 });
    expect(box(p[1], xl).l).toBeGreaterThanOrEqual(0);
    expect(box(p[2], xl).r).toBeLessThanOrEqual(520);
    expect(p[0].x).toBeCloseTo(260, 5);
  });

  it("on a phone shows the best pull alone, under its badge, within the summary's height", () => {
    const p = placeCards({ tray: "dots", table: { w: 358, h: 300 }, card: lg, count: 3, flipped, current: 2, summary: true, best: 1 });
    expect(p[1]).toMatchObject({ x: 179, z: 30 });
    expect(box(p[1], lg).t).toBeGreaterThanOrEqual(BADGE_H - 0.5);
    expect(box(p[1], lg).b).toBeLessThanOrEqual(summaryHeight(lg));
    expect(p[0].o).toBe(0);
    expect(p[2].o).toBe(0);
  });
});
