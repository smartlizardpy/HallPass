// @vitest-environment jsdom
/**
 * Client behaviour: submitScore maps every outcome to the right reason and never
 * throws; getScores returns [] on any failure; a non-finite score short-circuits
 * to bad-score without touching the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, emit } from "./client";
import type { ResolvedConfig } from "./config";

const baseConfig = (): ResolvedConfig => ({
  game: "snake",
  api: "https://api.example",
});

/**
 * A config whose API origin equals the page origin, so `sameOriginApi()` is true:
 * credentialed submits, popup sign-in, and the auth-signal subscription all engage.
 * The origin is read from the live jsdom `window` so it tracks whatever URL the
 * environment runs under.
 */
const sameOriginConfig = (): ResolvedConfig => ({
  game: "snake",
  api: window.location.origin,
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

    expect(api.setHandle("Wild#Cat!!")).toBe("Wild#Cat");
    expect(api.getHandle()).toBe("Wild#Cat");
  });
});

/**
 * The same-origin auth surface. These build clients on `sameOriginConfig()`, which
 * makes `createClient` subscribe to the cross-context auth signals; we stub away
 * `BroadcastChannel` in each so no real channel outlives the test. This block is
 * defined FIRST among the same-origin suites so its lone client is the only signal
 * subscriber alive when it dispatches a storage ping.
 */
describe("createClient auth refresh + claim flush", () => {
  beforeEach(() => {
    // Never open a real BroadcastChannel (it would keep the loop alive post-test);
    // the storage transport is what this test exercises anyway.
    vi.stubGlobal("BroadcastChannel", undefined);
  });

  it("remembers a same-origin claim token and POSTs it to /api/v1/me/claim on refresh", async () => {
    const origin = window.location.origin;
    const player = { id: "p1", name: "Ada", image: null, handle: "Ada" };
    // Record every request so we can assert on the leaderboard submit and the
    // later claim POST without wrestling with the mock's call tuple typing.
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchSpy = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/api/v1/leaderboard/")) {
        return Promise.resolve(
          jsonResponse(
            { ok: true, rank: 1, handle: "ABC", score: 10, claimToken: "TESTTOKEN" },
            200,
          ),
        );
      }
      if (url.endsWith("/api/v1/me/claim")) {
        return Promise.resolve(jsonResponse({ ok: true, claimed: 1 }, 200));
      }
      if (url.endsWith("/api/v1/me")) {
        return Promise.resolve(jsonResponse({ player }, 200));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const events: Array<[string, unknown]> = [];
    const api = createClient(sameOriginConfig(), (event, payload) =>
      events.push([event, payload]),
    );

    // Anonymous same-origin submit → credentialed, and its claim token is held.
    await api.submitScore(10);
    const submit = calls.find((c) => c.url.includes("/api/v1/leaderboard/"));
    expect(submit).toBeTruthy();
    expect(submit!.init.credentials).toBe("include");

    // A sign-in completing elsewhere pings the page via the storage transport.
    window.dispatchEvent(new window.StorageEvent("storage", { key: "hallpass:auth" }));

    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/api/v1/me/claim"))).toBe(true);
    });

    const claim = calls.find((c) => c.url.endsWith("/api/v1/me/claim"))!;
    expect(claim.url).toBe(origin + "/api/v1/me/claim");
    expect(claim.init.method).toBe("POST");
    expect(claim.init.credentials).toBe("include");
    expect(JSON.parse(claim.init.body as string)).toEqual({ tokens: ["TESTTOKEN"] });

    // The refreshed identity was announced on the "auth" event.
    const auth = events.find(([event]) => event === "auth");
    expect(auth).toBeTruthy();
    expect(auth![1]).toEqual({ player });
  });
});

describe("createClient.submitScore credentials", () => {
  beforeEach(() => {
    vi.stubGlobal("BroadcastChannel", undefined);
  });

  it("sends credentials 'include' when the API origin equals the page origin", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: true, rank: 1, handle: "ABC", score: 10 }, 200),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const api = createClient(sameOriginConfig(), () => {});

    await api.submitScore(10);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(window.location.origin + "/api/v1/leaderboard/snake");
    expect(init.credentials).toBe("include");
  });

  it("sends credentials 'omit' when the API is cross-origin", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: true, rank: 1, handle: "ABC", score: 10 }, 200),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const api = createClient(baseConfig(), () => {});

    await api.submitScore(10);

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.credentials).toBe("omit");
  });
});

describe("createClient auth popup", () => {
  beforeEach(() => {
    vi.stubGlobal("BroadcastChannel", undefined);
  });

  it("opens a popup at the sign-in URL when same-origin and live", () => {
    // Fake timers keep watchPopup's poll/deadline from leaking real timers.
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn());
      const popup = { closed: false } as unknown as Window;
      const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);
      const api = createClient(sameOriginConfig(), () => {});

      api.signIn!();

      expect(openSpy).toHaveBeenCalledTimes(1);
      const [url, name] = openSpy.mock.calls[0];
      expect(url).toBe("/play/signin?callbackUrl=%2Fplay%2Fauth%2Fcomplete");
      expect(name).toBe("hallpass-auth");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("falls back to a top-level navigation when the popup is blocked", () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(window, "open").mockReturnValue(null);

    // Stub the whole top frame the code reads (`window.top`) so we can observe
    // the top-frame `location.assign` and the callbackUrl derived from the top
    // page's own relative path. vi.stubGlobal auto-restores between tests.
    const assignSpy = vi.fn();
    vi.stubGlobal("top", {
      location: { pathname: "/game/snake", search: "", hash: "", assign: assignSpy },
    });

    const api = createClient(sameOriginConfig(), () => {});

    api.signIn!();

    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy).toHaveBeenCalledWith(
      "/play/signin?callbackUrl=%2Fgame%2Fsnake",
    );
  });
});

describe("createClient sticky auth event", () => {
  it("delivers the last auth payload to a late on('auth') listener", () => {
    // Cross-origin config: no signal subscription, so this only exercises the
    // module-level sticky replay through `emit` + `on`.
    const api = createClient(baseConfig(), () => {});
    const payload = {
      player: { id: "sticky-1", name: "Ada", image: null, handle: "Ada" },
    };

    emit("auth", payload);

    const seen: unknown[] = [];
    api.on("auth", (p) => seen.push(p));

    expect(seen).toEqual([payload]);
  });
});
