// @vitest-environment jsdom
/**
 * Live-store tests for `personalization.ts` — the wiring the pure-helper suite
 * (`personalization.test.ts`) deliberately leaves out: the localStorage-backed
 * `useSyncExternalStore` store, the imperative `toggleFavorite`/`recordRecentPlay`
 * mutations, and the login-time `useFavoritesServerSync` reconciliation (including
 * the local-deletion-wins guard).
 *
 * Two jsdom quirks shape the setup:
 *   1. This repo's jsdom ships a NON-functional `localStorage`, so we install a
 *      real in-memory `Storage` (same trick as `sdk/src/handle.test.ts`).
 *   2. The store keeps MODULE-SCOPE caches (`favSnapshot`, `loaded`, `signedIn`,
 *      the pending-unfavorite buffer). We `vi.resetModules()` between tests and
 *      `import()` React + the store FRESH inside each test so (a) state is isolated
 *      and (b) the test and the store share ONE React instance (a statically
 *      imported React would be a different copy after the reset → dispatcher error).
 *
 * `renderHook` is a ~20-line shim (no @testing-library dep) over React 19's `act`
 * + `react-dom/client`, enough to drive the hooks and read their latest return.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAVORITES_KEY = "hp:favorites";
const RECENT_KEY = "hp:recent";

/** Install a real in-memory `Storage` over jsdom's non-functional one. */
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
}

/** Flush the queued micro/macro-tasks so an async effect chain settles. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

type Hook<T> = () => T;
type View<T> = {
  result: { current: T };
  act: (cb: () => void | Promise<void>) => Promise<void>;
  unmount: () => Promise<void>;
};

/**
 * Load a FRESH copy of the store (and the React it renders with) after the
 * per-test `resetModules`, and return a tiny `renderHook`.
 */
async function loadStore() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const mod = await import("./personalization");
  const act = React.act as (cb: () => void | Promise<void>) => Promise<void>;

  async function renderHook<T>(hook: Hook<T>): Promise<View<T>> {
    const container = document.createElement("div");
    const root = createRoot(container);
    const result = { current: undefined as unknown as T };
    function Probe(): null {
      result.current = hook();
      return null;
    }
    await act(() => {
      root.render(React.createElement(Probe));
    });
    return {
      result,
      act,
      unmount: () => act(() => root.unmount()),
    };
  }

  return { mod, renderHook };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installMemoryStorage();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("favorites store (toggleFavorite)", () => {
  it("updates the live list, persists to localStorage, and (as a guest) skips the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { mod, renderHook } = await loadStore();

    const view = await renderHook(() => mod.useFavorites());
    expect(view.result.current.favorites).toEqual([]);

    await view.act(() => mod.toggleFavorite("alpha"));
    expect(view.result.current.favorites).toEqual(["alpha"]);
    expect(view.result.current.isFavorite("alpha")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual(["alpha"]);
    // Guest = local only: a toggle must not fire any server mutation.
    expect(fetchSpy).not.toHaveBeenCalled();

    // Newest-first prepend, then toggling again removes it.
    await view.act(() => mod.toggleFavorite("beta"));
    expect(view.result.current.favorites).toEqual(["beta", "alpha"]);
    await view.act(() => mod.toggleFavorite("alpha"));
    expect(view.result.current.favorites).toEqual(["beta"]);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual(["beta"]);

    await view.unmount();
  });
});

describe("recently-played store (recordRecentPlay)", () => {
  it("moves-to-front, de-dupes, and caps at 12", async () => {
    const { mod, renderHook } = await loadStore();
    const view = await renderHook(() => mod.useRecentlyPlayed());

    await view.act(() => {
      mod.recordRecentPlay("a");
      mod.recordRecentPlay("b");
      mod.recordRecentPlay("c");
    });
    expect(view.result.current.recent).toEqual(["c", "b", "a"]);
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY)!)).toEqual(["c", "b", "a"]);

    // Replaying an existing entry moves it to the front without duplicating.
    await view.act(() => mod.recordRecentPlay("a"));
    expect(view.result.current.recent).toEqual(["a", "c", "b"]);

    // Cap at 12 (RECENT_CAP), oldest fall off.
    await view.act(() => {
      for (let i = 0; i < 20; i++) mod.recordRecentPlay(`g${i}`);
    });
    expect(view.result.current.recent).toHaveLength(12);
    expect(view.result.current.recent[0]).toBe("g19");
    expect(view.result.current.recent).not.toContain("g7");

    await view.unmount();
  });

  it("keeps the snapshot reference stable when replaying the current front (no needless re-render)", async () => {
    const { mod, renderHook } = await loadStore();
    const view = await renderHook(() => mod.useRecentlyPlayed());

    await view.act(() => mod.recordRecentPlay("x"));
    const ref = view.result.current.recent;
    // "x" is already at the front → early return, no emit, identical snapshot.
    await view.act(() => mod.recordRecentPlay("x"));
    expect(view.result.current.recent).toBe(ref);

    await view.unmount();
  });
});

describe("login sync (useFavoritesServerSync)", () => {
  /** Build a fetch stub recording calls; GET resolution is caller-controlled. */
  function stubSync(getFavorites: Promise<string[]>) {
    const calls: Array<{ method: string; body: { slug?: string; slugs?: string[] } | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        calls.push({ method, body });
        if (method === "GET") {
          return getFavorites.then(
            (favorites) =>
              ({ ok: true, json: async () => ({ signedIn: true, favorites }) }) as Response,
          );
        }
        if (method === "PUT") {
          return Promise.resolve({ ok: true, json: async () => ({ favorites: body.slugs }) } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response);
      }),
    );
    return calls;
  }

  it("unions local + server favorites and PUTs the merged list", async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(["local-only"]));
    const calls = stubSync(Promise.resolve(["server-only"]));
    const { mod, renderHook } = await loadStore();

    const view = await renderHook(() => {
      mod.useFavoritesServerSync();
      return mod.useFavorites();
    });
    await view.act(async () => flush());

    // local first, then server-only slugs the union didn't already hold.
    expect(view.result.current.favorites).toEqual(["local-only", "server-only"]);
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body?.slugs).toEqual(["local-only", "server-only"]);

    await view.unmount();
  });

  it("does NOT resurrect a favorite the user removed during the sync window, and deletes it server-side", async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(["a", "b"]));
    let resolveGet!: (favorites: string[]) => void;
    const getFavorites = new Promise<string[]>((r) => {
      resolveGet = r;
    });
    const calls = stubSync(getFavorites);
    const { mod, renderHook } = await loadStore();

    const view = await renderHook(() => {
      mod.useFavoritesServerSync();
      return mod.useFavorites();
    });

    // GET is still in flight (signedIn === false): the user unfavorites "a".
    await view.act(() => mod.toggleFavorite("a"));
    expect(view.result.current.favorites).toEqual(["b"]);

    // The server replies that it still holds ["a","b"]; the union must NOT win.
    await view.act(async () => {
      resolveGet(["a", "b"]);
      await flush();
    });

    expect(view.result.current.favorites).toEqual(["b"]);
    // The insert-only PUT can't express the deletion, so a DELETE must be sent…
    expect(calls.some((c) => c.method === "DELETE" && c.body?.slug === "a")).toBe(true);
    // …and the PUT must not have re-added "a".
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body?.slugs).not.toContain("a");

    await view.unmount();
  });
});
