// @vitest-environment jsdom
/**
 * Client behaviour: submitScore maps every outcome to the right reason and never
 * throws; getScores returns [] on any failure; a non-finite score short-circuits
 * to bad-score without touching the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client";
import type { ResolvedConfig } from "./config";

const baseConfig = (): ResolvedConfig => ({
  game: "snake",
  api: "https://api.example",
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * This repo's jsdom ships a non-functional `localStorage` (its methods are not
 * callable), which the SDK tolerates by design. Install a real in-memory
 * implementation so handle persistence is actually exercised here.
 */
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

beforeEach(() => {
  installMemoryStorage();
  // Pre-store a handle so submissions never reach window.prompt.
  window.localStorage.setItem("hallpass:handle", "ABC");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("createClient.submitScore", () => {
  it("maps a 200 to { ok:true, rank } and emits 'submitted'", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ok: true, rank: 3, handle: "ABC", score: 10 }, 200),
        ),
    );
    const events: Array<[string, unknown]> = [];
    const api = createClient(baseConfig(), (event, payload) =>
      events.push([event, payload]),
    );

    const result = await api.submitScore(10);

    expect(result.ok).toBe(true);
    expect(result.rank).toBe(3);
    expect(events.some(([event]) => event === "submitted")).toBe(true);
  });

  it("maps a 429 to the rate-limited reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "slow down" }, 429)),
    );
    const api = createClient(baseConfig(), () => {});

    const result = await api.submitScore(5);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rate-limited");
  });

  it("maps a rejected fetch to the network reason and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const api = createClient(baseConfig(), () => {});

    const result = await api.submitScore(5);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network");
  });

  it("maps another non-2xx to the http reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500)),
    );
    const api = createClient(baseConfig(), () => {});

    const result = await api.submitScore(5);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("http");
  });

  it("short-circuits a non-finite score to bad-score without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const api = createClient(baseConfig(), () => {});

    const result = await api.submitScore(Number.NaN);

    expect(result.reason).toBe("bad-score");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves no-game when no slug is configured", async () => {
    const api = createClient({ game: null, api: "https://api.example" }, () => {});

    const result = await api.submitScore(5);

    expect(result.reason).toBe("no-game");
  });
});

describe("createClient.getScores", () => {
  it("returns the scores array on a 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ scores: [{ rank: 1, handle: "ZZZ", score: 99 }] }, 200),
        ),
    );
    const api = createClient(baseConfig(), () => {});

    const scores = await api.getScores();

    expect(scores).toHaveLength(1);
    expect(scores[0].handle).toBe("ZZZ");
  });

  it("returns [] on a rejected fetch, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const api = createClient(baseConfig(), () => {});

    const scores = await api.getScores();

    expect(scores).toEqual([]);
  });

  it("returns [] when no game is configured", async () => {
    const api = createClient({ game: null, api: "https://api.example" }, () => {});

    const scores = await api.getScores();

    expect(scores).toEqual([]);
  });
});

describe("createClient handle + event chaining", () => {
  it("on/off are chainable and return the api", () => {
    const api = createClient(baseConfig(), () => {});
    const cb = () => {};

    expect(api.on("scores", cb)).toBe(api);
    expect(api.off("scores", cb)).toBe(api);
  });

  it("setHandle sanitises and getHandle reads it back", () => {
    const api = createClient(baseConfig(), () => {});

    expect(api.setHandle("Wild#Cat!!")).toBe("WildCat");
    expect(api.getHandle()).toBe("WildCat");
  });
});
