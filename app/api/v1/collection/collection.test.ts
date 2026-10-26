/**
 * The collection routes: same-origin and credentialed (401 signed out, 403
 * cross-site, `private, no-store`), the idempotent open, ownership-checked prefs,
 * and the one public route, the showcase.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  openPack: vi.fn(),
  setPrefs: vi.fn(),
  markSeen: vi.fn(),
  getMyCollection: vi.fn(),
  getShowcase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/app/lib/collectibles", () => ({
  collectiblesStore: { openPack: h.openPack, setPrefs: h.setPrefs, markSeen: h.markSeen },
  getMyCollection: h.getMyCollection,
  getShowcase: h.getShowcase,
}));

import { GET as COLLECTION } from "@/app/api/v1/collection/route";
import { POST as OPEN } from "@/app/api/v1/collection/packs/[id]/open/route";
import { POST as PREFS } from "@/app/api/v1/collection/prefs/route";
import { GET as SHOWCASE } from "@/app/api/v1/collection/showcase/[username]/route";

const PACK = "11111111-1111-1111-1111-111111111111";
const open = (id: string, origin?: string) =>
  OPEN(
    new Request(`https://hallpass.games/api/v1/collection/packs/${id}/open`, { method: "POST", headers: origin ? { origin } : {} }),
    { params: Promise.resolve({ id }) },
  );
const prefs = (body: unknown, origin?: string) =>
  PREFS(
    new Request("https://hallpass.games/api/v1/collection/prefs", {
      method: "POST",
      headers: origin ? { origin } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const showcase = (username: string) =>
  SHOWCASE(new Request(`https://hallpass.games/api/v1/collection/showcase/${username}`), { params: Promise.resolve({ username }) });

const signedIn = () => h.auth.mockResolvedValue({ user: { playerId: "p1" } });
const pack = { publicId: PACK, packId: "ff26-participation", packVersion: 1, openedAt: "2026-10-29T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(null);
});

describe("GET /collection", () => {
  it("is 401 and uncached when signed out", async () => {
    const res = await COLLECTION();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(h.getMyCollection).not.toHaveBeenCalled();
  });

  it("returns the player's own collection, private, with no CORS grant", async () => {
    signedIn();
    h.getMyCollection.mockResolvedValue({ available: true, sealed: [], recent: [], binder: [], progress: [] });
    const res = await COLLECTION();
    expect(res.status).toBe(200);
    expect(h.getMyCollection).toHaveBeenCalledWith("p1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST /collection/packs/<id>/open", () => {
  it("refuses a cross-site Origin before anything else", async () => {
    signedIn();
    const res = await open(PACK, "https://evil.example");
    expect(res.status).toBe(403);
    expect(h.openPack).not.toHaveBeenCalled();
  });

  it("is 401 signed out, 404 for a malformed id", async () => {
    expect((await open(PACK)).status).toBe(401);
    signedIn();
    expect((await open("not-a-uuid")).status).toBe(404);
    expect(h.openPack).not.toHaveBeenCalled();
  });

  it("opens, then reports a repeat as alreadyOpened with the same pulls", async () => {
    signedIn();
    const pulls = [
      { slot: 1, collectibleId: "ff26-survivor", wasNew: true },
      { slot: 2, collectibleId: "ff26-cobweb-bell", wasNew: true },
      { slot: 3, collectibleId: "ff26-cobweb-bell", wasNew: false },
    ];
    h.openPack.mockResolvedValueOnce({ status: "ok", alreadyOpened: false, pack, pulls });
    h.openPack.mockResolvedValueOnce({ status: "ok", alreadyOpened: true, pack, pulls });
    const first = await (await open(PACK, "https://hallpass.games")).json();
    const second = await (await open(PACK)).json();
    expect(h.openPack).toHaveBeenCalledWith({ playerId: "p1", publicId: PACK });
    expect(first.alreadyOpened).toBe(false);
    expect(second.alreadyOpened).toBe(true);
    expect(second.pulls).toEqual(first.pulls);
    expect(first.pack.id).toBe(PACK);
  });

  it("maps not-found to 404, revoked to 410, a database failure to a retryable 503", async () => {
    signedIn();
    h.openPack.mockResolvedValueOnce({ status: "not-found" });
    expect((await open(PACK)).status).toBe(404);
    h.openPack.mockResolvedValueOnce({ status: "revoked" });
    const gone = await open(PACK);
    expect(gone.status).toBe(410);
    expect(gone.headers.get("cache-control")).toBe("private, no-store");
    h.openPack.mockRejectedValueOnce(new Error("neon down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await open(PACK);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    err.mockRestore();
  });
});

describe("POST /collection/prefs", () => {
  it("is 403 cross-site, 401 signed out, 400 on junk", async () => {
    signedIn();
    expect((await prefs({ collectibleId: "hpo-hall-pass", favourite: true }, "https://evil.example")).status).toBe(403);
    h.auth.mockResolvedValue(null);
    expect((await prefs({ collectibleId: "hpo-hall-pass", favourite: true })).status).toBe(401);
    signedIn();
    expect((await prefs("{nope")).status).toBe(400);
    expect((await prefs({ collectibleId: "hpo-hall-pass" })).status).toBe(400);
    expect((await prefs({ collectibleId: "hpo-hall-pass", featuredPosition: 7 })).status).toBe(400);
    expect((await prefs({ collectibleId: "hpo-hall-pass", favourite: "yes" })).status).toBe(400);
    expect((await prefs({ collectibleId: "made-up", favourite: true })).status).toBe(404);
    expect(h.setPrefs).not.toHaveBeenCalled();
  });

  it("sets a favourite and a featured slot for the signed-in player", async () => {
    signedIn();
    h.setPrefs.mockResolvedValue({ favourite: true, featuredPosition: 2 });
    const res = await prefs({ collectibleId: "hpo-hall-pass", favourite: true, featuredPosition: 2 });
    expect(res.status).toBe(200);
    expect(h.setPrefs).toHaveBeenCalledWith({ playerId: "p1", collectibleId: "hpo-hall-pass", favourite: true, featuredPosition: 2 });
    expect(await res.json()).toMatchObject({ ok: true, favourite: true, featuredPosition: 2 });
  });

  it("allows unfeaturing with null and is 404 for a card the player does not own", async () => {
    signedIn();
    h.setPrefs.mockResolvedValueOnce({ favourite: false, featuredPosition: null });
    expect((await prefs({ collectibleId: "hpo-hall-pass", featuredPosition: null })).status).toBe(200);
    h.setPrefs.mockResolvedValueOnce(null);
    expect((await prefs({ collectibleId: "hpo-hall-pass", favourite: true })).status).toBe(404);
  });

  it("marks cards seen", async () => {
    signedIn();
    h.markSeen.mockResolvedValue(2);
    const res = await prefs({ seen: ["hpo-hall-pass", "hpo-reactor"] });
    expect(await res.json()).toEqual({ ok: true, marked: 2 });
    expect(h.markSeen).toHaveBeenCalledWith("p1", ["hpo-hall-pass", "hpo-reactor"]);
    expect((await prefs({ seen: "all" })).status).toBe(400);
  });
});

describe("GET /collection/showcase/<username>", () => {
  it("is public and CDN-cacheable, with the public name only", async () => {
    h.getShowcase.mockResolvedValue({
      available: true,
      player: { publicId: PACK, name: "Ally", avatar: "/avatars/x.png" },
      featured: [{ position: 1, collectibleId: "hpo-hall-pass", name: "Hall Pass", rarity: "legendary", art: "/collectibles/hpo/hpo-hall-pass.png" }],
    });
    const res = await showcase("Alice");
    expect(res.status).toBe(200);
    expect(h.getShowcase).toHaveBeenCalledWith("alice");
    expect(res.headers.get("cache-control")).toMatch(/public, s-maxage=/);
    expect(h.auth).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.player.name).toBe("Ally");
    expect(body.featured).toHaveLength(1);
  });

  it("is a plain 404 for a private profile or an unknown player, and never asks the database for a bad name", async () => {
    h.getShowcase.mockResolvedValue({ available: true, player: null, featured: [] });
    expect((await showcase("bob")).status).toBe(404);
    expect((await showcase("../etc")).status).toBe(404);
    expect(h.getShowcase).toHaveBeenCalledTimes(1);
  });

  it("is an uncached 503 when collectibles are unavailable", async () => {
    h.getShowcase.mockResolvedValue({ available: false, player: null, featured: [] });
    const res = await showcase("alice");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
