import { describe, expect, it } from "vitest";
import { injectShim, RECORD_SHIM_SOURCE } from "./record-shim";

type Listener = () => void;

/** A fake window with just enough Web Audio to exercise the shim. */
function makeWindow() {
  const connections: Array<[unknown, unknown]> = [];
  class AudioDestinationNode {
    constructor(public context: FakeContext) {}
  }
  class AudioNode {
    connect(target: unknown) {
      connections.push([this, target]);
      return target;
    }
  }
  class TapNode extends AudioNode {
    stream = { id: "tap" };
  }
  class FakeContext {
    destination = new AudioDestinationNode(this);
    createMediaStreamDestination() {
      return new TapNode();
    }
  }
  const listeners: Record<string, Listener[]> = {};
  const win: Record<string, unknown> = {
    AudioNode,
    AudioDestinationNode,
    performance: { timeOrigin: 1_000_000, now: () => 500 },
    setTimeout: (fn: () => void) => {
      queued.push(fn);
      return 0;
    },
    document: {
      visibilityState: "hidden",
      addEventListener: (name: string, fn: Listener) => {
        (listeners[name] ??= []).push(fn);
      },
    },
  };
  const queued: Array<() => void> = [];
  return { win, connections, AudioNode, FakeContext, listeners, queued };
}

function run(win: Record<string, unknown>) {
  new Function("window", RECORD_SHIM_SOURCE)(win);
}

describe("injectShim", () => {
  it("goes straight after <head>, before any game script", () => {
    const out = injectShim('<!doctype html><html><head><meta charset="utf-8"><script>game()</script>');
    expect(out.indexOf("data-hp-rec")).toBeLessThan(out.indexOf("game()"));
    expect(out.startsWith("<!doctype html><html><head><script data-hp-rec>")).toBe(true);
  });

  it("matches <head> with attributes, case-insensitively", () => {
    expect(injectShim('<HEAD lang="en"><title>x</title>')).toContain('<HEAD lang="en"><script data-hp-rec>');
  });

  it("falls back to after the doctype, never before it", () => {
    const out = injectShim("<!DOCTYPE html><body>hi</body>");
    expect(out.startsWith("<!DOCTYPE html><script data-hp-rec>")).toBe(true);
  });

  it("falls back to the very start for a fragment", () => {
    expect(injectShim("<canvas></canvas>").startsWith("<script data-hp-rec>")).toBe(true);
  });

  it("embeds safely: no closing script tag inside the source", () => {
    expect(RECORD_SHIM_SOURCE.toLowerCase()).not.toContain("</script");
    expect(RECORD_SHIM_SOURCE).not.toContain("`");
    expect(RECORD_SHIM_SOURCE).not.toContain("\\");
  });
});

describe("shim audio tap", () => {
  it("also connects a node bound for the destination to one tap per context", () => {
    const { win, connections, AudioNode, FakeContext } = makeWindow();
    run(win);
    const ctx = new FakeContext();
    const a = new AudioNode();
    const b = new AudioNode();
    a.connect(ctx.destination);
    b.connect(ctx.destination);
    const hp = win.__hpRec as { streams: unknown[] };
    expect(hp.streams).toHaveLength(1);
    // Each source: the tap, then the original connection to the destination.
    expect(connections.map(([, t]) => (t as object).constructor.name)).toEqual([
      "TapNode",
      "AudioDestinationNode",
      "TapNode",
      "AudioDestinationNode",
    ]);
  });

  it("leaves connections to other nodes alone", () => {
    const { win, connections, AudioNode } = makeWindow();
    run(win);
    const other = new AudioNode();
    new AudioNode().connect(other);
    expect(connections).toHaveLength(1);
    expect((win.__hpRec as { streams: unknown[] }).streams).toHaveLength(0);
  });

  it("is idempotent", () => {
    const { win } = makeWindow();
    run(win);
    const first = win.__hpRec;
    run(win);
    expect(win.__hpRec).toBe(first);
  });

  it("does nothing, harmlessly, where there is no Web Audio", () => {
    const { win } = makeWindow();
    delete win.AudioNode;
    expect(() => run(win)).not.toThrow();
  });
});

describe("shim SDK events", () => {
  function setup() {
    const ctx = makeWindow();
    run(ctx.win);
    const events: Array<{ at: number; type: string; data?: Record<string, unknown> }> = [];
    (ctx.win.__hpRec as { onEvent: unknown }).onEvent = (e: never) => events.push(e);
    return { ...ctx, events };
  }

  it("logs a submitScore call with its value, then its result", async () => {
    const { win, events } = setup();
    win.HallPass = { version: "0", submitScore: async () => ({ ok: true, rank: 3 }) };
    await (win.HallPass as { submitScore(n: number): Promise<unknown> }).submitScore(42);
    expect(events.map((e) => e.type)).toEqual(["score.submit", "score.result"]);
    expect(events[0].data).toEqual({ score: 42 });
    expect(events[1].data).toMatchObject({ ok: true, rank: 3 });
    expect(events[0].at).toBe(1_000_500);
  });

  it("does not double-log a stub call replayed into the real client", async () => {
    const { win, events, queued } = setup();
    const stub = { version: "0", submitScore: async (...args: number[]) => ({ ok: false, reason: "inert", n: args.length }) };
    win.HallPass = win.HP = stub;
    (win.HallPass as typeof stub).submitScore(7);

    // The real client is assigned, then replays the queued call into itself.
    const real = {
      version: "1",
      submitScore: async () => ({ ok: true }),
      on: () => real,
    };
    win.HallPass = real;
    win.HP = real;
    real.submitScore();
    // Once the replay task is over, calls count again.
    queued.forEach((fn) => fn());
    await real.submitScore();

    expect(events.filter((e) => e.type === "score.submit")).toHaveLength(2);
  });

  it("subscribes to achievements on the real client only", () => {
    const { win, events } = setup();
    const handlers: Array<(p: unknown) => void> = [];
    win.HallPass = { version: "0", on: () => handlers.push(() => {}) };
    expect(handlers).toHaveLength(0);
    const real = { version: "1", on: (_: string, cb: (p: unknown) => void) => handlers.push(cb) };
    win.HallPass = real;
    win.HP = real;
    expect(handlers).toHaveLength(1);
    handlers[0]({ key: "first", name: "First", points: 5 });
    expect(events[0]).toMatchObject({ type: "achievement", data: { key: "first", points: 5 } });
  });

  it("never breaks a game whose listener throws", () => {
    const { win } = setup();
    (win.__hpRec as { onEvent: unknown }).onEvent = () => {
      throw new Error("boom");
    };
    win.HallPass = { version: "0", submitScore: () => 1 };
    expect(() => (win.HallPass as { submitScore(): unknown }).submitScore()).not.toThrow();
  });

  it("reports visibility changes", () => {
    const { listeners, events } = setup();
    listeners.visibilitychange[0]();
    expect(events[0]).toMatchObject({ type: "visibility", data: { state: "hidden" } });
  });
});
