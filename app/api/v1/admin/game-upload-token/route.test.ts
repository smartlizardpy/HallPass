/**
 * The game-source upload token is the only authorisation a direct-to-Blob PUT
 * gets, so these pin who gets one and what it allows: an admin, for a temporary
 * path under a catalogue game, with that kind's type and size cap — and nobody
 * else, nowhere else, and not while `game_source` is switched off.
 *
 * `handleUpload` is replaced by a stand-in that runs `onBeforeGenerateToken` and
 * echoes the options it returned as the "token", so the assertions read the
 * exact constraints the real helper would sign.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "admin" as string | undefined,
  blobOpOn: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({
  auth: async () => (h.role ? { user: { role: h.role } } : null),
}));
vi.mock("@/app/lib/blob-ops", () => ({
  isBlobOpEnabled: async (id: string) => {
    expect(id).toBe("game_source");
    return h.blobOpOn;
  },
}));
vi.mock("@/app/lib/games", () => ({ games: [{ slug: "neon-snake" }] }));
vi.mock("@vercel/blob/client", () => ({
  handleUpload: async ({
    body,
    onBeforeGenerateToken,
  }: {
    body: { payload: { pathname: string } };
    onBeforeGenerateToken: (p: string, c: null, m: boolean) => Promise<unknown>;
  }) => {
    const options = await onBeforeGenerateToken(body.payload.pathname, null, false);
    return { type: "blob.generate-client-token", clientToken: JSON.stringify(options) };
  },
}));

import { POST } from "./route";

const ask = (pathname: string) =>
  POST(
    new Request("http://x/api/v1/admin/game-upload-token", {
      method: "POST",
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { pathname, clientPayload: null, multipart: false },
      }),
    }),
  );

const tokenOptions = async (res: Response) =>
  JSON.parse(((await res.json()) as { clientToken: string }).clientToken);

beforeEach(() => {
  h.role = "admin";
  h.blobOpOn = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("game upload token", () => {
  it("gives an admin a zip token capped at 50 MB", async () => {
    const res = await ask("game-uploads/neon-snake/lq3x9a-abcdefgh.zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await tokenOptions(res)).toMatchObject({
      allowedContentTypes: ["application/zip"],
      maximumSizeInBytes: 50 * 1024 * 1024,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  });

  it("gives an HTML token capped at 10 MB", async () => {
    const res = await ask("game-uploads/neon-snake/lq3x9a-abcdefgh.html");
    expect(res.status).toBe(200);
    expect(await tokenOptions(res)).toMatchObject({
      allowedContentTypes: ["text/html"],
      maximumSizeInBytes: 10 * 1024 * 1024,
    });
  });

  it("also serves a super admin", async () => {
    h.role = "super_admin";
    expect((await ask("game-uploads/neon-snake/lq3x9a-abcdefgh.zip")).status).toBe(200);
  });

  it.each([
    ["signed out", undefined],
    ["a beta admin", "beta_admin"],
  ])("refuses %s", async (_label, role) => {
    h.role = role;
    expect((await ask("game-uploads/neon-snake/lq3x9a-abcdefgh.zip")).status).toBe(400);
  });

  it.each([
    ["a live game file", "games/neon-snake/index.html"],
    ["a game not in the catalogue", "game-uploads/not-a-game/lq3x9a-abcdefgh.zip"],
    ["a path that does not parse", "game-uploads/neon-snake/../x.zip"],
  ])("refuses %s", async (_label, pathname) => {
    expect((await ask(pathname)).status).toBe(400);
  });

  it("refuses while game source publishing is switched off", async () => {
    h.blobOpOn = false;
    expect((await ask("game-uploads/neon-snake/lq3x9a-abcdefgh.zip")).status).toBe(400);
  });

  it("answers a malformed body with a 400", async () => {
    const res = await POST(new Request("http://x/", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });
});
