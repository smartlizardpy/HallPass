// @vitest-environment jsdom
/**
 * SDK 1.5: named boards, `meta`, run tokens, feature detection, championship
 * reasons, and the outcome signal to the hosting HallPass page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client";
import { boardId, boundMeta, supports, SIGNAL_TYPE } from "./championship";
import type { ResolvedConfig } from "./config";

const same = (): ResolvedConfig => ({ game: "last-bell", api: window.location.origin });
const cross = (): ResolvedConfig => ({ game: "last-bell", api: "https://api.example" });
const BOARD = "last-bell-halloween-shift";
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  const store = new Map<string, string>([["hallpass:handle", "ABC"]]);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("feature detection", () => {
  it("answers for the 1.5 features, the 1.7 event feature and nothing else", () => {
    expect(["leaderboard.boards", "leaderboard.meta", "runs", "event"].map(supports)).toEqual([true, true, true, true]);
    expect(supports("leaderboard.anything")).toBe(false);
    expect(supports(undefined)).toBe(false);
    const api = createClient(same(), () => {});
    expect(api.supports?.("leaderboard.boards")).toBe(true);
    expect(api.capabilities).toEqual({ leaderboard: { boards: true, meta: true }, runs: true, event: true });
  });

  it("validates board ids and bounds meta", () => {
    expect(boardId(" Last-Bell-Halloween-Shift ")).toBe(BOARD);
    expect(boardId("../me")).toBeNull();
    expect(boardId(3)).toBeNull();
    expect(boundMeta({ a: 1 })).toEqual({ a: 1 });
    expect(boundMeta([1])).toBeUndefined();
    expect(boundMeta({ x: "y".repeat(5000) })).toBeUndefined();
  });
});

describe("submitScore with a board", () => {
  it("posts to the named board with meta and reads the championship result", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      json({ ok: true, championship: "fright-fest-2026", status: "accepted", rank: 2, best: true, late: false, duplicate: false, score: 300 }, 200),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const api = createClient(same(), () => {});
    const r = await api.submitScore(300, { board: BOARD, promptHandle: false, meta: { token: "t", time: 1 } });
    expect(r).toEqual({ ok: true, rank: 2, championship: "fright-fest-2026", status: "accepted", best: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/api/v1/leaderboard/${BOARD}`);
    expect(JSON.parse(init.body)).toEqual({ score: 300, handle: "ABC", meta: { token: "t", time: 1 } });
    expect(init.credentials).toBe("include");
  });

  it("keeps the 1.4 request exactly when no board or meta is given", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(json({ ok: true, rank: 1, handle: "ABC", score: 5 }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    await createClient(same(), () => {}).submitScore(5);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/api/v1/leaderboard/last-bell`);
    expect(JSON.parse(init.body)).toEqual({ score: 5, handle: "ABC" });
  });

  it("refuses a bad board id without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await createClient(same(), () => {}).submitScore(5, { board: "../x" })).toMatchObject({ ok: false, reason: "bad-board" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps championship errors to their reasons, with detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(json({ error: "Sign in", reason: "signed-out", championship: "fright-fest-2026" }, 401))
        .mockResolvedValueOnce(json({ error: "No", reason: "rejected", detail: "faster-than-route", championship: "fright-fest-2026" }, 422))
        .mockResolvedValueOnce(json({ error: "Slow", reason: "rate-limited", championship: "fright-fest-2026" }, 429)),
    );
    const api = createClient(same(), () => {});
    expect(await api.submitScore(1, { board: BOARD })).toMatchObject({ ok: false, reason: "signed-out", championship: "fright-fest-2026" });
    expect(await api.submitScore(1, { board: BOARD })).toMatchObject({ ok: false, reason: "rejected", detail: "faster-than-route" });
    expect(await api.submitScore(1, { board: BOARD })).toMatchObject({ ok: false, reason: "rate-limited" });
  });
});

describe("runStart", () => {
  it("returns the token from a same-origin run start", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(json({ token: "tok", expiresAt: "2026-10-28T01:00:00Z", board: BOARD, championship: "fright-fest-2026" }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    const t = await createClient(same(), () => {}).runStart?.({ game: "last-bell", board: BOARD, seed: 2026118 });
    expect(t).toEqual({ token: "tok", expiresAt: "2026-10-28T01:00:00Z" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/api/v1/leaderboard/${BOARD}/runs`);
    expect(JSON.parse(init.body)).toEqual({ seed: 2026118 });
    expect(init.credentials).toBe("include");
  });

  it("is null, without a request, cross-origin; null on any refusal; never throws", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await createClient(cross(), () => {}).runStart?.({ board: BOARD })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await createClient(same(), () => {}).runStart?.({ board: BOARD })).toBeNull();
    fetchSpy.mockResolvedValue(json({ error: "Sign in", reason: "signed-out" }, 401));
    expect(await createClient(same(), () => {}).runStart?.({ board: BOARD })).toBeNull();
    expect(await createClient(same(), () => {}).runStart?.({ board: "../x" })).toBeNull();
  });
});

describe("the outcome signal to the hosting page", () => {
  function inFrame() {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    return parent;
  }

  it("tells a same-origin parent the outcome, addressed to HallPass's origin", async () => {
    const parent = inFrame();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ok: true, championship: "fright-fest-2026", status: "accepted", rank: 3, best: true, late: false, duplicate: false, score: 1 }, 200)));
    await createClient(same(), () => {}).submitScore(1, { board: BOARD });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: SIGNAL_TYPE, phase: "submit", ok: true, board: BOARD, championship: "fright-fest-2026", status: "accepted", rank: 3, best: true, late: false },
      window.location.origin,
    );
  });

  it("tells it when a run cannot count because the player is signed out", async () => {
    const parent = inFrame();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "Sign in", reason: "signed-out", championship: "fright-fest-2026" }, 401)));
    await createClient(same(), () => {}).runStart?.({ board: BOARD });
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: SIGNAL_TYPE, phase: "start", ok: false, reason: "signed-out", board: BOARD }),
      window.location.origin,
    );
  });

  it("says nothing for ordinary boards or cross-origin embeds", async () => {
    const parent = inFrame();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ok: true, rank: 1, handle: "ABC", score: 1 }, 200)));
    await createClient(same(), () => {}).submitScore(1);
    await createClient(cross(), () => {}).submitScore(1, { board: BOARD });
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
