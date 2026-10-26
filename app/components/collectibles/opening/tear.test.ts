import { describe, expect, it } from "vitest";
import { SEAM_COLS, TEAR, dragTear, emptyTear, inTearZone, pressTear, reachedEdge, releaseTear, seamLine, type Tear } from "./tear";

const W = 280; // pack width in px
const at = (u: number, v: number, t: number) => ({ u, v, t });

function drag(points: [number, number, number][], from: Tear = emptyTear()) {
  let t = pressTear(from, at(...points[0]));
  let advanced = 0;
  for (const p of points.slice(1)) {
    const r = dragTear(t, at(...p), W);
    t = r.tear;
    advanced += r.advance;
  }
  return { t, advanced };
}

describe("where a tear can start", () => {
  it("is anywhere along the top band, not the face of the pack", () => {
    expect(inTearZone({ u: 0.5, v: 0.05 })).toBe(true);
    expect(inTearZone({ u: 0.02, v: 0.25 })).toBe(true);
    expect(inTearZone({ u: 0.5, v: 0.5 })).toBe(false);
    expect(inTearZone({ u: 1.3, v: 0.1 })).toBe(false);
  });
});

describe("dragging along the seal", () => {
  it("waits a few pixels, then runs from the side the drag came from", () => {
    const tiny = drag([[0.5, 0.1, 0], [0.51, 0.1, 16]]);
    expect(tiny.t.side).toBeNull();
    expect(drag([[0.1, 0.1, 0], [0.2, 0.1, 16]]).t.side).toBe("left");
    expect(drag([[0.9, 0.1, 0], [0.8, 0.1, 16]]).t.side).toBe("right");
  });

  it("follows the finger along the seal and never goes backwards", () => {
    const { t, advanced } = drag([[0.02, 0.1, 0], [0.3, 0.1, 50], [0.45, 0.2, 100], [0.2, 0.1, 150]]);
    expect(t.progress).toBeCloseTo(0.45, 5);
    expect(advanced).toBeCloseTo(0.45, 5);
  });

  it("ignores how far the finger wanders up or down", () => {
    const steady = drag([[0, 0.1, 0], [0.5, 0.1, 100]]).t.progress;
    const wobbly = drag([[0, 0.1, 0], [0.25, 0.3, 50], [0.5, 0.02, 100]]).t.progress;
    expect(wobbly).toBeCloseTo(steady, 5);
  });

  it("keeps an unfinished tear: the next drag carries on from where it stopped", () => {
    const first = releaseTear(drag([[0, 0.1, 0], [0.3, 0.1, 400]]).t);
    expect(first.outcome).toBe("settle");
    expect(first.tear.progress).toBeCloseTo(0.3, 5);
    const again = drag([[0.1, 0.1, 1000], [0.2, 0.1, 1100], [0.4, 0.1, 1300]], first.tear);
    expect(again.t.side).toBe("left");
    expect(again.t.progress).toBeCloseTo(0.4, 5);
    expect(again.advanced).toBeCloseTo(0.1, 5);
  });
});

describe("completing it", () => {
  it("commits on release past the threshold, settles before it", () => {
    expect(releaseTear(drag([[0, 0.1, 0], [TEAR.commitAt + 0.01, 0.1, 900]]).t).outcome).toBe("commit");
    expect(releaseTear(drag([[0, 0.1, 0], [TEAR.commitAt - 0.05, 0.1, 900]]).t).outcome).toBe("settle");
  });
  it("commits on a quick flick, but not on a slow short drag", () => {
    expect(releaseTear(drag([[0, 0.1, 0], [0.1, 0.1, 16], [0.2, 0.1, 32], [0.3, 0.1, 48]]).t).outcome).toBe("commit");
    expect(releaseTear(drag([[0, 0.1, 0], [0.1, 0.1, 300], [0.2, 0.1, 600], [0.3, 0.1, 900]]).t).outcome).toBe("settle");
  });
  it("completes at the far edge with the finger still down", () => {
    expect(reachedEdge(drag([[0, 0.1, 0], [0.97, 0.1, 500]]).t)).toBe(true);
    expect(reachedEdge(drag([[0, 0.1, 0], [0.9, 0.1, 500]]).t)).toBe(false);
  });
});

describe("the torn edge", () => {
  it("stays inside the band under the crimp, follows the finger, and is the same every time", () => {
    const high = drag([[0, 0.0, 0], [1, 0.0, 500]]).t;
    const low = drag([[0, 0.4, 0], [1, 0.4, 500]]).t;
    const a = seamLine(high, 42);
    const b = seamLine(low, 42);
    expect(a.length).toBe(SEAM_COLS);
    for (const v of a) expect(v).toBeGreaterThan(TEAR.seamMinV - 0.02);
    for (const v of b) expect(v).toBeLessThan(TEAR.seamMaxV + 0.02);
    const mean = (x: Float32Array) => x.reduce((s, v) => s + v, 0) / x.length;
    expect(mean(b)).toBeGreaterThan(mean(a));
    expect(Array.from(seamLine(high, 42))).toEqual(Array.from(a));
    expect(Array.from(seamLine(high, 43))).not.toEqual(Array.from(a));
  });
  it("is drawn left to right whichever side the tear ran from", () => {
    const fromRight = drag([[1, 0.15, 0], [0.5, 0.15, 200]]).t;
    const line = seamLine(fromRight, 1);
    // torn (right) half follows the finger's 0.15; the untorn left half eases back toward the rest line
    expect(line[SEAM_COLS - 2]).toBeGreaterThan(0.135);
    expect(line[1]).toBeLessThan(line[SEAM_COLS - 2]);
  });
});
