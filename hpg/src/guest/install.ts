/**
 * The guest runtime: everything the launcher installs inside a game's sandboxed
 * frame BEFORE the game's first script runs.
 *
 * WHY EACH PIECE EXISTS (all verified in a real browser over file://):
 *
 * - STORAGE. The frame's origin is opaque (no `allow-same-origin`), and in an
 *   opaque origin `localStorage`, `sessionStorage` and `document.cookie` throw
 *   SecurityError on first touch. Most HallPass games read `localStorage` at
 *   boot, so without this they would crash outright. The stand-in is an
 *   in-memory Storage, preloaded from the game's save and written back to the
 *   launcher (debounced, and flushed on exit). The LAUNCHER owns persistence, as
 *   the brief requires, and a failed write in a browser that cannot persist
 *   never reaches the game as an exception.
 *
 * - `hpg:/` FILES. Blob URLs minted by the launcher cannot be loaded by the
 *   frame ("Not allowed to load local resource"), so package files that must
 *   stay separate (workers, WebAssembly, media) travel inside the frame
 *   document as base64. They become blob URLs minted HERE, which the frame may
 *   load. `fetch`, `Worker` and the `src` of images and media understand
 *   `hpg:/path`. Workers start as CLASSIC workers when the packager built them
 *   that way, because module workers from blobs fail in an opaque frame.
 *
 * - THE HALLPASS SDK. About 20 games call `window.HallPass`. The packager
 *   removes the networked SDK script, and this offline SDK takes its place:
 *   scores go to a local leaderboard owned by the launcher, and everything
 *   network-bound settles with the SDK's documented inert results. Its version
 *   is not "0", so the inline stub that games paste before the SDK leaves it
 *   alone (`if (w.HallPass && w.HallPass.version !== "0") return;`).
 *
 * - SOUND AND PAUSE. Each AudioContext's output is routed through a master gain
 *   so the launcher's mute button really silences it, even when the game calls
 *   `resume()` on its own. Media elements are muted directly. PAUSE suspends
 *   audio and dispatches `hpg:pause`; it cannot freeze an arbitrary game's
 *   animation loop, and the launcher never claims it does.
 *
 * Nothing here touches the parent window except `postMessage`. The sandbox, not
 * this code, is the security boundary; see protocol/messages.ts.
 */

import { isSafePackagePath } from "../format/paths";
import {
  MAX_SAVE_CHARS,
  envelope,
  parseHostMessage,
  type GuestMessage,
  type SaveData,
  type ScoreEntry,
} from "../protocol/messages";

export const GUEST_RUNTIME_VERSION = "offline-1";

export type GuestFile = { type: string; b64: string };

export type GuestConfig = {
  session: string;
  gameId: string;
  storage: Record<string, string>;
  custom?: unknown;
  /** Package files reachable as `hpg:/<path>` (everything except the entry). */
  files: Record<string, GuestFile>;
  /** Paths of workers the packager built as classic scripts. */
  classicWorkers: string[];
  muted: boolean;
  handle: string | null;
};

export type HostLink = {
  post(message: unknown): void;
  /** True when a `message` event really came from the launcher. */
  isHost(event: MessageEvent): boolean;
};

type Win = Window & typeof globalThis & Record<string, unknown>;

const SAVE_DEBOUNCE_MS = 400;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_ERROR_REPORTS = 10;

/** Result returned by the offline SDK for features that need the network. */
const INERT = Object.freeze({ ok: false, reason: "inert" });

export type GuestHandle = {
  flush(): void;
  /** The `hpg:/` resolver, exposed for tests. */
  resolve(url: string): string | null;
};

export function installGuest(win: Win, config: GuestConfig, host: HostLink): GuestHandle {
  const send = (msg: GuestMessage) => host.post(envelope(config.session, msg));

  // ---------------------------------------------------------------- saves
  let custom: unknown = config.custom;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const local = createStorage(win, config.storage, () => scheduleSave());
  const session = createStorage(win, {}, () => {});

  function snapshot(): SaveData {
    const data: SaveData = { storage: local.dump() };
    if (custom !== undefined) data.custom = custom;
    return data;
  }
  function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!dirty) return;
    dirty = false;
    send({ type: "SAVE_REQUEST", payload: snapshot() });
  }
  function scheduleSave() {
    dirty = true;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  defineGlobal(win, "localStorage", local.proxy);
  defineGlobal(win, "sessionStorage", session.proxy);
  try {
    Object.defineProperty(win.document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => {},
    });
  } catch {
    /* non-fatal: only matters to games that touch cookies */
  }
  win.addEventListener("pagehide", flush);
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState === "hidden") flush();
  });

  // ---------------------------------------------------------------- hpg:/ files
  const blobUrls = new Map<string, string>();
  const classic = new Set(config.classicWorkers);

  // Plain relative paths ("assets/x.glb", as most loaders use) resolve against
  // the frame's base, which a srcdoc frame inherits from the launcher: the
  // folder index.html sits in. Such a URL names a package file when the
  // package has that path. Anything else under the folder still falls through
  // (and the launcher's CSP refuses it), exactly as before.
  const baseDir = (() => {
    try {
      const u = new win.URL("./", win.document.baseURI);
      return u.protocol === "file:" || u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  })();
  function relativePath(url: string): string | undefined {
    if (!baseDir) return undefined;
    let abs: URL;
    try {
      abs = new win.URL(url, win.document.baseURI);
    } catch {
      return undefined;
    }
    const href = abs.href.split(/[?#]/)[0];
    if (!href.startsWith(baseDir)) return undefined;
    let path: string;
    try {
      path = href.slice(baseDir.length).split("/").map(decodeURIComponent).join("/");
    } catch {
      return undefined;
    }
    return isSafePackagePath(path) && Object.prototype.hasOwnProperty.call(config.files, path) ? path : undefined;
  }

  /**
   * `undefined` = not a package URL (pass it through); `null` = an hpg: URL
   * naming no valid file. Package URLs are `hpg:/<path>`, or a relative URL
   * that resolves to a packaged path (see `relativePath`).
   */
  function vfsPath(url: unknown): string | null | undefined {
    if (typeof url !== "string") return undefined;
    if (!url.startsWith("hpg:")) return relativePath(url);
    let rest = url.slice(4).replace(/^\/+/, "");
    rest = rest.split(/[?#]/)[0];
    let path: string;
    try {
      path = rest.split("/").map(decodeURIComponent).join("/");
    } catch {
      return null;
    }
    return isSafePackagePath(path) && Object.prototype.hasOwnProperty.call(config.files, path) ? path : null;
  }
  function bytesOf(path: string): Uint8Array {
    const bin = win.atob(config.files[path].b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function blobOf(path: string): Blob {
    return new win.Blob([bytesOf(path) as BlobPart], { type: config.files[path].type });
  }
  function urlOf(path: string): string {
    let u = blobUrls.get(path);
    if (!u) {
      u = win.URL.createObjectURL(blobOf(path));
      blobUrls.set(path, u);
    }
    return u;
  }
  function resolve(url: string): string | null {
    const p = vfsPath(url);
    if (p === undefined) return url;
    return p === null ? null : urlOf(p);
  }
  const hrefOf = (v: unknown): unknown =>
    typeof v === "string" ? v : v instanceof win.URL ? v.href : v && typeof v === "object" && "url" in v ? (v as Request).url : v;

  const origFetch = typeof win.fetch === "function" ? win.fetch.bind(win) : null;
  if (origFetch) {
    win.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const p = vfsPath(hrefOf(input));
      if (p === undefined) return origFetch(input, init);
      if (p === null) return Promise.resolve(new win.Response("Not found", { status: 404 }));
      return Promise.resolve(
        new win.Response(bytesOf(p) as BodyInit, { status: 200, headers: { "content-type": config.files[p].type } }),
      );
    } as typeof fetch;
  }

  const OrigWorker = win.Worker;
  if (typeof OrigWorker === "function") {
    win.Worker = new Proxy(OrigWorker, {
      construct(target, args, newTarget) {
        const [url, opts] = args as [unknown, WorkerOptions | undefined];
        const p = vfsPath(hrefOf(url));
        if (p === undefined) return Reflect.construct(target, args, newTarget);
        if (p === null) throw new win.DOMException(`no package file for worker ${String(hrefOf(url))}`, "NotFoundError");
        const o = classic.has(p) && opts?.type === "module" ? { ...opts, type: "classic" as const } : opts;
        return Reflect.construct(target, [urlOf(p), o], newTarget);
      },
    });
  }

  for (const Ctor of [win.HTMLImageElement, win.HTMLMediaElement, win.HTMLSourceElement]) {
    const desc = Ctor && Object.getOwnPropertyDescriptor(Ctor.prototype, "src");
    if (!desc?.set || !desc.get) continue;
    const { get, set } = desc;
    Object.defineProperty(Ctor.prototype, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return get.call(this);
      },
      set(v: unknown) {
        const r = typeof v === "string" ? resolve(v) : v;
        set.call(this, r === null ? v : r);
      },
    });
  }

  // ---------------------------------------------------------------- sound + pause
  let muted = config.muted;
  let paused = false;
  const masters = new Map<BaseAudioContext, GainNode>();
  const suspendedByUs = new Set<BaseAudioContext>();
  const mediaPrev = new Map<HTMLMediaElement, boolean>();

  const AudioNodeProto = win.AudioNode?.prototype;
  if (AudioNodeProto) {
    const origConnect = AudioNodeProto.connect as (this: AudioNode, ...a: unknown[]) => unknown;
    const origDisconnect = AudioNodeProto.disconnect as (this: AudioNode, ...a: unknown[]) => unknown;
    const isOffline = (ctx: BaseAudioContext) =>
      typeof win.OfflineAudioContext === "function" && ctx instanceof win.OfflineAudioContext;
    const masterFor = (ctx: BaseAudioContext): GainNode => {
      let g = masters.get(ctx);
      if (!g) {
        g = ctx.createGain();
        origConnect.call(g, ctx.destination);
        g.gain.value = muted ? 0 : 1;
        masters.set(ctx, g);
        if (paused && "suspend" in ctx && ctx.state === "running") {
          (ctx as AudioContext).suspend().catch(() => {});
          suspendedByUs.add(ctx);
        }
      }
      return g;
    };
    AudioNodeProto.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
      const ctx = this.context;
      if (dest && ctx && dest === ctx.destination && !isOffline(ctx) && this !== masters.get(ctx)) {
        origConnect.call(this, masterFor(ctx), ...rest);
        return dest;
      }
      return origConnect.call(this, dest, ...rest);
    } as AudioNode["connect"];
    AudioNodeProto.disconnect = function (this: AudioNode, ...args: unknown[]) {
      const ctx = this.context;
      if (args[0] && ctx && args[0] === ctx.destination && masters.has(ctx)) {
        args[0] = masters.get(ctx);
      }
      return origDisconnect.apply(this, args);
    } as AudioNode["disconnect"];
  }
  const MediaProto = win.HTMLMediaElement?.prototype;
  if (MediaProto) {
    const origPlay = MediaProto.play;
    MediaProto.play = function (this: HTMLMediaElement) {
      if (!mediaPrev.has(this)) mediaPrev.set(this, this.muted);
      if (muted) this.muted = true;
      return origPlay.call(this);
    };
  }
  function applyMute(next: boolean) {
    muted = next;
    for (const g of masters.values()) g.gain.value = muted ? 0 : 1;
    for (const [el, prev] of mediaPrev) el.muted = muted ? true : prev;
  }
  function setPaused(next: boolean) {
    if (paused === next) return;
    paused = next;
    if (paused) {
      for (const ctx of masters.keys()) {
        if ("suspend" in ctx && ctx.state === "running") {
          suspendedByUs.add(ctx);
          (ctx as AudioContext).suspend().catch(() => {});
        }
      }
    } else {
      for (const ctx of suspendedByUs) (ctx as AudioContext).resume().catch(() => {});
      suspendedByUs.clear();
    }
    win.dispatchEvent(new win.CustomEvent(paused ? "hpg:pause" : "hpg:resume"));
  }

  // ---------------------------------------------------------------- requests
  let nextId = 1;
  const pending = new Map<number, (v: unknown) => void>();
  function request<T>(msg: (id: number) => GuestMessage, fallback: T): Promise<T> {
    const id = nextId++;
    return new Promise<T>((res) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        res(fallback);
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, (v) => {
        clearTimeout(timer);
        res(v as T);
      });
      send(msg(id));
    });
  }

  win.addEventListener("message", (event: MessageEvent) => {
    if (!host.isHost(event)) return;
    const msg = parseHostMessage(event.data, config.session);
    if (!msg) return;
    switch (msg.type) {
      case "PAUSE":
        return setPaused(true);
      case "RESUME":
        return setPaused(false);
      case "MUTE":
        return applyMute(msg.payload.muted);
      case "FLUSH":
        dirty = true; // always answer a FLUSH so the launcher holds the latest state
        return flush();
      case "REPLY": {
        const cb = pending.get(msg.id);
        if (cb) {
          pending.delete(msg.id);
          cb(msg.payload);
        }
      }
    }
  });

  // ---------------------------------------------------------------- lifecycle events
  let readySent = false;
  const sendReady = () => {
    if (readySent) return;
    readySent = true;
    send({ type: "GAME_READY" });
  };
  if (win.document.readyState === "complete") setTimeout(sendReady, 0);
  else win.addEventListener("load", sendReady);

  let errorReports = 0;
  const reportError = (message: unknown) => {
    if (errorReports++ >= MAX_ERROR_REPORTS) return;
    send({ type: "GAME_ERROR", payload: { message: String(message ?? "Unknown error").slice(0, 300) } });
  };
  win.addEventListener("error", (e: ErrorEvent) => reportError(e.message));
  win.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: unknown } | undefined;
    reportError(r && typeof r === "object" && "message" in r ? r.message : r);
  });

  // ---------------------------------------------------------------- fullscreen
  // A sandboxed frame without allowfullscreen cannot go fullscreen itself, so a
  // game's own fullscreen button asks the launcher, which toggles the whole
  // player. The click inside the frame also activates the parent (user
  // activation propagates to ancestors), so the launcher may honour it.
  const ElementProto = win.Element?.prototype as (Element & { webkitRequestFullscreen?: () => void }) | undefined;
  if (ElementProto) {
    const ask = () => {
      send({ type: "FULLSCREEN_REQUEST" });
      return Promise.resolve();
    };
    ElementProto.requestFullscreen = ask;
    if ("webkitRequestFullscreen" in ElementProto) ElementProto.webkitRequestFullscreen = () => void ask();
  }

  // ---------------------------------------------------------------- HPG API
  const hpg = Object.freeze({
    version: GUEST_RUNTIME_VERSION,
    offline: true,
    ready: sendReady,
    exit() {
      flush();
      send({ type: "GAME_EXIT" });
    },
    save(value: unknown) {
      custom = value;
      dirty = true;
      flush();
    },
    load(): Promise<unknown> {
      return request<{ custom?: unknown } | null>((id) => ({ type: "LOAD_REQUEST", id }), null).then(
        (r) => (r && typeof r === "object" ? r.custom : undefined) ?? custom,
      );
    },
    url(path: string): string | null {
      return resolve(path.startsWith("hpg:") ? path : `hpg:/${path}`);
    },
  });
  defineGlobal(win, "HPG", hpg);

  // ---------------------------------------------------------------- offline HallPass SDK
  let handle = config.handle;
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = (name: string, payload: unknown) => {
    for (const cb of listeners.get(name) ?? []) {
      try {
        cb(payload);
      } catch (e) {
        reportError((e as Error)?.message ?? e);
      }
    }
  };
  const readyState = () => ({ ready: true, game: config.gameId, handle, mode: "live" as const });
  const resolved = <T>(v: T) => Promise.resolve(v);

  const sdk = {
    version: GUEST_RUNTIME_VERSION,
    mode: "live",
    offline: true,
    ready: () => resolved(readyState()),
    async submitScore(score: unknown, opts?: { handle?: unknown }) {
      if (typeof score !== "number" || !Number.isFinite(score)) return { ok: false, reason: "bad-score" };
      const h = typeof opts?.handle === "string" ? opts.handle : handle ?? undefined;
      const r = await request<{ ok?: unknown; rank?: unknown } | null>(
        (id) => ({ type: "SCORE_SUBMIT", id, payload: { score, ...(h ? { handle: h } : {}) } }),
        null,
      );
      if (!r || r.ok !== true || typeof r.rank !== "number") return { ok: false, reason: "inert" };
      const result = { ok: true, rank: r.rank, status: "accepted" };
      emit("submitted", { score, rank: r.rank });
      return result;
    },
    async getScores(opts?: { limit?: unknown }) {
      const limit = typeof opts?.limit === "number" ? opts.limit : 10;
      const r = await request<unknown>((id) => ({ type: "SCORES_REQUEST", id, payload: { limit } }), []);
      return Array.isArray(r) ? (r as ScoreEntry[]).map(({ rank, handle: hd, score }) => ({ rank, handle: hd, score })) : [];
    },
    getHandle: () => handle,
    setHandle(v: unknown) {
      if (typeof v === "string" && v.trim()) handle = v.trim().slice(0, 32);
      return handle;
    },
    getPlayer: () => resolved(null),
    setPlayerHandle: () => resolved(null),
    signIn() {},
    signOut() {},
    unlock: () => resolved(INERT),
    unlockMany: () => resolved([]),
    progress: () => resolved(INERT),
    getAchievements: () => resolved([]),
    challenge: () => resolved({ ok: false, sent: false, reason: "inert" }),
    moment: () => resolved(INERT),
    invite: () => resolved({ sent: 0, link: null, cancelled: true }),
    getLaunch: () => null,
    on(name: unknown, cb: unknown) {
      if (typeof name === "string" && typeof cb === "function") {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(cb as (p: unknown) => void);
        if (name === "ready") setTimeout(() => (cb as (p: unknown) => void)(readyState()), 0);
      }
      return sdk;
    },
    off(name: unknown, cb: unknown) {
      if (typeof name === "string") listeners.get(name)?.delete(cb as (p: unknown) => void);
      return sdk;
    },
  };
  defineGlobal(win, "HallPass", sdk);
  defineGlobal(win, "HP", sdk);

  return { flush, resolve };
}

function defineGlobal(win: Win, name: string, value: unknown) {
  Object.defineProperty(win, name, { configurable: true, enumerable: true, writable: name === "HallPass" || name === "HP", value });
}

/**
 * An in-memory `Storage` that behaves like the real one closely enough for
 * games: methods, `length`, `key()`, property-style access (`ls.best = 5`,
 * `ls["best"]`), `in`, `delete`, `Object.keys`, `JSON.stringify`, string
 * coercion of keys and values, and a QuotaExceededError at the same budget the
 * launcher enforces on saves.
 */
function createStorage(win: Win, initial: Record<string, string>, onChange: () => void) {
  const map = new Map<string, string>();
  let used = 0;
  for (const [k, v] of Object.entries(initial)) {
    map.set(k, v);
    used += k.length + v.length;
  }
  const api = {
    getItem(k: unknown): string | null {
      const key = String(k);
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(k: unknown, v: unknown): void {
      const key = String(k);
      const val = String(v);
      const prev = map.get(key);
      const delta = prev === undefined ? key.length + val.length : val.length - prev.length;
      if (used + delta > MAX_SAVE_CHARS) {
        throw new win.DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      if (prev === val) return;
      map.set(key, val);
      used += delta;
      onChange();
    },
    removeItem(k: unknown): void {
      const key = String(k);
      const prev = map.get(key);
      if (prev === undefined) return;
      map.delete(key);
      used -= key.length + prev.length;
      onChange();
    },
    clear(): void {
      if (map.size === 0) return;
      map.clear();
      used = 0;
      onChange();
    },
    key(i: unknown): string | null {
      const n = Number(i);
      return Number.isInteger(n) && n >= 0 && n < map.size ? [...map.keys()][n] : null;
    },
    get length() {
      return map.size;
    },
  };
  const isApi = (p: string | symbol): p is keyof typeof api => typeof p === "string" && p in api;
  const target = Object.create(win.Storage ? win.Storage.prototype : Object.prototype) as object;
  const proxy = new Proxy(target, {
    get(_t, p) {
      if (isApi(p)) return p === "length" ? api.length : api[p];
      if (typeof p === "symbol") return p === Symbol.toStringTag ? "Storage" : undefined;
      return map.get(p);
    },
    set(_t, p, v) {
      if (typeof p === "symbol" || isApi(p)) return true;
      api.setItem(p, v);
      return true;
    },
    has: (_t, p) => (typeof p === "string" && map.has(p)) || isApi(p),
    deleteProperty(_t, p) {
      if (typeof p === "string") api.removeItem(p);
      return true;
    },
    ownKeys: () => [...map.keys()],
    getOwnPropertyDescriptor(_t, p) {
      if (typeof p !== "string" || !map.has(p)) return undefined;
      return { value: map.get(p), writable: true, enumerable: true, configurable: true };
    },
    defineProperty(_t, p, desc) {
      if (typeof p === "string" && !isApi(p) && "value" in desc) api.setItem(p, desc.value);
      return true;
    },
  }) as Storage;
  return { proxy, dump: () => Object.fromEntries(map) };
}
