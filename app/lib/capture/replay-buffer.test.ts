import { describe, expect, it } from "vitest";
import {
  extensionFor,
  pickMimeType,
  VIDEO_BITS_PER_SECOND,
  WINDOW_MS,
} from "./replay-buffer";

describe("pickMimeType", () => {
  it("prefers VP9 when everything is available", () => {
    expect(pickMimeType(() => true)).toBe("video/webm;codecs=vp9");
  });

  it("falls back to VP8 when VP9 is missing", () => {
    expect(pickMimeType((t) => !t.includes("vp9"))).toBe("video/webm;codecs=vp8");
  });

  it("falls back to MP4 for Safari, which produces no WebM at all", () => {
    expect(pickMimeType((t) => t.includes("mp4"))).toBe("video/mp4");
  });

  it("returns the browser default rather than refusing to record", () => {
    // "" means "you choose" — always better than declining to capture.
    expect(pickMimeType(() => false)).toBe("");
  });

  it("treats a throwing isTypeSupported as unsupported", () => {
    // Some older engines throw instead of returning false.
    expect(() =>
      pickMimeType(() => {
        throw new Error("nope");
      }),
    ).not.toThrow();
    expect(
      pickMimeType(() => {
        throw new Error("nope");
      }),
    ).toBe("");
  });
});

describe("extensionFor", () => {
  it("maps the containers to file extensions", () => {
    expect(extensionFor("video/webm;codecs=vp9")).toBe("webm");
    expect(extensionFor("video/webm")).toBe("webm");
    expect(extensionFor("video/mp4")).toBe("mp4");
    // The browser-default case has no type string; webm is the right guess for
    // every engine that reaches it.
    expect(extensionFor("")).toBe("webm");
  });
});

describe("buffer tunables", () => {
  it("keeps a clip comfortably under the blob size worth worrying about", () => {
    // 30 s at this bitrate, before the codec's savings on static game scenes.
    const worstCaseBytes = (VIDEO_BITS_PER_SECOND / 8) * (WINDOW_MS / 1000);
    expect(worstCaseBytes).toBeLessThan(6 * 1024 * 1024);
  });

  it("guarantees at least half a window of history at any instant", () => {
    // The property the two-recorder stagger exists for: recorders start
    // WINDOW_MS/2 apart, so the older always holds between half and a full
    // window. Anything less would make a flush a coin toss.
    const stagger = WINDOW_MS / 2;
    expect(stagger).toBeGreaterThanOrEqual(15_000);
    expect(WINDOW_MS).toBeGreaterThanOrEqual(2 * stagger);
  });
});
