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
  // Cached immutable copy of `entries`, replaced only when the buffer changes.
  // `useSyncExternalStore` requires getSnapshot to return a stable reference
  // between changes, so callers read this rather than a fresh `.slice()`.
  snapshot: ConsoleEntry[];
  listeners: Set<Listener>;
  patched: boolean;
  seq: number;
};

const MAX_ENTRIES = 300;
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
      listeners: new Set(),
      patched: false,
      seq: 0,
    };
  }
  return window.__hpConsoleStore;
}

/** Refresh the cached snapshot and notify subscribers. */
function commit(store: ConsoleStore): void {
  store.snapshot = store.entries.slice();
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

function persist(store: ConsoleStore): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(store.entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    /* storage full / disabled (Safari private mode) — in-memory still works */
  }
}

function hydrate(store: ConsoleStore): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
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
    store.entries = entries.slice(-MAX_ENTRIES);
    store.snapshot = store.entries.slice();
    store.seq = entries.reduce((max, e) => Math.max(max, e.id), 0);
  } catch {
    /* corrupt payload — start clean */
  }
}

function record(level: ConsoleLevel, args: unknown[]): void {
  const store = getStore();
  if (!store) return;
  const entry: ConsoleEntry = {
    id: ++store.seq,
    ts: Date.now(),
    level,
    text: args.map(formatArg).join(" "),
  };
  store.entries.push(entry);
  if (store.entries.length > MAX_ENTRIES) {
    store.entries.splice(0, store.entries.length - MAX_ENTRIES);
  }
  persist(store);
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
}

/**
 * Stable snapshot of buffered entries, oldest first. Returns the SAME reference
 * between changes (and a stable empty array during SSR / before init) so it can
 * back `useSyncExternalStore` directly.
 */
export function getConsoleLogEntries(): ConsoleEntry[] {
  return getStore()?.snapshot ?? EMPTY;
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
  persist(store);
  commit(store);
}
