/**
 * The friend-list GETs refuse a game frame.
 *
 * Games run on our origin in an un-sandboxed iframe, so before this gate a game
 * could `fetch("/api/v1/me/friends")` with the player's cookie and read every
 * friend's name and avatar. Writes were already origin-checked; these reads now
 * are too, with the real `isTrustedOrigin` (only `auth()` and the stores are
 * mocked). `/count` stays open — it carries no identities, and the header
 * reads it on every page.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  playerId: vi.fn(),
  social: {
    listFriends: vi.fn(),
    listIncomingRequests: vi.fn(),
    listOutgoingRequests: vi.fn(),
    friendsPlaying: vi.fn(),
    searchPlayers: vi.fn(),
    counts: vi.fn(),
  },
  standings: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  isMissingColumnError: () => false,
  isUnconfiguredDbError: () => false,
}));
vi.mock("@/app/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/app/lib/social/request-guard", async () => {
  const origin = await vi.importActual<typeof import("@/app/lib/social/origin")>("@/app/lib/social/origin");
  return {
    NO_STORE: { "Cache-Control": "private, no-store" },
    currentPlayerId: h.playerId,
    isTrustedOrigin: origin.isTrustedOrigin,
    forbidden: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
    unauthorized: () => Response.json({ ok: false, error: "signed-out" }, { status: 401 }),
    credentialedOptions: () => new Response(null, { status: 204 }),
  };
});
vi.mock("@/app/lib/social", () => ({ social: h.social }));
vi.mock("@/app/lib/scoreboard", () => ({ store: { getFriendStandingsForGame: h.standings } }));
vi.mock("@/app/lib/games-store", () => ({ isStagedOrUnverifiable: async () => false }));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: async () => false }));
vi.mock("@/app/lib/notifications/deliver", () => ({ notifyPlayer: vi.fn() }));
vi.mock("@/app/lib/notifications/actor", () => ({ publicNameFor: vi.fn() }));

import { GET as friendsGET } from "@/app/api/v1/me/friends/route";
import { GET as activityGET } from "@/app/api/v1/me/friends/activity/route";
import { GET as scoresGET } from "@/app/api/v1/me/friends/scores/route";
import { GET as searchGET } from "@/app/api/v1/me/friends/search/route";
import { GET as countGET } from "@/app/api/v1/me/friends/count/route";

const ORIGIN = "http://localhost";

function get(path: string, referer: string | null): Request {
  const headers = new Headers();
  if (referer !== null) headers.set("referer", referer);
  return new Request(`${ORIGIN}${path}`, { headers });
}

const GATED: [string, (req: Request) => Promise<Response>, string][] = [
  ["/api/v1/me/friends", friendsGET, "/api/v1/me/friends"],
  ["/api/v1/me/friends/activity", activityGET, "/api/v1/me/friends/activity?slugs=last-bell"],
  ["/api/v1/me/friends/scores", scoresGET, "/api/v1/me/friends/scores?slug=last-bell"],
  ["/api/v1/me/friends/search", searchGET, "/api/v1/me/friends/search?q=ada"],
];

/** Referrers a game frame can send — including none at all. */
const GAME_REFERERS = [
  `${ORIGIN}/games/last-bell/index.html`,
  `${ORIGIN}/game-html/last-bell/`,
  null,
  "https://evil.example/play/you/friends",
];

/** Every first-party page that calls one of these today, plus the invite picker. */
const APP_REFERERS = [
  `${ORIGIN}/play/you/friends`,
  `${ORIGIN}/play/you`,
  `${ORIGIN}/game/last-bell`,
  `${ORIGIN}/embed/invite?game=last-bell`,
  `${ORIGIN}/`,
];

beforeEach(() => {
  vi.clearAllMocks();
  h.playerId.mockResolvedValue("google-me");
  for (const fn of Object.values(h.social)) fn.mockResolvedValue([]);
  h.social.counts.mockResolvedValue({ friends: 2, incoming: 1, hasUsername: true });
  h.standings.mockResolvedValue([]);
});

describe.each(GATED)("GET %s", (_name, handler, path) => {
  it("refuses a game frame, a missing referrer and another site", async () => {
    for (const referer of GAME_REFERERS) {
      const res = await handler(get(path, referer));
      expect(res.status, String(referer)).toBe(403);
    }
    for (const fn of Object.values(h.social)) expect(fn).not.toHaveBeenCalled();
    expect(h.standings).not.toHaveBeenCalled();
  });

  it("answers every first-party page that calls it", async () => {
    for (const referer of APP_REFERERS) {
      const res = await handler(get(path, referer));
      expect(res.status, referer).toBe(200);
    }
  });

  it("leaves the signed-out answer unchanged", async () => {
    h.playerId.mockResolvedValue(null);
    const fromGame = await handler(get(path, `${ORIGIN}/games/last-bell/index.html`));
    const fromApp = await handler(get(path, `${ORIGIN}/play/you`));
    expect(fromGame.status).toBe(fromApp.status);
    expect(await fromGame.text()).toBe(await fromApp.text());
  });
});

describe("GET /api/v1/me/friends/count", () => {
  it("stays open: three numbers, read by the header on every page", async () => {
    const res = await countGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, friends: 2, incoming: 1, hasUsername: true });
  });
});
