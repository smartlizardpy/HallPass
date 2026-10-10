import { describe, expect, it } from "vitest";
import { injectShim, RECORD_SHIM_SOURCE } from "./record-shim";

type Listener = () => void;

/** A fake window with just enough Web Audio to exercise the shim. */
function makeWindow() {
  const connections: Array<[unknown, unknown]> = [];
  const connectArgs: unknown[][] = [];
  class AudioDestinationNode {
    constructor(public context: FakeContext) {}
  }
  class AudioNode {
    connect(target: unknown, ...rest: unknown[]) {
      connectArgs.push([target, ...rest]);
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
  const getContextCalls: unknown[][] = [];
  class HTMLCanvasElement {
    getContext(...args: unknown[]) {
      getContextCalls.push(args);
      return args[0] === "nope" ? null : { type: args[0] };
    }
  }
  const listeners: Record<string, Listener[]> = {};
  const win: Record<string, unknown> = {
    AudioNode,
    AudioDestinationNode,
    HTMLCanvasElement,
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
  return { win, connections, AudioNode, FakeContext, listeners, queued, HTMLCanvasElement, getContextCalls, connectArgs };
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

  it("skips a <head> that appears inside a comment, a script or a title", () => {
    const html =
      '<!doctype html><!-- <head> --><html><title>a <head> b</title><script>var s = "<head>";</script><head><meta></head>';
    const out = injectShim(html);
    expect(out.indexOf("<script data-hp-rec>")).toBe(html.lastIndexOf("<head><meta>") + "<head>".length);
  });

  it("does not mistake <header> for <head>", () => {
    const out = injectShim("<!doctype html><header>x</header><head></head>");
    expect(out).toContain("<head><script data-hp-rec>");
  });

  it("never inserts before the doctype, even when a comment precedes it", () => {
    const out = injectShim("<!-- hi --><!DOCTYPE html><body></body>");
    expect(out.indexOf("data-hp-rec")).toBeGreaterThan(out.indexOf("<!DOCTYPE html>"));
  });

  it("adds a <base> ahead of the shim when asked", () => {
    const out = injectShim("<!doctype html><head><title>x</title>", { baseHref: "/games/snag/" });
    expect(out).toContain('<head><base href="/games/snag/"><script data-hp-rec>');
  });

  it("leaves a game's own <base> alone", () => {
    const out = injectShim('<head><base href="/mine/">', { baseHref: "/games/snag/" });
    expect(out).not.toContain("/games/snag/");
  });

  it("adds no <base> unless asked", () => {
    expect(injectShim("<head></head>")).not.toContain("<base");
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

  it("taps the same output index the game connected, and not its input index", () => {
    const { win, connectArgs, AudioNode, FakeContext } = makeWindow();
    run(win);
    const ctx = new FakeContext();
    new AudioNode().connect(ctx.destination, 1, 0);
    // [tap, output] first, then the game's own untouched call.
    expect(connectArgs).toHaveLength(2);
    expect(connectArgs[0].slice(1)).toEqual([1]);
    expect(connectArgs[1].slice(1)).toEqual([1, 0]);
  });

  it("taps output 0 by default when the game gave no index", () => {
    const { win, connectArgs, AudioNode, FakeContext } = makeWindow();
    run(win);
    new AudioNode().connect(new FakeContext().destination);
    expect(connectArgs[0].slice(1)).toEqual([]);
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
    win.HallPass = { version: "0", submitScore: () => 0, on: () => handlers.push(() => {}) };
    expect(handlers).toHaveLength(0);
    const real = { version: "1", submitScore: () => 0, on: (_: string, cb: (p: unknown) => void) => handlers.push(cb) };
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

describe("shim canvas context types", () => {
  it("remembers the first context type a game asked for, and still returns the context", () => {
    const { win, HTMLCanvasElement } = makeWindow();
    run(win);
    const types = (win.__hpRec as { ctxTypes: WeakMap<object, string> }).ctxTypes;
    const c = new HTMLCanvasElement();
    expect(c.getContext("2d")).toEqual({ type: "2d" });
    c.getContext("webgl");
    expect(types.get(c)).toBe("2d");
    const g = new HTMLCanvasElement();
    g.getContext("webgl2", { alpha: false });
    expect(types.get(g)).toBe("webgl2");
  });

  it("records nothing when the game's request failed", () => {
    const { win, HTMLCanvasElement } = makeWindow();
    run(win);
    const types = (win.__hpRec as { ctxTypes: WeakMap<object, string> }).ctxTypes;
    const c = new HTMLCanvasElement();
    expect(c.getContext("nope")).toBeNull();
    expect(types.has(c)).toBe(false);
  });

  it("never asks for a context on a canvas by itself", () => {
    const { win, getContextCalls, HTMLCanvasElement } = makeWindow();
    run(win);
    new HTMLCanvasElement();
    expect(getContextCalls).toHaveLength(0);
  });
});

describe("shim leaves non-SDK objects alone", () => {
  it("does not wrap or subscribe on a game's own window.HP", () => {
    const { win } = makeWindow();
    run(win);
    const events: unknown[] = [];
    (win.__hpRec as { onEvent: unknown }).onEvent = (e: unknown) => events.push(e);
    const on = () => {
      throw new Error("must not be called");
    };
    const submitScore = () => "mine";
    const hp = { hp: 100, version: "9", submitScore: undefined as unknown, on };
    win.HP = hp;
    expect(Object.getOwnPropertyDescriptor(hp, "__hpWrapped")).toBeUndefined();
    win.HP = { hp: 3, on, progress: submitScore };
    expect(events).toEqual([]);
  });

  it("ignores an object with submitScore but no version", () => {
    const { win } = makeWindow();
    run(win);
    const foreign = { submitScore: () => 1 };
    const original = foreign.submitScore;
    win.HallPass = foreign;
    expect(foreign.submitScore).toBe(original);
  });

  it("still wraps the real SDK and its stub", () => {
    const { win } = makeWindow();
    run(win);
    const stub = { version: "0", submitScore: () => Promise.resolve({ ok: true }) };
    const original = stub.submitScore;
    win.HallPass = stub;
    expect(stub.submitScore).not.toBe(original);
  });
});

describe("shim moments", () => {
  function setup() {
    const ctx = makeWindow();
    const frames: Array<(t: number) => unknown> = [];
    ctx.win.requestAnimationFrame = (cb: (t: number) => unknown) => frames.push(cb);
    run(ctx.win);
    const moments: Array<{ name: unknown; data: unknown; opts: unknown; at: number }> = [];
    (ctx.win.__hpRec as { onMoment: unknown }).onMoment = (m: never) => moments.push(m);
    const stepFrame = () => frames.splice(0).forEach((cb) => cb(0));
    return { ...ctx, moments, stepFrame, frames };
  }
  // Assigning a real client starts the shim's replay window (calls are skipped
  // until a task later), so let that task pass, as it would before a game plays.
  const sdk = (win: Record<string, unknown>, queued: Array<() => void>) => {
    const real = { version: "1", submitScore: () => 0, moment: async () => ({ ok: true }), on: () => real };
    win.HallPass = real;
    queued.splice(0).forEach((fn) => fn());
    return real;
  };

  it("holds a moment made outside a frame until the end of the next frame", () => {
    const { win, moments, stepFrame, queued } = setup();
    const hp = sdk(win, queued);
    let drew = false;
    (win.requestAnimationFrame as (cb: () => void) => void)(() => {
      drew = true;
      expect(moments).toHaveLength(0);
    });
    hp.moment("Boss", { hp: 3 }, { shot: false });
    expect(moments).toHaveLength(0);
    stepFrame();
    expect(drew).toBe(true);
    expect(moments).toEqual([{ at: 1_000_500, name: "Boss", data: { hp: 3 }, opts: { shot: false } }]);
  });

  it("delivers a moment made inside a frame when that frame's callback returns", () => {
    const { win, moments, stepFrame, queued } = setup();
    const hp = sdk(win, queued);
    (win.requestAnimationFrame as (cb: () => void) => void)(() => {
      hp.moment("died");
      expect(moments).toHaveLength(0);
    });
    stepFrame();
    expect(moments.map((m) => m.name)).toEqual(["died"]);
  });

  it("falls back to a timer for a game with no animation loop", () => {
    const { win, moments, queued } = setup();
    sdk(win, queued).moment("still");
    expect(moments).toHaveLength(0);
    queued.forEach((fn) => fn());
    expect(moments.map((m) => m.name)).toEqual(["still"]);
  });

  it("delivers each moment once", () => {
    const { win, moments, queued, stepFrame } = setup();
    const hp = sdk(win, queued);
    (win.requestAnimationFrame as (cb: () => void) => void)(() => {});
    hp.moment("once");
    stepFrame();
    queued.forEach((fn) => fn());
    expect(moments).toHaveLength(1);
  });

  it("keeps the frame id, the callback's result and the game's errors intact", () => {
    const { win, frames } = setup();
    const id = (win.requestAnimationFrame as (cb: () => void) => number)(() => {});
    expect(id).toBe(1);
    (win.requestAnimationFrame as (cb: () => void) => number)(() => {
      throw new Error("game bug");
    });
    expect(() => frames[1](0)).toThrow("game bug");
  });

  it("passes a non-function straight through", () => {
    const { win } = setup();
    expect(() => (win.requestAnimationFrame as (cb: unknown) => unknown)("x")).not.toThrow();
  });

  it("ignores moments when no session is listening, and caps the queue", () => {
    const { win, moments, queued } = setup();
    (win.__hpRec as { onMoment: unknown }).onMoment = null;
    const hp = sdk(win, queued);
    hp.moment("lost");
    expect(queued).toHaveLength(0);
    (win.__hpRec as { onMoment: unknown }).onMoment = (m: never) => moments.push(m);
    for (let i = 0; i < 30; i += 1) hp.moment("m" + i);
    queued.forEach((fn) => fn());
    expect(moments).toHaveLength(20);
  });

  it("does not double-log a stub call replayed into the real client", () => {
    const { win, moments, queued } = setup();
    const stub = { version: "0", submitScore: () => 0, moment: () => 0 };
    win.HallPass = win.HP = stub;
    stub.moment();
    const real = { version: "1", submitScore: () => 0, moment: () => 0, on: () => real };
    win.HallPass = real;
    win.HP = real;
    real.moment();
    queued.forEach((fn) => fn());
    expect(moments).toHaveLength(1);
  });

  it("is harmless on an older SDK that has no moment method", () => {
    const { win } = setup();
    expect(() => {
      win.HallPass = { version: "0", submitScore: () => 0 };
    }).not.toThrow();
  });

  it("never lets a throwing listener reach the game", () => {
    const { win, queued } = setup();
    (win.__hpRec as { onMoment: unknown }).onMoment = () => {
      throw new Error("boom");
    };
    sdk(win, queued).moment("x");
    expect(() => queued.forEach((fn) => fn())).not.toThrow();
  });
});
