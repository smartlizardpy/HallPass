import { describe, expect, it } from "vitest";
import { GAME_EVENT_THEME, parseGameEventMode, resolveGameEvent } from "./game-event";
import type { ThemeWindow } from "./types";

const THEME: ThemeWindow = {
  ...GAME_EVENT_THEME,
  enabled: true,
  startAt: "2026-10-25T00:00:00Z",
  opensAt: "2026-10-28T00:00:00Z",
  endAt: "2026-11-03T00:00:00Z",
};
const at = (iso: string) => Date.parse(iso);

describe("parseGameEventMode", () => {
  it("is auto unless exactly off", () => {
    expect(parseGameEventMode("off")).toBe("off");
    expect(parseGameEventMode("auto")).toBe("auto");
    expect(parseGameEventMode(null)).toBe("auto");
    expect(parseGameEventMode(undefined)).toBe("auto");
    expect(parseGameEventMode("on")).toBe("auto");
    expect(parseGameEventMode("OFF")).toBe("auto");
  });
});

describe("resolveGameEvent", () => {
  it("is active inside the window and carries the dates", () => {
    const s = resolveGameEvent(THEME, "auto", at("2026-10-29T12:00:00Z"));
    expect(s).toMatchObject({
      active: true,
      event: "fright-fest",
      phase: "live",
      startAt: "2026-10-25T00:00:00Z",
      opensAt: "2026-10-28T00:00:00Z",
      endAt: "2026-11-03T00:00:00Z",
      serverTime: "2026-10-29T12:00:00.000Z",
    });
  });

  it("opensAt falls back to startAt", () => {
    const s = resolveGameEvent({ ...THEME, opensAt: undefined }, "auto", at("2026-10-26T00:00:00Z"));
    expect(s.opensAt).toBe("2026-10-25T00:00:00Z");
  });

  it("starts at startAt (inclusive) and ends at endAt (exclusive)", () => {
    expect(resolveGameEvent(THEME, "auto", at("2026-10-24T23:59:59Z")).active).toBe(false);
    expect(resolveGameEvent(THEME, "auto", at("2026-10-25T00:00:00Z")).active).toBe(true);
    expect(resolveGameEvent(THEME, "auto", at("2026-11-02T23:59:59Z")).active).toBe(true);
    expect(resolveGameEvent(THEME, "auto", at("2026-11-03T00:00:00Z")).active).toBe(false);
  });

  it("when inactive the event does not exist: no name, no dates", () => {
    for (const iso of ["2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z"]) {
      const s = resolveGameEvent(THEME, "auto", at(iso));
      expect(s).toMatchObject({ active: false, event: null, startAt: null, opensAt: null, endAt: null });
    }
    expect(resolveGameEvent(THEME, "auto", at("2026-10-01T00:00:00Z")).phase).toBe("off");
    expect(resolveGameEvent(THEME, "auto", at("2026-12-01T00:00:00Z")).phase).toBe("ended");
  });

  it("the dashboard off switch beats the clock", () => {
    const s = resolveGameEvent(THEME, "off", at("2026-10-29T12:00:00Z"));
    expect(s).toMatchObject({ active: false, event: null, phase: "off", startAt: null });
  });

  it("enabled:false in the config beats the clock too", () => {
    const s = resolveGameEvent({ ...THEME, enabled: false }, "auto", at("2026-10-29T12:00:00Z"));
    expect(s.active).toBe(false);
  });

  it("an unparseable window is off, never live", () => {
    const s = resolveGameEvent({ ...THEME, endAt: "nonsense" }, "auto", at("2026-10-29T12:00:00Z"));
    expect(s).toMatchObject({ active: false, event: null });
  });
});
