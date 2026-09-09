/**
 * Client-side console capture — a tiny in-browser ring buffer that mirrors
 * `console.*` output (plus uncaught errors and unhandled promise rejections) so
 * the super-admin "Logs" dashboard page can surface them on a phone, where
 * devtools isn't available. This is how a warning like the missing-PostHog-token
 * notice from `instrumentation-client.ts` becomes visible "on the go".
 *
 * Design notes:
 *  - The original console methods are always called, so devtools behaviour is
 *    unchanged.
 *  - State is anchored on `window` (not module scope) so the capture side
 *    (loaded via instrumentation-client) and the viewer (a separate dashboard
 *    chunk) share ONE buffer even if bundled separately.
 *  - Every path is wrapped so a logging failure can never break the app, and the
 *    module no-ops during SSR (no `window`).
 *  - The buffer is capped and mirrored to localStorage so entries survive a hard
 *    reload and are readable in another tab on the same device.
 */

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export type ConsoleEntry = {
  id: number;
  ts: number;
  level: ConsoleLevel;
  text: string;
};

// A no-arg change notification, matching the `useSyncExternalStore` subscribe
// contract: the callback re-reads via `getConsoleLogEntries`.
type Listener = () => void;

type ConsoleStore = {
  entries: ConsoleEntry[];
  // Cached immutable copy of `entries`, rebuilt LAZILY on the next read after a
  // change. `useSyncExternalStore` requires getSnapshot to return a stable
  // reference between changes, so callers read this rather than a fresh
  // `.slice()` — but building it eagerly in `commit` put a full array copy on
  // the hot path of every console call, and nothing reads it unless the Logs
  // page is actually mounted. `snapshotStale` is what defers that work.
  snapshot: ConsoleEntry[];
  snapshotStale: boolean;
  listeners: Set<Listener>;
  patched: boolean;
  seq: number;
  /**
   * Set while `record` is running, so capture cannot re-enter itself.
   *
   * `commit` calls subscriber callbacks, and in production `console` is patched
   * by more than us — posthog-js wraps it too, and its exception capture turns a
   * `console.error` into a network call that can itself `console.error` on
   * failure. Without this latch that is a loop with a synchronous storage write
   * in it, which is a locked main thread rather than a slow one.
   */
  recording: boolean;
  /** Pending debounced flush to localStorage, or null when none is scheduled. */
  persistTimer: ReturnType<typeof setTimeout> | null;
};

const MAX_ENTRIES = 300;

/**
 * Hard ceiling on the rendered text of ONE entry.
 *
 * Without it `formatArg` will happily `JSON.stringify` a whole object graph, and
 * the buffer's real size is unbounded even though its LENGTH is capped: 300
 * entries of a stringified fetch payload is megabytes. That is not merely
 * wasteful, it is the freeze — `persist` re-serialises the entire buffer on the
 * way past, so one fat entry taxes every console call made afterwards, and a big
 * enough buffer exceeds the localStorage quota outright. A truncated line still
 * says what happened; the untruncated one costs the main thread.
 */
export const MAX_TEXT = 2_000;

/**
 * Ceiling on the PERSISTED payload we are willing to read back.
 *
 * `MAX_ENTRIES * MAX_TEXT` is the most this module will ever write, with room to
 * spare for the JSON scaffolding. Anything larger was written by a build from
 * before those caps existed, and parsing it is itself a main-thread stall on
 * every single page load — which is what makes the freeze outlive the fix and
 * stick to the device. Such a payload is dropped rather than restored.
 */
export const MAX_STORED_CHARS = MAX_ENTRIES * MAX_TEXT * 2;

const STORAGE_KEY = "hp:console-logs";
const LEVELS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

// Stable empty reference for SSR / pre-init reads — a fresh [] each call would
// make useSyncExternalStore loop.
const EMPTY: ConsoleEntry[] = [];

declare global {
  interface Window {
    __hpConsoleStore?: ConsoleStore;
  }
}

function getStore(): ConsoleStore | null {
  if (typeof window === "undefined") return null;
  if (!window.__hpConsoleStore) {
    window.__hpConsoleStore = {
      entries: [],
      snapshot: EMPTY,
      snapshotStale: false,
      listeners: new Set(),
      patched: false,
      seq: 0,
      recording: false,
      persistTimer: null,
    };
  }
  return window.__hpConsoleStore;
}

/** Mark the snapshot stale and notify subscribers. */
function commit(store: ConsoleStore): void {
  store.snapshotStale = true;
  store.listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one broken listener must not stop the others */
    }
  });
}

/** Best-effort, circular-safe rendering of a single console argument. */
function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "object") {
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(arg, (_key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      });
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/**
 * How long writes to localStorage are coalesced for.
 *
 * `persist` costs O(buffer) — a `JSON.stringify` of every entry plus a
 * SYNCHRONOUS, disk-backed `setItem` — and it used to run on every single
 * console call. That is the freeze this module was reported for: with a full
 * buffer each `console.log` blocked the main thread for ~16ms, so a burst of a
 * few hundred lines locks the tab long enough for the browser to offer to kill
 * the page. The buffer only has to survive a reload, not each individual line,
 * so one write per burst buys back all of that at no cost to what it is for.
 */
export const PERSIST_DEBOUNCE_MS = 500;

function persist(store: ConsoleStore): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store.entries));
  } catch {
    // Quota exceeded, or storage disabled (Safari private mode). Shed most of
    // the buffer and try once more: retrying the SAME oversized payload on every
    // later flush is how a single burst leaves storage permanently broken.
    try {
      store.entries = store.entries.slice(-Math.ceil(MAX_ENTRIES / 4));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store.entries));
    } catch {
      /* still no good — the in-memory buffer keeps working regardless */
    }
  }
}

/** Queue a flush, unless one is already pending. */
function schedulePersist(store: ConsoleStore): void {
  if (store.persistTimer !== null) return;
  store.persistTimer = setTimeout(() => {
    store.persistTimer = null;
    persist(store);
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Write immediately, cancelling any pending flush. Used when the page is going
 * away, which is precisely when a debounced write would otherwise be lost.
 */
function flushPersist(store: ConsoleStore): void {
  if (store.persistTimer !== null) {
    clearTimeout(store.persistTimer);
    store.persistTimer = null;
  }
  persist(store);
}

function hydrate(store: ConsoleStore): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    // Oversized payloads predate the caps above — drop, don't parse. See
    // {@link MAX_STORED_CHARS}.
    if (raw.length > MAX_STORED_CHARS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const entries = parsed.filter(
      (e): e is ConsoleEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as ConsoleEntry).id === "number" &&
        typeof (e as ConsoleEntry).ts === "number" &&
        typeof (e as ConsoleEntry).text === "string" &&
        LEVELS.includes((e as ConsoleEntry).level),
    );
    // Re-clamp on the way in: entries written before `MAX_TEXT` existed are
    // exactly the ones that would otherwise be re-serialised on every flush.
    store.entries = entries
      .slice(-MAX_ENTRIES)
      .map((e) => (e.text.length > MAX_TEXT ? { ...e, text: truncate(e.text) } : e));
    store.snapshotStale = true;
    store.seq = entries.reduce((max, e) => Math.max(max, e.id), 0);
  } catch {
    /* corrupt payload — start clean */
  }
}

/** Clamp `text` to {@link MAX_TEXT}, saying how much was dropped. */
function truncate(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  return `${text.slice(0, MAX_TEXT)}… [+${text.length - MAX_TEXT} chars]`;
}

function record(level: ConsoleLevel, args: unknown[]): void {
  const store = getStore();
  // A nested console call (from a subscriber, or from another library's console
  // patch) is dropped rather than queued: the outer call is already recording
  // the same incident, and recursing is what turns a log storm into a freeze.
  if (!store || store.recording) return;
  store.recording = true;
  try {
    recordEntry(store, level, args);
  } catch {
    /* capture must never break the app */
  } finally {
    store.recording = false;
  }
}

function recordEntry(
  store: ConsoleStore,
  level: ConsoleLevel,
  args: unknown[],
): void {
  const entry: ConsoleEntry = {
    id: ++store.seq,
    ts: Date.now(),
    level,
    // Clamp per ARGUMENT as well as on the join, so a single huge object cannot
    // push a multi-argument line far past the cap.
    text: truncate(args.map((a) => truncate(formatArg(a))).join(" ")),
  };
  store.entries.push(entry);
  if (store.entries.length > MAX_ENTRIES) {
    store.entries.splice(0, store.entries.length - MAX_ENTRIES);
  }
  schedulePersist(store);
  commit(store);
}

/**
 * Patch `console.*` and register global error handlers ONCE. Safe to call on
 * every page load — instrumentation-client re-runs per full load, and the
 * `patched` guard makes repeat calls no-ops.
 */
export function initConsoleCapture(): void {
  const store = getStore();
  if (!store || store.patched) return;
  store.patched = true;

  hydrate(store);

  for (const level of LEVELS) {
    const original = console[level]?.bind(console) as
      | ((...args: unknown[]) => void)
      | undefined;
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original?.(...args);
    };
  }

  window.addEventListener("error", (event) => {
    const where = event.filename
      ? ` (${event.filename}:${event.lineno}:${event.colno})`
      : "";
    record("error", [`Uncaught: ${event.message}${where}`]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    record("error", ["Unhandled promise rejection:", event.reason]);
  });

  // The debounce above means the last lines of a burst may still be pending when
  // the page goes away. `pagehide` is the event that actually fires for a bfcache
  // restore and for an installed PWA being suspended, which `unload` does not
  // reliably do on mobile.
  window.addEventListener("pagehide", () => flushPersist(store));
}

/**
 * Stable snapshot of buffered entries, oldest first. Returns the SAME reference
 * between changes (and a stable empty array during SSR / before init) so it can
 * back `useSyncExternalStore` directly.
 */
export function getConsoleLogEntries(): ConsoleEntry[] {
  const store = getStore();
  if (!store) return EMPTY;
  if (store.snapshotStale) {
    store.snapshot = store.entries.slice();
    store.snapshotStale = false;
  }
  return store.snapshot;
}

/**
 * Subscribe to buffer changes; returns an unsubscribe function. The listener
 * takes no arguments (re-read via `getConsoleLogEntries`) to match the
 * `useSyncExternalStore` contract.
 */
export function subscribeConsoleLog(listener: Listener): () => void {
  const store = getStore();
  if (!store) return () => {};
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

/** Wipe the buffer (and its persisted copy) and notify subscribers. */
export function clearConsoleLog(): void {
  const store = getStore();
  if (!store) return;
  store.entries = [];
  flushPersist(store);
  commit(store);
}
