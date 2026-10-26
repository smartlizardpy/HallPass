import { describe, expect, it } from "vitest";
import { BANNER_H, CARD_PX, chooseFit, placeCards, summaryHeight, TAG_H } from "./placement";

const { md, lg, xl } = CARD_PX;
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

describe("placeCards: summary", () => {
  it("fans the hand without leaving the table's width, the middle card on top", () => {
    const p = placeCards({ tray: "dots", table: { w: 358, h: 300 }, card: md, count: 3, flipped: [true, true, true], current: 2, summary: true });
    for (const x of p) {
      const half = (md.w * x.s) / 2;
      expect(x.x - half).toBeGreaterThanOrEqual(0);
      expect(x.x + half).toBeLessThanOrEqual(358);
    }
    expect(p[1].z).toBeGreaterThan(p[0].z);
    expect(p[1].z).toBeGreaterThan(p[2].z);
    expect(p[0].y + (md.h * p[0].s) / 2).toBeLessThanOrEqual(summaryHeight(md) + 12);
  });
});
