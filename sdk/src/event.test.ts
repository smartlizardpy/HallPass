// @vitest-environment jsdom
/**
 * `getEvent()` / `"event"`. What matters, in order:
 *   1. FAIL TOWARDS "NO EVENT": nothing reachable or well-formed resolves `null`,
 *      and an inactive answer never carries a name or a date.
 *   2. A failed REFRESH keeps the last good state (a blip must not strip the
 *      event off a player mid-run).
 *   3. `"event"` fires on a real change only, is sticky, and a listener starts
 *      the watch that lets an open game follow the dashboard switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, emit } from "./client";
import { createEvent, parseEventState } from "./event";
import type { EventState } from "./contract";

const LIVE: EventState = {
  active: true,
  event: "fright-fest",
  phase: "live",
  startAt: "2026-10-25T00:00:00Z",
  opensAt: "2026-10-28T00:00:00Z",
  endAt: "2026-11-03T00:00:00Z",
  serverTime: "2026-10-29T12:00:00.000Z",
};
const OFF: EventState = { active: false, event: null, phase: "off", startAt: null, opensAt: null, endAt: null, serverTime: "2026-10-29T12:00:00.000Z" };

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function make(over: { mode?: "live" | "inert" } = {}) {
  const events: Array<[string, unknown]> = [];
  const api = createEvent({
    cfg: { game: "last-bell", api: "https://hp.test" },
    mode: over.mode ?? "live",
    emit: (e, p) => events.push([e, p]),
  });
  return { api, events };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseEventState", () => {
  it("accepts an active and an inactive answer", () => {
    expect(parseEventState(LIVE)).toEqual(LIVE);
    expect(parseEventState(OFF)).toEqual(OFF);
  });
  it("forces an inactive answer to carry no name or dates", () => {
    const s = parseEventState({ ...OFF, event: "fright-fest", startAt: "x", endAt: "y", opensAt: "z" });
    expect(s).toMatchObject({ active: false, event: null, startAt: null, opensAt: null, endAt: null });
  });
  it("rejects anything it cannot trust", () => {
    for (const bad of [null, "x", 1, {}, { active: "yes" }, { active: false, phase: "weird" }, { active: true, phase: "live", event: null }]) {
      expect(parseEventState(bad)).toBeNull();
    }
  });
});

describe("getEvent", () => {
  it("asks the API and resolves the state", async () => {
    const f = vi.fn(async (_url: string) => respond(LIVE));
    vi.stubGlobal("fetch", f);
    const { api } = make();
    expect(await api.getEvent()).toEqual(LIVE);
    expect(f.mock.calls[0][0]).toBe("https://hp.test/api/v1/event");
  });

  it("resolves null (no event) when HallPass is unreachable or sends junk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await make().api.getEvent()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => respond({ nope: 1 })));
    expect(await make().api.getEvent()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => respond({}, 500)));
    expect(await make().api.getEvent()).toBeNull();
  });

  it("is null and silent in inert mode, without a request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await make({ mode: "inert" }).api.getEvent()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("reuses a fresh answer, and asks again on refresh or once stale", async () => {
    const f = vi.fn(async () => respond(LIVE));
    vi.stubGlobal("fetch", f);
    const { api } = make();
    await api.getEvent();
    await api.getEvent();
    expect(f).toHaveBeenCalledTimes(1);
    await api.getEvent({ refresh: true });
    expect(f).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(31_000);
    await api.getEvent();
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("shares one request between concurrent callers", async () => {
    const f = vi.fn(async () => respond(LIVE));
    vi.stubGlobal("fetch", f);
    const { api } = make();
    await Promise.all([api.getEvent(), api.getEvent(), api.getEvent()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good state when a refresh fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(respond(LIVE)).mockRejectedValueOnce(new Error("blip"));
    vi.stubGlobal("fetch", f);
    const { api } = make();
    await api.getEvent();
    expect(await api.getEvent({ refresh: true })).toEqual(LIVE);
  });

  it("emits \"event\" on the first answer and on a real change only", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(respond(LIVE))
      .mockResolvedValueOnce(respond({ ...LIVE, serverTime: "2026-10-29T12:01:00.000Z" }))
      .mockResolvedValueOnce(respond(OFF));
    vi.stubGlobal("fetch", f);
    const { api, events } = make();
    await api.getEvent({ refresh: true });
    await api.getEvent({ refresh: true }); // only the server clock moved
    await api.getEvent({ refresh: true }); // switched off
    expect(events.map(([, p]) => (p as EventState).active)).toEqual([true, false]);
  });
});

describe("watch", () => {
  it("re-asks every minute so an open game follows the dashboard switch", async () => {
    const f = vi.fn().mockResolvedValueOnce(respond(LIVE)).mockResolvedValue(respond(OFF));
    vi.stubGlobal("fetch", f);
    const { api, events } = make();
    api.watch();
    api.watch(); // idempotent
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f).toHaveBeenCalledTimes(2);
    expect(events.map(([, p]) => (p as EventState).active)).toEqual([true, false]);
  });
});

describe("through the client", () => {
  it("advertises the feature and exposes getEvent", () => {
    const hp = createClient({ game: "last-bell", api: "https://hp.test" });
    expect(hp.supports?.("event")).toBe(true);
    expect(hp.capabilities?.event).toBe(true);
    expect(typeof hp.getEvent).toBe("function");
  });

  it("on(\"event\") is sticky: a late listener gets the last state at once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(LIVE)));
    const hp = createClient({ game: "last-bell", api: "https://hp.test" });
    emit("event", LIVE);
    const cb = vi.fn();
    hp.on("event", cb);
    expect(cb).toHaveBeenCalledWith(LIVE);
  });
});
