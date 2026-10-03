import { describe, expect, it } from "vitest";
import {
  capReached,
  chooseCanvas,
  DESKTOP_LIMITS,
  formatClock,
  isLayered,
  limitsFor,
  supportFailure,
  takeFileNames,
  TOUCH_LIMITS,
  visibleCanvasCount,
} from "./record-policy";

const canvas = (w: number, h: number, rw = w, rh = h) => ({
  width: w,
  height: h,
  renderedWidth: rw,
  renderedHeight: rh,
});

describe("limits", () => {
  it("is stricter on touch devices", () => {
    expect(limitsFor(true)).toBe(TOUCH_LIMITS);
    expect(limitsFor(false)).toBe(DESKTOP_LIMITS);
    expect(TOUCH_LIMITS.maxMs).toBeLessThan(DESKTOP_LIMITS.maxMs);
    expect(TOUCH_LIMITS.videoBitsPerSecond).toBeLessThan(DESKTOP_LIMITS.videoBitsPerSecond);
  });

  it("reports whichever cap is hit, time first", () => {
    expect(capReached(DESKTOP_LIMITS, 1000, 1000)).toBeNull();
    expect(capReached(DESKTOP_LIMITS, DESKTOP_LIMITS.maxMs, 0)).toBe("time");
    expect(capReached(DESKTOP_LIMITS, 0, DESKTOP_LIMITS.maxBytes)).toBe("size");
    expect(capReached(DESKTOP_LIMITS, DESKTOP_LIMITS.maxMs, DESKTOP_LIMITS.maxBytes)).toBe("time");
  });
});

describe("isLayered", () => {
  it("is true for two stacked full-size canvases", () => {
    expect(isLayered([canvas(960, 600), canvas(960, 600)])).toBe(true);
  });
  it("is false for a minimap or HUD strip beside the picture", () => {
    expect(isLayered([canvas(960, 600), canvas(180, 180)])).toBe(false);
    expect(isLayered([canvas(270, 540), canvas(69, 225)])).toBe(false);
  });
  it("ignores canvases nobody can see", () => {
    expect(isLayered([canvas(960, 600), canvas(960, 600, 0, 0)])).toBe(false);
  });
  it("is false for one canvas or none", () => {
    expect(isLayered([canvas(960, 600)])).toBe(false);
    expect(isLayered([])).toBe(false);
  });
});

describe("visibleCanvasCount", () => {
  it("counts only laid-out canvases", () => {
    expect(visibleCanvasCount([canvas(10, 10), canvas(10, 10, 0, 0)])).toBe(1);
  });
});

describe("supportFailure", () => {
  const ok = { hasMediaRecorder: true, hasCaptureStream: true, mimeType: "video/webm" };
  it("passes a capable browser", () => expect(supportFailure(ok)).toBeNull());
  it("flags missing APIs", () => {
    expect(supportFailure({ ...ok, hasMediaRecorder: false })).toBe("unsupported");
    expect(supportFailure({ ...ok, hasCaptureStream: false })).toBe("unsupported");
  });
  it("flags no usable container", () => {
    expect(supportFailure({ ...ok, mimeType: null })).toBe("no-container");
  });
  it("accepts the browser-default container (empty string)", () => {
    expect(supportFailure({ ...ok, mimeType: "" })).toBeNull();
  });
});

describe("chooseCanvas", () => {
  it("picks the largest visible, ignoring scratch buffers", () => {
    const big = canvas(960, 600);
    const r = chooseCanvas([canvas(32, 32), big, canvas(200, 200)]);
    expect(r.ok && r.canvas).toBe(big);
  });
  it("refuses when there is nothing to record", () => {
    expect(chooseCanvas([canvas(32, 32)])).toEqual({ ok: false, reason: "no-canvas" });
  });
});

describe("take file names", () => {
  const at = new Date(2026, 9, 2, 9, 5, 7);
  it("names video and events from one stamp", () => {
    expect(takeFileNames("snag", at, "video/webm;codecs=vp9")).toEqual({
      video: "snag-20261002-090507.webm",
      events: "snag-20261002-090507.events.json",
    });
  });
  it("uses mp4 for Safari's container", () => {
    expect(takeFileNames("snag", at, "video/mp4").video).toMatch(/\.mp4$/);
  });
});

describe("formatClock", () => {
  it("formats m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(83_400)).toBe("1:23");
    expect(formatClock(-5)).toBe("0:00");
  });
});
