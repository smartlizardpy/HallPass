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

describe("createClient.getPlayer", () => {
  it("resolves the public identity on a 200 and caches it (one fetch)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          {
            player: {
              id: "g-1",
              name: "Zoe K",
              image: "https://img/x.png",
              handle: "ZK",
              email: "leak@example.com",
            },
          },
          200,
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const api = createClient(baseConfig(), () => {});

    const player = await api.getPlayer!();

    // Re-projected to exactly the four public fields — email never flows through.
    expect(player).toEqual({
      id: "g-1",
      name: "Zoe K",
      image: "https://img/x.png",
      handle: "ZK",
    });

    // Same-origin credentialed GET to /api/v1/me.
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.example/api/v1/me");
    expect(init.credentials).toBe("include");

    // Cached: a second call does not hit the network again.
    expect(await api.getPlayer!()).toEqual(player);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves null when the server reports no session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ player: null }, 200)),
    );
    const api = createClient(baseConfig(), () => {});

    expect(await api.getPlayer!()).toBeNull();
  });

  it("resolves null on a rejected fetch and never throws (no caching)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchSpy);
    const api = createClient(baseConfig(), () => {});

    expect(await api.getPlayer!()).toBeNull();
    // A failure is not cached, so a retry refetches.
    expect(await api.getPlayer!()).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("createClient.setPlayerHandle", () => {
  it("posts the handle and resolves the updated identity", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { player: { id: "g-1", name: "Zoe K", image: null, handle: "NEW" } },
          200,
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const api = createClient(baseConfig(), () => {});

    const player = await api.setPlayerHandle!("NEW");

    expect(player).toEqual({
      id: "g-1",
      name: "Zoe K",
      image: null,
      handle: "NEW",
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.example/api/v1/me/handle");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ handle: "NEW" });
  });

  it("refreshes the getPlayer cache with the new identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { player: { id: "g-1", name: "Zoe K", image: null, handle: "NEW" } },
            200,
          ),
        ),
    );
    const api = createClient(baseConfig(), () => {});
    await api.setPlayerHandle!("NEW");

    // getPlayer now serves the refreshed identity from cache — no network call.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const player = await api.getPlayer!();

    expect(player?.handle).toBe("NEW");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves null on a non-2xx and never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 401)),
    );
    const api = createClient(baseConfig(), () => {});

    expect(await api.setPlayerHandle!("X")).toBeNull();
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
