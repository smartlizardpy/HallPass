import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  mode: "on" as "off" | "staff" | "on",
  pinConfigured: true,
  google: null as string | null,
  cookie: undefined as string | undefined,
  live: null as unknown,
  login: vi.fn(),
  end: vi.fn(),
  remove: vi.fn(),
  touch: vi.fn(),
  bind: vi.fn(),
  clear: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "hp_boardpass" && h.cookie ? { value: h.cookie } : undefined),
    set: h.setCookie,
  }),
}));
vi.mock("@/app/lib/boardpass/flag", () => ({ getBoardPassMode: async () => h.mode }));
vi.mock("@/app/lib/boardpass/pin", () => ({ isPinConfigured: () => h.pinConfigured }));
vi.mock("@/app/lib/social/request-guard", () => ({ currentPlayerId: async () => h.google }));
vi.mock("@/app/lib/boardpass/attempts", () => ({ ipHashFor: () => "iphash" }));
vi.mock("@/app/lib/boardpass/login", () => ({ attemptLogin: h.login }));
vi.mock("@/app/lib/boardpass/sessions", () => ({
  getLiveSession: async () => h.live,
  endSession: h.end,
  removeParticipant: h.remove,
  touchSession: h.touch,
  bindActive: h.bind,
  clearActive: h.clear,
}));
vi.mock("@/app/lib/games-store", () => ({ isResolvedSlug: async (s: string) => s === "duskfall" }));
vi.mock("@/app/lib/social", () => ({ social: { recordPlay: vi.fn() } }));
vi.mock("@/app/lib/streak", () => ({
  streaks: { recordDay: vi.fn() },
  isMissingStreakSchema: () => false,
}));
vi.mock("@/app/lib/db", () => ({ isMissingColumnError: () => false }));

import { DELETE as endSession, GET as getSession } from "./route";
import { POST as login } from "./participants/route";
import { DELETE as removeSeat } from "./participants/[id]/route";
import { POST as touch } from "./touch/route";
import { DELETE as clearActive, POST as bindActive } from "./active/route";

const ORIGIN = "https://hallpass.example";
const GOOD_TOKEN = "a".repeat(43);
const UUID = "123e4567-e89b-42d3-a456-426614174000";

function req(method: string, path: string, opts: { body?: unknown; referer?: string | null; type?: string | null } = {}) {
  const headers = new Headers();
  const referer = opts.referer === undefined ? `${ORIGIN}/board` : opts.referer;
  if (referer) headers.set("referer", referer);
  const type = opts.type === undefined ? "application/json" : opts.type;
  if (type) headers.set("content-type", type);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.mode = "on";
  h.pinConfigured = true;
  h.google = null;
  h.cookie = undefined;
  h.live = null;
  h.login.mockResolvedValue({ kind: "ok", participantId: "part", newToken: "T".repeat(43) });
  h.remove.mockResolvedValue(true);
  h.touch.mockResolvedValue({ idleExpiresAt: "i", absoluteExpiresAt: "a" });
  h.bind.mockResolvedValue({ ok: true, playerId: "p1" });
});

describe("every write is guarded the same way", () => {
  const writes: [string, () => Promise<Response>][] = [
    ["login", () => login(req("POST", "/x", { body: { username: "a", pin: "1" } }))],
    ["end", () => endSession(req("DELETE", "/x"))],
    ["touch", () => touch(req("POST", "/x", { body: {} }))],
    ["bind", () => bindActive(req("POST", "/x", { body: {} }))],
    ["unbind", () => clearActive(req("DELETE", "/x"))],
    ["remove", () => removeSeat(req("DELETE", "/x"), { params: Promise.resolve({ id: UUID }) })],
  ];

  it.each(writes)("%s: 404 when BoardPass is off", async (_n, call) => {
    h.mode = "off";
    expect((await call()).status).toBe(404);
  });

  it.each(writes)("%s: 503 when the pepper is missing", async (_n, call) => {
    h.pinConfigured = false;
    expect((await call()).status).toBe(503);
  });
});

describe("origin and content type", () => {
  const body = { username: "ozan", pin: "739105" };
  it("refuses a call from inside a game frame", async () => {
    const res = await login(req("POST", "/x", { body, referer: `${ORIGIN}/game-html/duskfall/` }));
    expect(res.status).toBe(403);
    expect(h.login).not.toHaveBeenCalled();
  });
  it("refuses no referrer and a foreign referrer", async () => {
    expect((await login(req("POST", "/x", { body, referer: null }))).status).toBe(403);
    expect((await login(req("POST", "/x", { body, referer: "https://evil.example/board" }))).status).toBe(403);
  });
  it("refuses a non-JSON content type (what a cross-site form sends)", async () => {
    const res = await login(req("POST", "/x", { body, type: "application/x-www-form-urlencoded" }));
    expect(res.status).toBe(415);
    expect(h.login).not.toHaveBeenCalled();
  });
  it("every response is private, no-store", async () => {
    const res = await login(req("POST", "/x", { body }));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("POST participants (login)", () => {
  it("sets the HttpOnly cookie for a new session and never echoes the token", async () => {
    const res = await login(req("POST", "/x", { body: { username: "ozan", pin: "739105" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, participantId: "part" });
    expect(h.setCookie).toHaveBeenCalledWith(
      "hp_boardpass",
      "T".repeat(43),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
  it("sets no cookie when joining an existing session", async () => {
    h.login.mockResolvedValue({ kind: "ok", participantId: "part", newToken: null });
    await login(req("POST", "/x", { body: { username: "ozan", pin: "739105" } }));
    expect(h.setCookie).not.toHaveBeenCalled();
  });
  it("refuses while a Google session exists in this browser", async () => {
    h.google = "google-player";
    const res = await login(req("POST", "/x", { body: { username: "ozan", pin: "739105" } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "google-session" });
    expect(h.login).not.toHaveBeenCalled();
  });
  it.each([
    [{ kind: "invalid" }, 401, "invalid"],
    [{ kind: "throttled" }, 429, "throttled"],
    [{ kind: "duplicate" }, 409, "duplicate"],
    [{ kind: "full" }, 409, "full"],
  ])("maps %j to %i", async (outcome, status, error) => {
    h.login.mockResolvedValue(outcome);
    const res = await login(req("POST", "/x", { body: { username: "a", pin: "1" } }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error });
    expect(h.setCookie).not.toHaveBeenCalled();
  });
  it("a malformed body is the generic 401", async () => {
    const r = new Request(`${ORIGIN}/x`, {
      method: "POST",
      headers: { referer: `${ORIGIN}/board`, "content-type": "application/json" },
      body: "{not json",
    });
    expect((await login(r)).status).toBe(401);
  });
});

describe("GET session", () => {
  it("is 200 unavailable when off, without revealing anything", async () => {
    h.mode = "off";
    const res = await getSession();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "unavailable" });
  });
  it("reports a Google session instead of mixing", async () => {
    h.google = "g";
    expect(await (await getSession()).json()).toEqual({ state: "google-session" });
  });
  it("none with no cookie; active with roster when live", async () => {
    expect(await (await getSession()).json()).toEqual({ state: "none" });
    h.cookie = GOOD_TOKEN;
    h.live = { id: "s", participants: [] };
    expect(await (await getSession()).json()).toMatchObject({ state: "active" });
  });
  it("an expired cookie is reported and cleared", async () => {
    h.cookie = GOOD_TOKEN;
    const res = await getSession();
    expect(await res.json()).toEqual({ state: "none", expired: true });
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("End Session, remove, touch", () => {
  it("ends the session and clears the cookie, even with no live session", async () => {
    h.cookie = GOOD_TOKEN;
    expect((await endSession(req("DELETE", "/x"))).status).toBe(200);
    expect(h.end).toHaveBeenCalled();
    expect(h.setCookie).toHaveBeenCalledWith("hp_boardpass", "", expect.objectContaining({ maxAge: 0 }));
  });
  it("remove: 404 for a bad id or no cookie, 200 when removed", async () => {
    h.cookie = GOOD_TOKEN;
    expect((await removeSeat(req("DELETE", "/x"), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    expect((await removeSeat(req("DELETE", "/x"), { params: Promise.resolve({ id: UUID }) })).status).toBe(200);
    h.remove.mockResolvedValue(false);
    expect((await removeSeat(req("DELETE", "/x"), { params: Promise.resolve({ id: UUID }) })).status).toBe(404);
    h.cookie = undefined;
    expect((await removeSeat(req("DELETE", "/x"), { params: Promise.resolve({ id: UUID }) })).status).toBe(404);
  });
  it("touch: 401 once the session is gone", async () => {
    h.cookie = GOOD_TOKEN;
    expect((await touch(req("POST", "/x", { body: {} }))).status).toBe(200);
    h.touch.mockResolvedValue(null);
    expect((await touch(req("POST", "/x", { body: {} }))).status).toBe(401);
  });
});

describe("POST active (who's playing)", () => {
  const ok = { participantId: UUID, slug: "duskfall", day: "2026-10-27", tzOffsetMin: 60 };
  beforeEach(() => {
    h.cookie = GOOD_TOKEN;
  });
  it("binds the chosen player to the game", async () => {
    expect((await bindActive(req("POST", "/x", { body: ok }))).status).toBe(200);
    expect(h.bind).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: UUID, slug: "duskfall" }),
    );
  });
  it("401 with no live cookie, 400 on a bad body, 404 on an unknown game", async () => {
    h.cookie = undefined;
    expect((await bindActive(req("POST", "/x", { body: ok }))).status).toBe(401);
    h.cookie = GOOD_TOKEN;
    expect((await bindActive(req("POST", "/x", { body: { ...ok, participantId: "x" } }))).status).toBe(400);
    expect((await bindActive(req("POST", "/x", { body: { ...ok, slug: "no-such-game" } }))).status).toBe(404);
  });
  it("409 when somebody else is already playing", async () => {
    h.bind.mockResolvedValue({ ok: false, reason: "busy" });
    expect((await bindActive(req("POST", "/x", { body: ok }))).status).toBe(409);
  });
  it("404 when the seat is gone", async () => {
    h.bind.mockResolvedValue({ ok: false, reason: "gone" });
    expect((await bindActive(req("POST", "/x", { body: ok }))).status).toBe(404);
  });
  it("a bad streak day never fails the launch", async () => {
    expect((await bindActive(req("POST", "/x", { body: { ...ok, day: "nonsense" } }))).status).toBe(200);
  });
  it("unbinding clears the active game", async () => {
    expect((await clearActive(req("DELETE", "/x"))).status).toBe(200);
    expect(h.clear).toHaveBeenCalled();
  });
});
