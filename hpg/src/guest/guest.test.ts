// @vitest-environment node
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SAVE_CHARS, parseGuestMessage, parseHostMessage, validateSaveData } from "../protocol/messages";
import { installGuest, type GuestConfig } from "./install";

const S = "sess-1";

describe("protocol validators", () => {
  it("accepts well-formed guest messages and drops everything else", () => {
    expect(parseGuestMessage({ hpg: 1, session: S, type: "GAME_READY" }, S)).toEqual({ type: "GAME_READY" });
    expect(parseGuestMessage({ hpg: 1, session: "other", type: "GAME_READY" }, S)).toBeNull();
    expect(parseGuestMessage({ hpg: 2, session: S, type: "GAME_READY" }, S)).toBeNull();
    expect(parseGuestMessage({ hpg: 1, session: S, type: "EVAL", payload: "x" }, S)).toBeNull();
    expect(parseGuestMessage("GAME_READY", S)).toBeNull();
    expect(parseGuestMessage(null, S)).toBeNull();
  });

  it("validates scores", () => {
    const m = (payload: unknown, id: unknown = 1) => parseGuestMessage({ hpg: 1, session: S, type: "SCORE_SUBMIT", id, payload }, S);
    expect(m({ score: 10, handle: "  ZK  " })).toEqual({ type: "SCORE_SUBMIT", id: 1, payload: { score: 10, handle: "ZK" } });
    expect(m({ score: Number.NaN })).toBeNull();
    expect(m({ score: Infinity })).toBeNull();
    expect(m({ score: "10" })).toBeNull();
    expect(m({ score: 1e16 })).toBeNull();
    expect(m({ score: 1 }, -1)).toBeNull();
    expect(m({ score: 1, handle: 5 })).toBeNull();
  });

  it("truncates error text and clamps score limits", () => {
    const e = parseGuestMessage({ hpg: 1, session: S, type: "GAME_ERROR", payload: { message: "x".repeat(2000) } }, S);
    expect(e && e.type === "GAME_ERROR" && e.payload.message.length).toBe(500);
    const r = parseGuestMessage({ hpg: 1, session: S, type: "SCORES_REQUEST", id: 2, payload: { limit: 9999 } }, S);
    expect(r).toEqual({ type: "SCORES_REQUEST", id: 2, payload: { limit: 100 } });
  });

  it("validates saves: string maps within limits, JSON-safe custom data", () => {
    expect(validateSaveData({ storage: { a: "1" }, custom: { lvl: 3 } })).toEqual({ storage: { a: "1" }, custom: { lvl: 3 } });
    expect(validateSaveData({ storage: { a: 1 } })).toBeNull();
    expect(validateSaveData({ storage: [] })).toBeNull();
    expect(validateSaveData({ storage: { big: "x".repeat(MAX_SAVE_CHARS) } })).toBeNull();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateSaveData({ storage: {}, custom: cyclic })).toBeNull();
  });

  it("validates host messages", () => {
    expect(parseHostMessage({ hpg: 1, session: S, type: "MUTE", payload: { muted: true } }, S)).toEqual({ type: "MUTE", payload: { muted: true } });
    expect(parseHostMessage({ hpg: 1, session: S, type: "MUTE", payload: { muted: "yes" } }, S)).toBeNull();
    expect(parseHostMessage({ hpg: 1, session: S, type: "REPLY", payload: 1 }, S)).toBeNull();
  });
});

type Sent = { type: string; id?: number; payload?: unknown };

function setup(over: Partial<GuestConfig> = {}, url?: string) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { runScripts: "outside-only", ...(url ? { url } : {}) });
  const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
  const sent: Sent[] = [];
  const hostToken = {};
  const created: string[] = [];
  let n = 0;
  win.URL.createObjectURL = vi.fn(() => {
    const u = `blob:null/${++n}`;
    created.push(u);
    return u;
  });
  win.Response = globalThis.Response as never;
  win.fetch = vi.fn(async () => "network") as never;
  class FakeWorker {
    constructor(public url: string, public opts?: WorkerOptions) {}
  }
  win.Worker = FakeWorker as never;
  const config: GuestConfig = {
    session: S,
    gameId: "g",
    storage: { best: "42" },
    files: {
      "assets/w.js": { type: "text/javascript", b64: Buffer.from("onmessage=()=>{}").toString("base64") },
      "wasm/m.wasm": { type: "application/wasm", b64: Buffer.from([0, 97, 115, 109]).toString("base64") },
    },
    classicWorkers: ["assets/w.js"],
    muted: false,
    handle: "ZK",
    ...over,
  };
  const guest = installGuest(win, config, {
    post: (m) => sent.push(m as Sent),
    isHost: (e) => (e as MessageEvent & { _from?: unknown })._from === hostToken,
  });
  const fromHost = (data: unknown) => {
    const ev = new win.MessageEvent("message", { data: { hpg: 1, session: S, ...(data as object) } });
    (ev as MessageEvent & { _from?: unknown })._from = hostToken;
    win.dispatchEvent(ev);
  };
  return { win, sent, guest, fromHost, created, dom };
}

describe("installGuest", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("replaces localStorage with a Storage preloaded from the save", () => {
    const { win } = setup();
    const ls = win.localStorage;
    expect(ls.getItem("best")).toBe("42");
    expect(ls.best).toBe("42");
    ls.setItem("n", 5 as unknown as string);
    expect(ls.getItem("n")).toBe("5");
    (ls as unknown as Record<string, string>).viaProp = "p";
    expect(ls.getItem("viaProp")).toBe("p");
    expect("viaProp" in ls).toBe(true);
    expect(Object.keys(ls).sort()).toEqual(["best", "n", "viaProp"]);
    expect(JSON.parse(JSON.stringify(ls))).toEqual({ best: "42", n: "5", viaProp: "p" });
    delete (ls as unknown as Record<string, string>).viaProp;
    expect(ls.length).toBe(2);
    expect(ls.key(0)).toBe("best");
    expect(ls.key(9)).toBeNull();
    expect(ls instanceof win.Storage).toBe(true);
    expect(ls.getItem("missing")).toBeNull();
  });

  it("debounces saves to the launcher and flushes on FLUSH", () => {
    const { win, sent, fromHost } = setup();
    win.localStorage.setItem("a", "1");
    win.localStorage.setItem("b", "2");
    expect(sent.filter((m) => m.type === "SAVE_REQUEST")).toHaveLength(0);
    vi.advanceTimersByTime(500);
    const saves = sent.filter((m) => m.type === "SAVE_REQUEST");
    expect(saves).toHaveLength(1);
    expect(saves[0].payload).toEqual({ storage: { best: "42", a: "1", b: "2" } });
    fromHost({ type: "FLUSH" });
    expect(sent.filter((m) => m.type === "SAVE_REQUEST")).toHaveLength(2);
  });

  it("does not save when nothing changed", () => {
    const { win, sent } = setup();
    win.localStorage.setItem("best", "42");
    vi.advanceTimersByTime(1000);
    expect(sent.filter((m) => m.type === "SAVE_REQUEST")).toHaveLength(0);
  });

  it("throws QuotaExceededError past the save budget, like the real Storage", () => {
    const { win } = setup();
    expect(() => win.localStorage.setItem("big", "x".repeat(MAX_SAVE_CHARS))).toThrow(/quota/i);
  });

  it("keeps sessionStorage in memory and never saves it", () => {
    const { win, sent } = setup();
    win.sessionStorage.setItem("s", "1");
    vi.advanceTimersByTime(1000);
    expect(win.sessionStorage.getItem("s")).toBe("1");
    expect(sent.filter((m) => m.type === "SAVE_REQUEST")).toHaveLength(0);
  });

  it("makes document.cookie harmless", () => {
    const { win } = setup();
    win.document.cookie = "a=1";
    expect(win.document.cookie).toBe("");
  });

  it("resolves hpg:/ URLs through fetch and passes others through", async () => {
    const { win } = setup();
    const res = (await win.fetch("hpg:/wasm/m.wasm")) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/wasm");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
    expect(((await win.fetch("hpg:/nope.js")) as Response).status).toBe(404);
    expect(((await win.fetch("hpg:/../x")) as Response).status).toBe(404);
    expect(await win.fetch("https://example.com")).toBe("network");
  });

  it("serves relative URLs that name a package file, from the launcher's folder", async () => {
    const base = "file:///Users/me/HallPass%20Arcade/index.html";
    const files = { "assets/m.glb": { type: "model/gltf-binary", b64: "AAAA" }, "assets/i.png": { type: "image/png", b64: "AAAA" } };
    const { win, created } = setup({ files }, base);
    // As a string, and as the absolute URL a Request has already resolved it to.
    expect(((await win.fetch("assets/m.glb")) as Response).status).toBe(200);
    expect(((await win.fetch("./assets/m.glb?v=2")) as Response).status).toBe(200);
    expect(((await win.fetch(new win.URL("assets/m.glb", base))) as Response).status).toBe(200);
    // Not in the package, or outside the folder: passed through untouched.
    expect(await win.fetch("assets/other.glb")).toBe("network");
    expect(await win.fetch("../assets/m.glb")).toBe("network");
    expect(await win.fetch("https://example.com/assets/m.glb")).toBe("network");
    const img = win.document.createElement("img");
    img.src = "assets/i.png";
    expect(img.src).toBe(created[0]);
  });

  it("starts packaged workers from frame blobs as classic workers", () => {
    const { win, created } = setup();
    const w = new win.Worker(new win.URL("hpg:/assets/w.js"), { type: "module" }) as unknown as { url: string; opts: WorkerOptions };
    expect(w.url).toBe(created[0]);
    expect(w.opts.type).toBe("classic");
    const same = new win.Worker("hpg:/assets/w.js") as unknown as { url: string };
    expect(same.url).toBe(created[0]); // blob URL reused, not re-minted
    expect(() => new win.Worker("hpg:/assets/missing.js")).toThrow(/no package file/);
    const plain = new win.Worker("other.js") as unknown as { url: string };
    expect(plain.url).toBe("other.js");
  });

  it("resolves hpg:/ image sources", () => {
    const { win, created } = setup({ files: { "assets/i.png": { type: "image/png", b64: "AAAA" } } });
    const img = win.document.createElement("img");
    img.src = "hpg:/assets/i.png";
    expect(img.src).toBe(created[0]);
  });

  it("provides the offline HallPass SDK and HPG API", async () => {
    const { win, sent, fromHost } = setup();
    const hp = win.HallPass as Record<string, (...a: unknown[]) => unknown> & { version: string; mode: string };
    expect(hp.version).not.toBe("0");
    expect(win.HP).toBe(win.HallPass);
    expect(await hp.ready()).toEqual({ ready: true, game: "g", handle: "ZK", mode: "live" });

    const p = hp.submitScore(1234) as Promise<unknown>;
    const req = sent.find((m) => m.type === "SCORE_SUBMIT")!;
    expect(req.payload).toEqual({ score: 1234, handle: "ZK" });
    fromHost({ type: "REPLY", id: req.id, payload: { ok: true, rank: 2 } });
    expect(await p).toEqual({ ok: true, rank: 2, status: "accepted" });
    expect(await hp.submitScore("lots")).toEqual({ ok: false, reason: "bad-score" });

    const s = hp.getScores({ limit: 5 }) as Promise<unknown>;
    const sreq = sent.find((m) => m.type === "SCORES_REQUEST")!;
    fromHost({ type: "REPLY", id: sreq.id, payload: [{ rank: 1, handle: "A", score: 9, at: 1 }] });
    expect(await s).toEqual([{ rank: 1, handle: "A", score: 9 }]);

    expect(await hp.unlock("x")).toEqual({ ok: false, reason: "inert" });
    expect(await hp.getPlayer()).toBeNull();
    expect(hp.on("ready", () => {})).toBe(hp);

    (win.HPG as { exit(): void }).exit();
    expect(sent.at(-1)?.type).toBe("GAME_EXIT");
  });

  it("times out unanswered requests with a safe result", async () => {
    const { win } = setup();
    const p = (win.HallPass as { submitScore(n: number): Promise<unknown> }).submitScore(1);
    vi.advanceTimersByTime(6000);
    expect(await p).toEqual({ ok: false, reason: "inert" });
  });

  it("ignores messages not from the host or from another session", () => {
    const { win, sent } = setup();
    win.dispatchEvent(new win.MessageEvent("message", { data: { hpg: 1, session: S, type: "FLUSH" } }));
    expect(sent.filter((m) => m.type === "SAVE_REQUEST")).toHaveLength(0);
  });

  it("reports uncaught errors, capped", () => {
    const { win, sent } = setup();
    for (let i = 0; i < 20; i++) win.dispatchEvent(new win.ErrorEvent("error", { message: `boom ${i}` }));
    const errs = sent.filter((m) => m.type === "GAME_ERROR");
    expect(errs).toHaveLength(10);
    expect(errs[0].payload).toEqual({ message: "boom 0" });
  });

  it("turns a game's own requestFullscreen into a launcher request", async () => {
    const { win, sent } = setup();
    await win.document.body.requestFullscreen();
    expect(sent.at(-1)?.type).toBe("FULLSCREEN_REQUEST");
  });

  it("dispatches pause/resume events", () => {
    const { win, fromHost } = setup();
    const seen: string[] = [];
    win.addEventListener("hpg:pause", () => seen.push("pause"));
    win.addEventListener("hpg:resume", () => seen.push("resume"));
    fromHost({ type: "PAUSE" });
    fromHost({ type: "PAUSE" });
    fromHost({ type: "RESUME" });
    expect(seen).toEqual(["pause", "resume"]);
  });

  it("routes audio to the destination through a master gain the launcher mutes", () => {
    const dom = new JSDOM("<!doctype html>");
    const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
    const connections: [unknown, unknown][] = [];
    class FakeNode {
      constructor(public context: FakeCtx) {}
      connect(dest: unknown) {
        connections.push([this, dest]);
        return dest;
      }
      disconnect() {}
    }
    class FakeGain extends FakeNode {
      gain = { value: 1 };
    }
    class FakeCtx {
      destination = { isDestination: true };
      state = "running";
      createGain() {
        return new FakeGain(this);
      }
      suspend = vi.fn(async () => {});
      resume = vi.fn(async () => {});
    }
    win.AudioNode = FakeNode as never;
    const hostToken = {};
    installGuest(win, { session: S, gameId: "g", storage: {}, files: {}, classicWorkers: [], muted: true, handle: null }, {
      post: () => {},
      isHost: (e) => (e as MessageEvent & { _from?: unknown })._from === hostToken,
    });
    const ctx = new FakeCtx();
    const osc = new FakeNode(ctx);
    expect(osc.connect(ctx.destination)).toBe(ctx.destination);
    const master = connections.find(([from]) => from instanceof FakeGain)![0] as FakeGain;
    expect(connections).toContainEqual([master, ctx.destination]);
    expect(connections).toContainEqual([osc, master]);
    expect(master.gain.value).toBe(0); // started muted
    const send = (data: object) => {
      const ev = new win.MessageEvent("message", { data: { hpg: 1, session: S, ...data } });
      (ev as MessageEvent & { _from?: unknown })._from = hostToken;
      win.dispatchEvent(ev);
    };
    send({ type: "MUTE", payload: { muted: false } });
    expect(master.gain.value).toBe(1);
    send({ type: "PAUSE" });
    expect(ctx.suspend).toHaveBeenCalled();
    send({ type: "RESUME" });
    expect(ctx.resume).toHaveBeenCalled();
  });
});
