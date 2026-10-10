// @vitest-environment jsdom
/**
 * `HallPass.invite()` and `HallPass.getLaunch()`.
 *
 * What a bug here would make silent: an invite promise that never settles (the
 * game's `await` hangs), one settled by somebody else's picker (no nonce check),
 * a `postMessage` listener that believes any frame, and a launch read twice or
 * by the wrong game (a reload rejoining a room it left).
 *
 * Storage is an in-memory `Storage` installed on `window`, as `client.test.ts`
 * does for `localStorage`: this repo's jsdom-under-Node storage is not reliable,
 * and these tests must not depend on which one a given Node ships.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client";
import type { ResolvedConfig } from "./config";
import {
  INVITE_SIGNAL_KEY,
  invitePickerUrl,
  makeNonce,
  serializeInviteData,
  subscribeInviteSignals,
} from "./invite";
import {
  LAUNCH_KEY_PREFIX,
  clearLaunch,
  launchKey,
  parseLaunch,
  slugFromPath,
  takeLaunch,
  writeLaunch,
} from "./launch";

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
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
}

const ORIGIN = () => window.location.origin;
const sameOrigin = (game: string | null = "last-bell"): ResolvedConfig => ({ game, api: ORIGIN() });
const crossOrigin = (game: string | null = "last-bell"): ResolvedConfig => ({ game, api: "https://hallpass.example" });

function signal(nonce: string, body: Record<string, unknown>, origin = ORIGIN()): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: INVITE_SIGNAL_KEY, n: nonce, ...body }, origin }));
}

function frameNonce(): string {
  const src = document.querySelector("iframe")?.getAttribute("src") ?? "";
  return new URL(src).searchParams.get("n") ?? "";
}

beforeEach(() => {
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true, writable: true });
  window.history.replaceState(null, "", "/games/last-bell/index.html");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("serializeInviteData", () => {
  it("accepts a small plain object", () => {
    expect(serializeInviteData({ room: "ABCD" })).toBe('{"room":"ABCD"}');
    expect(serializeInviteData({})).toBe("{}");
  });

  it("refuses anything else, and anything over 1 KB", () => {
    for (const bad of [null, undefined, "ABCD", 4, [], new Date(), { n: BigInt(1) }]) {
      expect(serializeInviteData(bad)).toBeNull();
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(serializeInviteData(cyclic)).toBeNull();
    expect(serializeInviteData({ s: "x".repeat(1016) })).not.toBeNull(); // 1024 bytes exactly
    expect(serializeInviteData({ s: "x".repeat(1017) })).toBeNull();
    expect(serializeInviteData({ s: "😀".repeat(300) })).toBeNull();
  });
});

describe("invitePickerUrl", () => {
  it("encodes every parameter", () => {
    expect(invitePickerUrl("https://h.example", { game: "last-bell", data: '{"room":"A&B"}', nonce: "abc", expiresInMinutes: 44.6 })).toBe(
      "https://h.example/embed/invite?game=last-bell&data=%7B%22room%22%3A%22A%26B%22%7D&n=abc&ttl=45",
    );
    expect(invitePickerUrl("https://h.example", { game: "g", data: "{}", nonce: "n" })).not.toContain("ttl=");
  });

  it("makes distinct nonces", () => {
    expect(makeNonce()).toMatch(/^[0-9a-z]{8,}$/);
    expect(makeNonce()).not.toBe(makeNonce());
  });
});

describe("subscribeInviteSignals", () => {
  it("delivers every signal for its nonce, from the API origin only", () => {
    const seen: unknown[] = [];
    const stop = subscribeInviteSignals(ORIGIN(), "mine", (s) => seen.push(s));
    signal("mine", { phase: "open", sent: 0, link: null });
    signal("theirs", { phase: "closed", sent: 5, link: null });
    signal("mine", { phase: "update", sent: 2, link: null }, "https://evil.example");
    signal("mine", { phase: "update", sent: 2, link: "https://h.example/i/CDFGHJKMNPQR" });
    signal("mine", { phase: "bogus", sent: 9 });
    signal("mine", { phase: "update", sent: -3, link: "javascript:alert(1)" });
    stop();
    signal("mine", { phase: "closed", sent: 7, link: null });
    expect(seen).toEqual([
      { phase: "open", sent: 0, link: null },
      { phase: "update", sent: 2, link: "https://h.example/i/CDFGHJKMNPQR" },
      { phase: "update", sent: 0, link: null },
    ]);
  });

  it("hears the storage transport too", () => {
    const seen: unknown[] = [];
    const stop = subscribeInviteSignals(ORIGIN(), "mine", (s) => seen.push(s));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: INVITE_SIGNAL_KEY,
        newValue: JSON.stringify({ type: INVITE_SIGNAL_KEY, n: "mine", phase: "closed", sent: 1, link: null }),
      }),
    );
    stop();
    expect(seen).toEqual([{ phase: "closed", sent: 1, link: null }]);
  });
});

describe("launch handoff", () => {
  const future = () => Date.now() + 10 * 60 * 1000;

  it("is written by the page and read ONCE by the game", () => {
    expect(writeLaunch("last-bell", { data: { room: "ABCD" }, from: "@ozan", expiresAt: future() })).toBe(true);
    expect(window.sessionStorage.getItem(`${LAUNCH_KEY_PREFIX}last-bell`)).not.toBeNull();
    const first = takeLaunch("last-bell");
    expect(first).toMatchObject({ kind: "invite", data: { room: "ABCD" }, from: "@ozan" });
    expect(window.sessionStorage.getItem(launchKey("last-bell"))).toBeNull();
    expect(takeLaunch("last-bell")).toBeNull();
  });

  it("belongs to one game", () => {
    writeLaunch("last-bell", { data: { room: "ABCD" }, from: null, expiresAt: future() });
    expect(takeLaunch("another-game")).toBeNull();
    expect(takeLaunch(null)).toBeNull();
    clearLaunch("last-bell");
    expect(takeLaunch("last-bell")).toBeNull();
  });

  it("ignores expired and malformed entries, and removes them", () => {
    writeLaunch("last-bell", { data: { room: "ABCD" }, from: null, expiresAt: Date.now() - 1 });
    expect(takeLaunch("last-bell")).toBeNull();
    expect(window.sessionStorage.getItem(launchKey("last-bell"))).toBeNull();

    for (const raw of ["{nope", "null", "[]", '{"v":2,"kind":"invite","data":{},"expiresAt":9e15}', '{"v":1,"kind":"invite","data":[],"expiresAt":9e15}', '{"v":1,"kind":"invite","data":{}}']) {
      window.sessionStorage.setItem(launchKey("last-bell"), raw);
      expect(takeLaunch("last-bell"), raw).toBeNull();
    }
    expect(parseLaunch({ v: 1, kind: "invite", data: {}, from: 42, expiresAt: future() })?.from).toBeNull();
  });

  it("survives storage that throws", () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(writeLaunch("last-bell", { data: {}, from: null, expiresAt: future() })).toBe(false);
    expect(takeLaunch("last-bell")).toBeNull();
    expect(() => clearLaunch("last-bell")).not.toThrow();
  });

  it("finds the slug in a hosted or proxied game path", () => {
    expect(slugFromPath("/games/last-bell/index.html")).toBe("last-bell");
    expect(slugFromPath("/game-html/last-bell/")).toBe("last-bell");
    expect(slugFromPath("/game-html/last-bell")).toBe("last-bell");
    expect(slugFromPath("/game/last-bell")).toBeNull();
    expect(slugFromPath("/i/CDFGHJKMNPQR")).toBeNull();
    expect(slugFromPath("/")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

describe("getLaunch", () => {
  const future = () => Date.now() + 10 * 60 * 1000;

  it("returns the invite the page was opened with, for the whole page load", () => {
    writeLaunch("last-bell", { data: { room: "ABCD" }, from: "@ozan", expiresAt: future() });
    const client = createClient(sameOrigin("some-board-id"));
    const launch = client.getLaunch!();
    expect(launch).toMatchObject({ kind: "invite", data: { room: "ABCD" }, from: "@ozan" });
    // Read at construction and removed, so a reload (a new client) gets null…
    expect(createClient(sameOrigin()).getLaunch!()).toBeNull();
    // …while this page load keeps answering, with a fresh copy each time.
    (launch!.data as Record<string, unknown>).room = "HACK";
    expect(client.getLaunch!()?.data).toEqual({ room: "ABCD" });
  });

  it("falls back to the configured game when the path names none", () => {
    window.history.replaceState(null, "", "/play/somewhere");
    writeLaunch("last-bell", { data: { room: "WXYZ" }, from: null, expiresAt: future() });
    expect(createClient(sameOrigin("last-bell")).getLaunch!()?.data).toEqual({ room: "WXYZ" });
  });

  it("is null without an invite, for another game, and once expired", () => {
    expect(createClient(sameOrigin()).getLaunch!()).toBeNull();

    writeLaunch("other-game", { data: { room: "ABCD" }, from: null, expiresAt: future() });
    expect(createClient(sameOrigin()).getLaunch!()).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    writeLaunch("last-bell", { data: { room: "ABCD" }, from: null, expiresAt: Date.now() + 60_000 });
    const client = createClient(sameOrigin());
    expect(client.getLaunch!()).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-10T12:01:01Z"));
    expect(client.getLaunch!()).toBeNull();
  });
});

describe("invite", () => {
  it("opens the inline picker on HallPass's origin and resolves with what happened when it closes", async () => {
    const client = createClient(sameOrigin("board-id"));
    const done = client.invite!({ data: { room: "ABCD" }, expiresInMinutes: 15 });

    const frame = document.querySelector("iframe");
    expect(frame?.title).toBe("Invite friends");
    const src = new URL(frame!.getAttribute("src")!);
    expect(src.pathname).toBe("/embed/invite");
    // The catalogue slug from the path, not the configured board id.
    expect(src.searchParams.get("game")).toBe("last-bell");
    expect(JSON.parse(src.searchParams.get("data")!)).toEqual({ room: "ABCD" });
    expect(src.searchParams.get("ttl")).toBe("15");

    const n = frameNonce();
    signal(n, { phase: "open", sent: 0, link: null });
    signal(n, { phase: "update", sent: 2, link: null });
    signal("someone-else", { phase: "closed", sent: 0, link: null });
    signal(n, { phase: "update", sent: 2, link: "http://localhost:3000/i/CDFGHJKMNPQR" });
    signal(n, { phase: "closed", sent: 2, link: "http://localhost:3000/i/CDFGHJKMNPQR" });

    await expect(done).resolves.toEqual({ sent: 2, link: "http://localhost:3000/i/CDFGHJKMNPQR", cancelled: false });
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("resolves cancelled when the player closes it having done nothing", async () => {
    const client = createClient(sameOrigin());
    const done = client.invite!({ data: {} });
    const n = frameNonce();
    signal(n, { phase: "open", sent: 0, link: null });
    signal(n, { phase: "closed", sent: 0, link: null });
    await expect(done).resolves.toEqual({ sent: 0, link: null, cancelled: true });
  });

  it("takes down an inline picker that never loads", async () => {
    vi.useFakeTimers();
    const client = createClient(sameOrigin());
    const done = client.invite!({ data: { room: "ABCD" } });
    expect(document.querySelector("iframe")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(20_001);
    await expect(done).resolves.toEqual({ sent: 0, link: null, cancelled: true });
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("gives up on an abandoned picker after five minutes, keeping what it heard", async () => {
    vi.useFakeTimers();
    const client = createClient(sameOrigin());
    const done = client.invite!({ data: { room: "ABCD" } });
    const n = frameNonce();
    signal(n, { phase: "open", sent: 0, link: null });
    signal(n, { phase: "update", sent: 1, link: null });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    await expect(done).resolves.toEqual({ sent: 1, link: null, cancelled: false });
  });

  it("uses a popup for a cross-origin game and settles when the window is closed by hand", async () => {
    vi.useFakeTimers();
    const popup = { closed: false, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    window.history.replaceState(null, "", "/");
    const client = createClient(crossOrigin("last-bell"));
    const done = client.invite!({ data: { room: "ABCD" } });

    expect(document.querySelector("iframe")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name] = open.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/hallpass\.example\/embed\/invite\?game=last-bell&/);
    expect(name).toBe("hallpass-invite");
    const n = new URL(String(url)).searchParams.get("n")!;

    // A signal from the page's own origin is not the picker's.
    signal(n, { phase: "update", sent: 3, link: null });
    signal(n, { phase: "update", sent: 1, link: null }, "https://hallpass.example");
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(done).resolves.toEqual({ sent: 1, link: null, cancelled: false });
  });

  it("resolves cancelled, without opening anything, when it cannot work", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    // Popup blocked.
    window.history.replaceState(null, "", "/");
    await expect(createClient(crossOrigin()).invite!({ data: {} })).resolves.toEqual({ sent: 0, link: null, cancelled: true });

    // Bad data.
    window.history.replaceState(null, "", "/games/last-bell/index.html");
    for (const data of [null, [], "ABCD", { s: "x".repeat(2000) }]) {
      await expect(createClient(sameOrigin()).invite!({ data } as never)).resolves.toEqual({ sent: 0, link: null, cancelled: true });
    }
    await expect(createClient(sameOrigin()).invite!(undefined as never)).resolves.toEqual({ sent: 0, link: null, cancelled: true });

    // No game to invite to.
    window.history.replaceState(null, "", "/somewhere");
    await expect(createClient(sameOrigin(null)).invite!({ data: {} })).resolves.toEqual({ sent: 0, link: null, cancelled: true });

    // Offline.
    window.history.replaceState(null, "", "/games/last-bell/index.html");
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await expect(createClient(sameOrigin()).invite!({ data: {} })).resolves.toEqual({ sent: 0, link: null, cancelled: true });

    expect(document.querySelector("iframe")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1); // only the blocked-popup case tried
  });

  it("resolves cancelled when inert", async () => {
    vi.stubGlobal("fetch", undefined);
    const client = createClient(sameOrigin());
    expect(client.mode).toBe("inert");
    await expect(client.invite!({ data: {} })).resolves.toEqual({ sent: 0, link: null, cancelled: true });
    expect(document.querySelector("iframe")).toBeNull();
  });
});
