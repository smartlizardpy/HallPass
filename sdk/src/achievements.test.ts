// @vitest-environment jsdom
/**
 * Achievement behaviour, mirroring `client.test.ts`.
 *
 * The four things worth protecting, in order of how expensive they are to get
 * wrong:
 *   1. THE COALESCER NEVER DROPS THE FINAL VALUE. A player who finishes at
 *      100/100 and is left looking at 97/100 forever is the bug this feature
 *      lives or dies on, so it is tested on the timer path, on the out-of-order
 *      path, and on the `pagehide` beacon path.
 *   2. The `"achievement"` event fires for a NEW unlock and stays silent for an
 *      already-held one — otherwise every progress beacon re-toasts a trophy.
 *   3. Nothing throws and nothing hangs: every rejection, malformed body, absent
 *      key and inert/cross-origin short-circuit still RESOLVES its promise.
 *   4. Inert and cross-origin resolve locally, without firing a doomed request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAchievements, type AchievementDeps } from "./achievements";
import { createClient } from "./client";
import type { UnlockEntryResult } from "./contract";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A server result row. `name` is populated by default because the route is
 * expected to enrich results from the catalogue — a test that wants the
 * unenriched path passes `{ name: undefined }` and gets the SDK's catalogue
 * lookup, which is an extra request and therefore worth being explicit about.
 */
function entry(key: string, over: Partial<UnlockEntryResult> = {}): UnlockEntryResult {
  return {
    key,
    unlocked: true,
    alreadyUnlocked: false,
    progress: 1,
    target: 1,
    name: "Ach " + key,
    ...over,
  };
}

/**
 * Build an achievements API plus the events it emitted. Defaults are the happy
 * path — live, same-origin, a configured game — so each test overrides only the
 * one dimension it is about.
 */
function make(over: Partial<AchievementDeps> = {}): {
  api: ReturnType<typeof createAchievements>;
  events: Array<[string, unknown]>;
} {
  const events: Array<[string, unknown]> = [];
  const api = createAchievements({
    cfg: { game: "snake", api: window.location.origin },
    mode: "live",
    sameOrigin: () => true,
    emit: (event, payload) => events.push([event, payload]),
    ...over,
  });
  return { api, events };
}

/** The parsed JSON body of the nth fetch call. */
function bodyOf(spy: ReturnType<typeof vi.fn>, index = 0): unknown {
  return JSON.parse(spy.mock.calls[index][1].body as string);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("progress coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("merges a burst of calls for one key into a single request", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { ok: true, results: [entry("kills", { progress: 100, target: 100 })] },
          200,
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    const calls = [api.progress("kills", 12), api.progress("kills", 57), api.progress("kills", 100)];

    // Nothing has gone out yet — that is the whole point of the trailing edge.
    expect(fetchSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchSpy)).toEqual({ entries: [{ key: "kills", progress: 100 }] });
    expect(fetchSpy.mock.calls[0][1].credentials).toBe("include");

    const results = await Promise.all(calls);
    for (const result of results) {
      expect(result.ok).toBe(true);
      expect(result.key).toBe("kills");
      expect(result.progress).toBe(100);
    }
  });

  it("sends the MAXIMUM, so an out-of-order call cannot regress the counter", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, results: [entry("kills")] }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    void api.progress("kills", 100);
    void api.progress("kills", 97); // a late/duplicated beacon from earlier

    await vi.advanceTimersByTimeAsync(1000);

    expect(bodyOf(fetchSpy)).toEqual({ entries: [{ key: "kills", progress: 100 }] });
  });

  it("keeps separate keys in one batch but separate games in separate requests", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true, results: [] }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    void api.progress("kills", 3);
    void api.progress("waves", 2);
    void api.progress("kills", 4, { game: "other" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map((call) => call[0]);
    expect(urls).toContain(window.location.origin + "/api/v1/games/snake/achievements");
    expect(urls).toContain(window.location.origin + "/api/v1/games/other/achievements");
  });

  it("splits a batch larger than the server's cap into legal requests", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true, results: [] }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    for (let i = 0; i < 25; i++) void api.progress("key-" + i, i + 1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((bodyOf(fetchSpy, 0) as { entries: unknown[] }).entries).toHaveLength(20);
    expect((bodyOf(fetchSpy, 1) as { entries: unknown[] }).entries).toHaveLength(5);
  });

  it("{ flush: true } sends immediately instead of waiting out the window", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, results: [entry("kills")] }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    const pending = api.progress("kills", 100, { flush: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchSpy)).toEqual({ entries: [{ key: "kills", progress: 100 }] });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });
});

describe("progress flush on unload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("beacons the FINAL value on pagehide and still settles the promise", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true, results: [] }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    void api.progress("kills", 97);
    const last = api.progress("kills", 100);

    // The page goes away long before the 1s trailing edge would have fired.
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe(window.location.origin + "/api/v1/games/snake/achievements");
    expect(JSON.parse(await (blob as Blob).text())).toEqual({
      entries: [{ key: "kills", progress: 100 }],
    });

    // Settled, not abandoned: a bfcache restore revives this promise.
    await expect(last).resolves.toMatchObject({ ok: true, key: "kills", progress: 100 });
  });

  it("flushes on visibilitychange → hidden with a REAL request, not a beacon", async () => {
    // A hidden document is usually still alive — an alt-tab, a phone screen
    // lock. Beaconing there would be fire-and-forget: the response is never
    // read, so nothing can be announced, and an achievement earned in that
    // moment resolves `unlocked:false` with no "achievement" event. The player
    // returns to a live page having silently earned something.
    //
    // So this path must use the ordinary transport and read the reply. It still
    // has to survive the hide turning into a real teardown, which is what
    // `keepalive` is for. Only `pagehide` beacons.
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          {
            key: "kills",
            unlocked: true,
            alreadyUnlocked: false,
            progress: 42,
            target: 42,
            name: "Centurion",
            icon: "💀",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { api, events } = make();

    const pending = api.progress("kills", 42);
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const result = await pending;

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The whole point: the reply was read, so the earn is reported and announced.
    expect(result.unlocked).toBe(true);
    expect(events.filter(([name]) => name === "achievement")).toHaveLength(1);
    // And it survives the hide becoming a real unload.
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
  });

  it("falls back to a normal POST when sendBeacon is unavailable", () => {
    vi.stubGlobal("navigator", {});
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true, results: [] }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    void api.progress("kills", 100);
    window.dispatchEvent(new Event("pagehide"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchSpy)).toEqual({ entries: [{ key: "kills", progress: 100 }] });
  });
});

describe("unlock", () => {
  it("posts a bare unlock (no progress) immediately and resolves the result", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: true, results: [entry("first-blood", { name: "First Blood" })] }, 200),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    const result = await api.unlock("first-blood");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchSpy)).toEqual({ entries: [{ key: "first-blood", progress: null }] });
    expect(result).toMatchObject({
      ok: true,
      key: "first-blood",
      unlocked: true,
      alreadyUnlocked: false,
    });
    expect(result.achievement?.name).toBe("First Blood");
  });

  it("is idempotent: an already-held achievement is ok, not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { ok: true, results: [entry("first-blood", { unlocked: false, alreadyUnlocked: true })] },
          200,
        ),
      ),
    );
    const { api, events } = make();

    const result = await api.unlock("first-blood");

    expect(result.ok).toBe(true);
    expect(result.unlocked).toBe(false);
    expect(result.alreadyUnlocked).toBe(true);
    expect(events.filter(([name]) => name === "achievement")).toHaveLength(0);
  });

  it("reports unknown-achievement for a key the server did not resolve", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ok: true, reason: "unknown-achievement", results: [] }, 200),
        ),
    );
    const { api } = make();

    await expect(api.unlock("not-provisioned")).resolves.toEqual({
      ok: false,
      key: "not-provisioned",
      unlocked: false,
      reason: "unknown-achievement",
    });
  });

  it("rejects a malformed key locally, without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    await expect(api.unlock("NOT A KEY")).resolves.toMatchObject({
      ok: false,
      reason: "bad-request",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves no-game when no slug is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make({ cfg: { game: null, api: window.location.origin } });

    await expect(api.unlock("first-blood")).resolves.toMatchObject({
      ok: false,
      reason: "no-game",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("unlockMany", () => {
  it("sends one request and answers in the order the keys were given", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: true,
          // Deliberately out of order: the SDK must zip by KEY, not by position.
          results: [entry("b"), entry("a", { unlocked: false, alreadyUnlocked: true })],
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    const results = await api.unlockMany(["a", "b"]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchSpy)).toEqual({
      entries: [
        { key: "a", progress: null },
        { key: "b", progress: null },
      ],
    });
    expect(results.map((r) => r.key)).toEqual(["a", "b"]);
    expect(results[0].unlocked).toBe(false);
    expect(results[1].unlocked).toBe(true);
  });

  it("keeps a locally-rejected key in place so results zip against the input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, results: [entry("good")] }, 200)),
    );
    const { api } = make();

    const results = await api.unlockMany(["BAD KEY", "good"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: false, reason: "bad-request" });
    expect(results[1]).toMatchObject({ ok: true, key: "good" });
  });

  it("resolves [] for an empty list without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    await expect(api.unlockMany([])).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the achievement event", () => {
  it("fires only for NEWLY earned achievements", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            ok: true,
            results: [
              entry("fresh", { name: "Fresh", icon: "🩸", points: 10 }),
              entry("old", { unlocked: false, alreadyUnlocked: true, name: "Old" }),
            ],
          },
          200,
        ),
      ),
    );
    const { api, events } = make();

    await api.unlockMany(["fresh", "old"]);

    const fired = events.filter(([name]) => name === "achievement");
    expect(fired).toHaveLength(1);
    expect(fired[0][1]).toMatchObject({ key: "fresh", name: "Fresh", icon: "🩸", points: 10 });
  });

  it("never fires twice for the same achievement across repeated calls", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const result = first
          ? entry("first-blood", { name: "First Blood" })
          : entry("first-blood", { unlocked: false, alreadyUnlocked: true, name: "First Blood" });
        first = false;
        return Promise.resolve(jsonResponse({ ok: true, results: [result] }, 200));
      }),
    );
    const { api, events } = make();

    await api.unlock("first-blood");
    await api.unlock("first-blood");

    expect(events.filter(([name]) => name === "achievement")).toHaveLength(1);
  });

  it("fills name/icon from the catalogue when the server does not enrich", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "POST") {
        return Promise.resolve(
          jsonResponse({ ok: true, results: [entry("boss", { name: undefined })] }, 200),
        );
      }
      return Promise.resolve(
        jsonResponse(
          {
            game: "snake",
            achievements: [
              {
                key: "boss",
                name: "Boss Slayer",
                description: "Beat the boss",
                icon: "👑",
                points: 50,
                target: 1,
                secret: false,
                progress: 1,
                unlocked: true,
                unlockedAt: "2026-07-27T00:00:00.000Z",
              },
            ],
          },
          200,
        ),
      );
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { api, events } = make();

    const result = await api.unlock("boss");

    const fired = events.filter(([name]) => name === "achievement");
    expect(fired).toHaveLength(1);
    expect(fired[0][1]).toMatchObject({
      key: "boss",
      name: "Boss Slayer",
      icon: "👑",
      points: 50,
      game: "snake",
    });
    expect(result.achievement?.name).toBe("Boss Slayer");
  });

  it("reads the catalogue ONCE for a batch that unlocks several unnamed keys", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              ok: true,
              results: [entry("a", { name: undefined }), entry("b", { name: undefined })],
            },
            200,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ game: "snake", achievements: [] }, 200));
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { api, events } = make();

    await api.unlockMany(["a", "b"]);

    // One POST + one catalogue GET — never one lookup per unlocked key.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(events.filter(([name]) => name === "achievement")).toHaveLength(2);
  });

  it("falls back to the key and a default icon when nothing can name it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (init.method === "POST") {
          return Promise.resolve(
            jsonResponse({ ok: true, results: [entry("mystery", { name: undefined })] }, 200),
          );
        }
        return Promise.reject(new Error("catalogue down"));
      }),
    );
    const { api, events } = make();

    await api.unlock("mystery");

    const fired = events.filter(([name]) => name === "achievement");
    expect(fired).toHaveLength(1);
    // An ugly toast is a bug report; an "undefined" toast is a broken game.
    expect(fired[0][1]).toMatchObject({ key: "mystery", name: "mystery", icon: "🏅" });
  });
});

describe("inert and cross-origin short-circuits", () => {
  it("inert resolves the inert reason and never touches the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make({ mode: "inert" });

    await expect(api.unlock("x")).resolves.toEqual({
      ok: false,
      key: "x",
      unlocked: false,
      reason: "inert",
    });
    await expect(api.progress("x", 5)).resolves.toMatchObject({ reason: "inert" });
    await expect(api.unlockMany(["x"])).resolves.toEqual([
      { ok: false, key: "x", unlocked: false, reason: "inert" },
    ]);
    await expect(api.getAchievements()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a cross-origin embed resolves signed-out rather than firing a doomed write", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make({ sameOrigin: () => false });

    await expect(api.unlock("x")).resolves.toMatchObject({ reason: "signed-out" });
    await expect(api.progress("x", 1)).resolves.toMatchObject({ reason: "signed-out" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still READS the catalogue cross-origin, uncredentialed", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ game: "snake", achievements: [] }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make({ sameOrigin: () => false });

    await api.getAchievements();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1].credentials).toBe("omit");
  });
});

describe("failure mapping — everything resolves, nothing throws", () => {
  it("maps a rejected fetch to the network reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const { api } = make();

    await expect(api.unlock("x")).resolves.toMatchObject({ ok: false, reason: "network" });
  });

  it("maps 429 to rate-limited, 401 to signed-out, 404 to no-game, 500 to http", async () => {
    const cases: Array<[number, string]> = [
      [429, "rate-limited"],
      [401, "signed-out"],
      [404, "no-game"],
      [500, "http"],
    ];
    for (const [status, reason] of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, status)),
      );
      const { api } = make();
      await expect(api.unlock("x")).resolves.toMatchObject({ ok: false, reason });
    }
  });

  it("applies a batch-level ok:false reason to every entry in the batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ ok: false, reason: "rate-limited", results: [] }, 200)),
    );
    const { api } = make();

    const results = await api.unlockMany(["a", "b"]);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, reason: "rate-limited" });
    }
  });

  it("survives a body that is not the shape we asked for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ results: "not an array" }, 200)),
    );
    const { api, events } = make();

    await expect(api.unlock("x")).resolves.toMatchObject({
      ok: false,
      reason: "unknown-achievement",
    });
    expect(events).toHaveLength(0);
  });

  it("rejects a non-finite progress value without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = make();

    await expect(api.progress("x", Number.NaN)).resolves.toMatchObject({
      ok: false,
      reason: "bad-request",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("getAchievements resolves [] on any failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const { api } = make();

    await expect(api.getAchievements()).resolves.toEqual([]);
  });

  it("getAchievements re-projects each row to exactly the public fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            game: "snake",
            achievements: [
              {
                key: "boss",
                name: "Boss",
                description: "d",
                icon: "👑",
                points: 5,
                target: 3,
                secret: false,
                // Over-reported by a buggy/over-sharing server: clamped, and the
                // extra field must not survive the projection.
                progress: 99,
                unlocked: true,
                unlockedAt: "2026-07-27T00:00:00.000Z",
                internalId: "leak",
              },
              { nope: true },
            ],
          },
          200,
        ),
      ),
    );
    const { api } = make();

    const list = await api.getAchievements();

    expect(list).toEqual([
      {
        key: "boss",
        name: "Boss",
        description: "d",
        icon: "👑",
        points: 5,
        target: 3,
        secret: false,
        progress: 3,
        unlocked: true,
        unlockedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);
  });
});

describe("wiring into the client global", () => {
  beforeEach(() => {
    // Never open a real BroadcastChannel — it would outlive the test.
    vi.stubGlobal("BroadcastChannel", undefined);
  });

  it("exposes the four methods and routes the event through on()", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ok: true, results: [entry("wired", { name: "Wired" })] }, 200),
        ),
    );
    const api = createClient({ game: "snake", api: window.location.origin }, undefined);

    expect(typeof api.unlock).toBe("function");
    expect(typeof api.unlockMany).toBe("function");
    expect(typeof api.progress).toBe("function");
    expect(typeof api.getAchievements).toBe("function");

    const seen: unknown[] = [];
    const listener = (payload: unknown): void => {
      seen.push(payload);
    };
    api.on("achievement", listener);
    try {
      const result = await api.unlock!("wired");
      expect(result.unlocked).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ key: "wired", name: "Wired" });
    } finally {
      api.off("achievement", listener);
    }
  });

  it("is NOT sticky — a listener attached after the unlock gets nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, results: [entry("late")] }, 200)),
    );
    const api = createClient({ game: "snake", api: window.location.origin }, undefined);
    await api.unlock!("late");

    const seen: unknown[] = [];
    const listener = (payload: unknown): void => {
      seen.push(payload);
    };
    api.on("achievement", listener);
    api.off("achievement", listener);

    expect(seen).toEqual([]);
  });

  it("fires at most once per key, even if the server reports the earn twice", async () => {
    // Two beacons for the same key can be in flight at once, because a flush
    // re-arms the timer immediately. Each statement decides `unlocked` from the
    // row as ITS OWN snapshot saw it, so both can legitimately answer "newly
    // earned". The stored row stays correct (COALESCE keeps the first stamp),
    // but the game would celebrate the same achievement twice. Only the client
    // knows what this page has already shown, so the at-most-once rule lives
    // there — and this test is what stops it being "simplified" away.
    // `mockImplementation`, not `mockResolvedValue`: a Response body can only be
    // read once, so reusing one object would make the SECOND call fail to parse
    // and degrade to `unknown-achievement` — a test artefact that looks exactly
    // like the bug under test.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        jsonResponse({ ok: true, results: [entry("centurion")] }, 200),
      ),
    );
    const { api, events } = make();

    const first = await api.unlock("centurion");
    const second = await api.unlock("centurion");

    expect(first.unlocked).toBe(true);
    expect(second.unlocked).toBe(true); // the server's answer is passed through unchanged
    expect(events.filter(([name]) => name === "achievement")).toHaveLength(1);
  });
});

describe("surviving the unload", () => {
  it("sends the immediate-flush path with keepalive", async () => {
    // `unlock()` drains the queue SYNCHRONOUSLY, so by the time `pagehide`
    // fires there is nothing left for the beacon path to rescue. The docs tell
    // games to unlock at game over and then navigate; without `keepalive` the
    // browser is free to cancel that POST and the earn is simply lost. Because
    // the server merges with GREATEST, a per-run counter never heals from it.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, results: [entry("finale")] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = make();

    await api.unlock("finale");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
  });
});
