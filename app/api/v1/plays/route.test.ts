import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const resolved = vi.hoisted(() => ({ ok: true }));
const recordPlay = vi.hoisted(() => vi.fn(async (slug: string) => void slug));
vi.mock("@/app/lib/games-store", () => ({ isResolvedSlug: async () => resolved.ok }));
vi.mock("@/app/lib/play-totals", () => ({ playTotals: { recordPlay } }));
vi.mock("@/app/lib/db", () => ({ isMissingColumnError: () => false }));
vi.mock("@/app/lib/social/request-guard", async () => {
  const origin = await vi.importActual<typeof import("@/app/lib/social/origin")>(
    "@/app/lib/social/origin",
  );
  return {
    NO_STORE: { "Cache-Control": "private, no-store" },
    credentialedOptions: () => new Response(null, { status: 204 }),
    forbidden: () => Response.json({ ok: false }, { status: 403 }),
    isTrustedOrigin: origin.isTrustedOrigin,
  };
});

import { POST } from "./route";

function post(body: unknown, referer: string | null = "https://hallpass.test/game/last-bell") {
  return POST(
    new Request("https://hallpass.test/api/v1/plays", {
      method: "POST",
      headers: referer ? { referer, "content-type": "application/json" } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resolved.ok = true;
  recordPlay.mockClear();
});

describe("POST /api/v1/plays", () => {
  it("counts a play for a real game, with no sign-in", async () => {
    const res = await post({ slug: "last-bell" });
    expect(await res.json()).toEqual({ ok: true, recorded: true });
    expect(recordPlay).toHaveBeenCalledWith("last-bell");
  });

  it("refuses a request that did not come from one of our pages", async () => {
    expect((await post({ slug: "last-bell" }, null)).status).toBe(403);
    expect((await post({ slug: "last-bell" }, "https://hallpass.test/game-html/x/")).status).toBe(403);
    expect(recordPlay).not.toHaveBeenCalled();
  });

  it("rejects a missing slug and unparseable bodies", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  it("cannot add a row for a slug that is not a game", async () => {
    resolved.ok = false;
    expect((await post({ slug: "made-up" })).status).toBe(404);
    expect(recordPlay).not.toHaveBeenCalled();
  });

  it("stays quiet when the database fails", async () => {
    recordPlay.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ slug: "last-bell" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false });
  });
});
