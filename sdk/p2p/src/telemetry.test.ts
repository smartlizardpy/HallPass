import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseTelemetry, noTelemetry, parentTelemetry, TELEMETRY_SOURCE } from "./telemetry";

afterEach(() => vi.unstubAllGlobals());

describe("chooseTelemetry", () => {
  it("is off for the local transport and when the game opts out", () => {
    expect(chooseTelemetry(undefined, "local", "g")).toBe(noTelemetry);
    expect(chooseTelemetry(true, "local", "g")).toBe(noTelemetry);
    expect(chooseTelemetry(false, "hallpass", "g")).toBe(noTelemetry);
  });
  it("uses an injected sink as is", () => {
    const sink = vi.fn();
    expect(chooseTelemetry(sink, "local", "g")).toBe(sink);
  });
  it("posts to the parent page on the hallpass transport", () => {
    expect(chooseTelemetry(undefined, "hallpass", "g")).not.toBe(noTelemetry);
  });
});

describe("parentTelemetry", () => {
  it("posts the report with the source and game id to the page's own origin", () => {
    const post = vi.fn();
    vi.stubGlobal("window", { parent: { postMessage: post } });
    vi.stubGlobal("location", { origin: "https://hallpass.test" });
    parentTelemetry("last-bell")({ event: "session_started", props: { players: 2 } });
    expect(post).toHaveBeenCalledWith(
      { source: TELEMETRY_SOURCE, gameId: "last-bell", event: "session_started", props: { players: 2 } },
      "https://hallpass.test",
    );
  });
  it("does nothing when the game is not framed, and never throws", () => {
    const self: { parent?: unknown } = {};
    self.parent = self;
    vi.stubGlobal("window", self);
    expect(() => parentTelemetry("g")({ event: "room_created", props: { max_players: 4 } })).not.toThrow();
    vi.stubGlobal("window", { parent: { postMessage: () => { throw new Error("blocked"); } } });
    vi.stubGlobal("location", { origin: "x" });
    expect(() => parentTelemetry("g")({ event: "room_created", props: { max_players: 4 } })).not.toThrow();
  });
});
