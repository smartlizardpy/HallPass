import { describe, expect, it } from "vitest";
import { clampPosition, GRAB_MARGIN, nudge, startPosition } from "./drag-math";

const view = { w: 1366, h: 768 };
const win = { w: 340, h: 520 };

describe("clampPosition", () => {
  it("leaves an on-screen position alone", () => {
    expect(clampPosition({ x: 100, y: 80 }, win, view)).toEqual({ x: 100, y: 80 });
  });
  it("keeps a window fully inside when it fits", () => {
    expect(clampPosition({ x: -50, y: -20 }, win, view)).toEqual({ x: 0, y: 0 });
    expect(clampPosition({ x: 5000, y: 5000 }, win, view)).toEqual({ x: view.w - win.w, y: view.h - GRAB_MARGIN });
  });
  it("never lets the title bar leave the top", () => {
    expect(clampPosition({ x: 10, y: -999 }, win, view).y).toBe(0);
  });
  it("on a viewport narrower than the window, keeps a grabbable strip", () => {
    const narrow = { w: 300, h: 600 };
    const p = clampPosition({ x: -9999, y: 0 }, win, narrow);
    expect(p.x + win.w).toBeGreaterThanOrEqual(GRAB_MARGIN);
    const q = clampPosition({ x: 9999, y: 0 }, win, narrow);
    expect(q.x).toBeLessThanOrEqual(narrow.w - GRAB_MARGIN);
  });
  it("handles a viewport smaller than the grab margin without NaN", () => {
    const p = clampPosition({ x: 5, y: 5 }, win, { w: 10, h: 10 });
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe("startPosition", () => {
  it("cascades successive windows and stays on screen", () => {
    const a = startPosition(0, win, view);
    const b = startPosition(1, win, view);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    for (let i = 0; i < 12; i++) {
      const p = startPosition(i, win, view);
      expect(p).toEqual(clampPosition(p, win, view));
    }
  });
});

describe("nudge", () => {
  it("moves by arrow key and ignores others", () => {
    expect(nudge({ x: 10, y: 10 }, "ArrowRight")).toEqual({ x: 26, y: 10 });
    expect(nudge({ x: 10, y: 10 }, "ArrowUp", 4)).toEqual({ x: 10, y: 6 });
    expect(nudge({ x: 10, y: 10 }, "a")).toBeNull();
  });
});
