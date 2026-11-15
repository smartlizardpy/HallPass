// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assemblePackage, type ManifestBase, type PackageFile } from "../archive/assemble";
import { readPackage, type LoadedPackage } from "../archive/package";
import { listZip, readZipEntries } from "../archive/zip";
import { PACKAGE_LIMITS } from "../format/constants";
import { buildGameDocument } from "./document";
import { MemoryKv, openKv } from "./kv";
import { PackageLibrary } from "./library";
import { SaveStore, SAVE_EXPORT_FORMAT } from "./saves";
import { GameSession, type SessionCallbacks } from "./session";

const enc = (s: string) => new TextEncoder().encode(s);

function base(over: Partial<ManifestBase> = {}): ManifestBase {
  return {
    format: "hpg",
    formatVersion: 1,
    id: "alpha",
    name: "Alpha",
    version: "1.0.0",
    description: "A game",
    entry: "game.html",
    runtime: "html",
    offline: true,
    permissions: [],
    minimumLauncherVersion: "1.0.0",
    ...over,
  };
}
const ENTRY = '<!doctype html><html><head><meta charset="utf-8"><title>A</title><script>window.gameRan=1</script></head><body><canvas></canvas></body></html>';

async function loaded(over: Partial<ManifestBase> = {}, extra: PackageFile[] = []): Promise<LoadedPackage> {
  const p = await assemblePackage(base(over), [{ path: "game.html", data: enc(ENTRY), role: "entry" }, ...extra]);
  return readPackage(p.bytes);
}

describe("buildGameDocument", () => {
  it("injects config and runtime as the first scripts, after the charset", () => {
    const html = buildGameDocument(ENTRY, { x: "</script><b>" } as never, "/*rt*/");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const head = [...doc.head.children];
    expect(head[0].matches("meta[charset]")).toBe(true);
    expect(head[1].textContent).toMatch(/^window\.__HPG_BOOT__=/);
    expect(head[1].textContent).not.toContain("</script");
    expect(head[1].textContent).toContain("\\u003c/script>");
    expect(head[2].textContent).toBe("/*rt*/");
    expect(head[4].textContent).toBe("window.gameRan=1");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("refuses a runtime that would break out of its script element", () => {
    expect(() => buildGameDocument(ENTRY, {} as never, "x='</script>'")).toThrow();
  });
});

describe("GameSession", () => {
  let container: HTMLElement;
  let cb: SessionCallbacks & Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    cb = {
      onReady: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
      onSlowStart: vi.fn(),
      onSave: vi.fn(async () => {}),
      onScore: vi.fn(async () => 3),
      onScoresRequest: vi.fn(async () => []),
      onLoadRequest: vi.fn(async () => null),
    } as never;
  });
  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  async function start(over: Partial<ManifestBase> = {}) {
    const pkg = await loaded(over);
    const s = new GameSession({ container, pkg, save: { storage: { best: "1" } }, muted: false, handle: null, runtimeJs: "/*rt*/", callbacks: cb, newSessionId: () => "S" });
    const frame = s.start();
    const posted: unknown[] = [];
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((m: unknown) => void posted.push(m));
    const fromGame = (data: object, init: { source?: unknown; origin?: string } = {}) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { hpg: 1, session: "S", ...data },
          origin: init.origin ?? "null",
          source: (init.source ?? frame.contentWindow) as Window,
        }),
      );
    return { s, frame, posted, fromGame };
  }

  it("creates a strictly sandboxed frame without allow-same-origin", async () => {
    const { frame } = await start();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.srcdoc).toContain("__HPG_BOOT__");
    expect(frame.srcdoc).toContain('"storage":{"best":"1"}');
    const { frame: f2 } = await start({ id: "beta", permissions: ["pointer-lock"] });
    expect(f2.getAttribute("sandbox")).toBe("allow-scripts allow-pointer-lock");
  });

  it("ignores messages from other windows, other origins and other sessions", async () => {
    const { fromGame } = await start();
    fromGame({ type: "GAME_READY" }, { source: window });
    fromGame({ type: "GAME_READY" }, { origin: "file://" });
    fromGame({ type: "GAME_READY", session: "OTHER" });
    expect(cb.onReady).not.toHaveBeenCalled();
    fromGame({ type: "GAME_READY" });
    fromGame({ type: "GAME_READY" });
    expect(cb.onReady).toHaveBeenCalledTimes(1);
  });

  it("answers scores and loads with REPLY messages", async () => {
    const { fromGame, posted } = await start();
    fromGame({ type: "SCORE_SUBMIT", id: 7, payload: { score: 99, handle: "ZK" } });
    await vi.runAllTicks();
    await Promise.resolve();
    expect(cb.onScore).toHaveBeenCalledWith(99, "ZK");
    expect(posted).toContainEqual({ hpg: 1, session: "S", type: "REPLY", id: 7, payload: { ok: true, rank: 3 } });
  });

  it("coalesces saves and reports errors and exits", async () => {
    const { fromGame } = await start();
    fromGame({ type: "SAVE_REQUEST", payload: { storage: { a: "1" } } });
    fromGame({ type: "SAVE_REQUEST", payload: { storage: { a: "2" } } });
    expect(cb.onSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onSave).toHaveBeenCalledTimes(1);
    expect(cb.onSave).toHaveBeenCalledWith({ storage: { a: "2" } });
    fromGame({ type: "GAME_ERROR", payload: { message: "boom" } });
    fromGame({ type: "GAME_EXIT" });
    expect(cb.onError).toHaveBeenCalledWith("boom");
    expect(cb.onExit).toHaveBeenCalled();
  });

  it("drops oversized or malformed saves", async () => {
    const { fromGame } = await start();
    fromGame({ type: "SAVE_REQUEST", payload: { storage: { a: 1 } } });
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onSave).not.toHaveBeenCalled();
  });

  it("forwards fullscreen requests and detects an in-game reload", async () => {
    cb.onFullscreenRequest = vi.fn();
    cb.onReload = vi.fn();
    const { fromGame, frame } = await start();
    fromGame({ type: "FULLSCREEN_REQUEST" });
    expect(cb.onFullscreenRequest).toHaveBeenCalled();
    frame.dispatchEvent(new Event("load"));
    expect(cb.onReload).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event("load"));
    expect(cb.onReload).toHaveBeenCalledTimes(1);
  });

  it("flags a slow start", async () => {
    await start();
    await vi.advanceTimersByTimeAsync(16000);
    expect(cb.onSlowStart).toHaveBeenCalled();
  });

  it("closes cleanly: flushes, removes its listener, frame and timers", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { s, frame, posted, fromGame } = await start();
    const closing = s.close();
    expect(posted).toContainEqual({ hpg: 1, session: "S", type: "FLUSH" });
    fromGame({ type: "SAVE_REQUEST", payload: { storage: { final: "yes" } } });
    await vi.advanceTimersByTimeAsync(500);
    await closing;
    expect(cb.onSave).toHaveBeenCalledWith({ storage: { final: "yes" } });
    const added = add.mock.calls.filter(([t]) => t === "message").map(([, fn]) => fn);
    const removed = remove.mock.calls.filter(([t]) => t === "message").map(([, fn]) => fn);
    expect(removed).toEqual(added);
    expect(frame.isConnected).toBe(false);
    expect(s.iframe).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await s.close(); // idempotent
    fromGame({ type: "GAME_EXIT" }, { source: null as never });
    expect(cb.onExit).not.toHaveBeenCalled();
  });

  it("closes without waiting forever when the game never flushes", async () => {
    const { s } = await start();
    const closing = s.close();
    await vi.advanceTimersByTimeAsync(500);
    await closing;
    expect(s.isClosed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SaveStore", () => {
  it("saves, loads and ranks scores in either order", async () => {
    let t = 1000;
    const store = new SaveStore(new MemoryKv(), () => t++);
    await store.save("alpha", "1.0.0", { storage: { lvl: "3" }, custom: { x: 1 } });
    expect((await store.load("alpha"))?.data).toEqual({ storage: { lvl: "3" }, custom: { x: 1 } });
    expect(await store.load("nope")).toBeNull();
    expect(await store.addScore("alpha", 10, "A")).toBe(1);
    expect(await store.addScore("alpha", 30, "B")).toBe(1);
    expect(await store.addScore("alpha", 20, "C")).toBe(2);
    expect((await store.scores("alpha")).map((s) => s.score)).toEqual([30, 20, 10]);
    expect(await store.addScore("speed", 12.5, "A", "asc")).toBe(1);
    expect(await store.addScore("speed", 9.1, "B", "asc")).toBe(1);
    expect((await store.scores("speed", "asc")).map((s) => s.rank)).toEqual([1, 2]);
  });

  it("exports and imports into a fresh store (round trip)", async () => {
    const a = new SaveStore(new MemoryKv());
    await a.save("alpha", "1.0.0", { storage: { k: "v" } });
    await a.addScore("alpha", 5, "Z");
    await a.addScore("beta", 7, "Y"); // a board with no save still exports
    const file = JSON.parse(JSON.stringify(await a.exportAll()));
    expect(file.format).toBe(SAVE_EXPORT_FORMAT);
    const b = new SaveStore(new MemoryKv());
    const r = await b.importAll(file);
    expect(r).toEqual({ imported: 1, scores: 2, rejected: [] });
    expect((await b.load("alpha"))?.data.storage).toEqual({ k: "v" });
    expect((await b.scores("beta"))[0].score).toBe(7);
    await b.importAll(file); // re-import does not double scores
    expect(await b.scores("alpha")).toHaveLength(1);
  });

  it("rejects foreign files and newer versions, and imports the valid part of a mixed file", async () => {
    const s = new SaveStore(new MemoryKv());
    await expect(s.importAll({ hello: 1 })).rejects.toThrow(/not a HallPass/);
    await expect(s.importAll({ format: SAVE_EXPORT_FORMAT, version: 2, saves: [] })).rejects.toThrow(/newer/);
    const r = await s.importAll({
      format: SAVE_EXPORT_FORMAT,
      version: 1,
      saves: [
        { saveFormat: 1, gameId: "alpha", gameVersion: "1.0.0", updatedAt: 1, data: { storage: { a: "1" } } },
        { saveFormat: 9, gameId: "beta", gameVersion: "1.0.0", updatedAt: 1, data: { storage: {} } },
        { saveFormat: 1, gameId: "../x", gameVersion: "1.0.0", updatedAt: 1, data: { storage: {} } },
      ],
      scores: { alpha: [{ score: "NaN", handle: "x", at: 1 }] },
    });
    expect(r.imported).toBe(1);
    expect(r.rejected.map((x) => x.reason)).toEqual(["made by a newer arcade", "invalid game id", "scores are invalid"]);
  });
});

describe("PackageLibrary", () => {
  it("adds, detects unchanged, updates and replaces by version", async () => {
    const kv = new MemoryKv();
    const { library } = await PackageLibrary.open(kv, {});
    const v1 = await loaded();
    expect(await library.add(v1)).toEqual({ kind: "added" });
    expect(await library.add(await loaded())).toEqual({ kind: "unchanged" });
    expect(await library.add(await loaded({ version: "1.1.0" }))).toEqual({ kind: "updated", from: "1.0.0", to: "1.1.0" });
    expect(await library.add(v1)).toEqual({ kind: "replaced", from: "1.1.0", to: "1.0.0" });
    expect(library.size).toBe(1);
  });

  it("re-verifies stored packages on open and drops tampered or untrusted ones", async () => {
    const kv = new MemoryKv();
    const good = await loaded({ id: "good" });
    const bad = await loaded({ id: "bad" });
    const { library } = await PackageLibrary.open(kv, {});
    await library.add(good);
    await library.add(bad);
    // Tamper with the stored copy of "bad": re-zip with a changed entry.
    const files = Object.fromEntries(readZipEntries(bad.archive, listZip(bad.archive, PACKAGE_LIMITS), PACKAGE_LIMITS));
    files["game.html"] = enc(ENTRY.replace("gameRan=1", "gameRan=2"));
    const { zipSync } = await import("fflate");
    await kv.put("packages", "bad", { id: "bad", manifestDigest: bad.manifestDigest, addedAt: 0, archive: zipSync(files) });
    const reopened = await PackageLibrary.open(kv, {});
    expect(reopened.library.list().map((g) => g.pkg.manifest.id)).toEqual(["good"]);
    expect(reopened.dropped).toEqual(["bad"]);
    const strict = await PackageLibrary.open(kv, { trustedManifestDigests: new Set() });
    expect(strict.library.size).toBe(0);
  });
});

describe("openKv", () => {
  it("falls back to memory with a reason when IndexedDB is missing or broken", async () => {
    const none = await openKv(undefined);
    expect(none.kv.persistent).toBe(false);
    expect(none.reason).toMatch(/not available/);
    const throwing = { open() { throw new DOMException("denied", "SecurityError"); } } as unknown as IDBFactory;
    const r = await openKv(throwing);
    expect(r.kv.persistent).toBe(false);
    expect(r.reason).toMatch(/denied/);
  });
});
