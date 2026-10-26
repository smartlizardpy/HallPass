// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  packSounds,
  readSoundPref,
  setSoundEnabled,
  unlockSound,
  writeSoundPref,
} from "./sound";
import { haptics, setHapticsEnabled } from "./haptics";

describe("sound preference", () => {
  // Some Node/jsdom combinations expose no localStorage; use a tiny in-memory one.
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
  });

  it("is off by default and round-trips", () => {
    expect(readSoundPref()).toBe(false);
    writeSoundPref(true);
    expect(readSoundPref()).toBe(true);
    expect(window.localStorage.getItem("hp:collectibles:sound")).toBe("on");
    writeSoundPref(false);
    expect(readSoundPref()).toBe(false);
  });
});

describe("cues without WebAudio", () => {
  it("are safe no-ops, enabled or not", () => {
    for (const on of [false, true]) {
      setSoundEnabled(on);
      unlockSound();
      const s = packSounds();
      expect(() => {
        s.crinkle(0.5);
        s.tearStart();
        s.tear(0, 0);
        s.tear(0.02, 4);
        s.tearEnd(false);
        s.tearEnd(true);
        s.loosen();
        s.extract();
        [0, 1, 2].forEach((i) => s.deal(i));
        s.flip();
        (["common", "uncommon", "rare", "epic", "legendary"] as const).forEach((r) => s.reveal(r));
        s.complete();
        s.stopAll();
      }).not.toThrow();
    }
    setSoundEnabled(false);
  });
});

describe("haptics", () => {
  it("no-ops without navigator.vibrate and clamps patterns with it", () => {
    expect(() => haptics.grab()).not.toThrow();
    const calls: unknown[] = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (p: unknown) => (calls.push(p), true) });
    haptics.snap();
    haptics.reveal("common");
    haptics.reveal("legendary");
    expect(calls).toHaveLength(2);
    for (const p of calls as number[][]) {
      expect(p.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60);
      p.filter((_, i) => i % 2 === 0).forEach((ms) => expect(ms).toBeGreaterThanOrEqual(3));
    }
    setHapticsEnabled(false);
    haptics.deal();
    expect(calls).toHaveLength(2);
    setHapticsEnabled(true);
  });
});
