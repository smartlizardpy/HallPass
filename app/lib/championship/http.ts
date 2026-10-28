/**
 * HallPass — HTTP handlers for championship boards.
 *
 * A championship board answers on the ordinary leaderboard URL
 * (`/api/v1/leaderboard/<board>`), so the SDK's `submitScore(score, {board})`
 * needs nothing new on the wire. The leaderboard route hands a championship
 * board to these handlers BEFORE it touches `boards` or `scores`: championship
 * runs never enter the ordinary scoreboard, and an ordinary board never reaches
 * this code.
 *
 * CREDENTIALED AND SAME-ORIGIN. Entering is for signed-in players, keyed by the
 * session cookie, so these writes follow `me/claim`: no wildcard CORS (a
 * wildcard cannot carry credentials anyway), `private, no-store`, 401 without a
 * session. A request whose `Origin` names another site is refused outright, on
 * top of the cookie's SameSite protection. Games run same-origin at
 * `/game-html/<slug>/`, so this costs a real game nothing.
 *
 * The board's GET stays public and CDN-cached: it is the same table for
 * everybody and carries public ids and public names only.
 */

import "server-only";
import { auth } from "@/app/lib/auth";
import { upsertPlayerOnLogin } from "@/app/lib/players";
import type {
  ApiError,
  ChampionshipError,
  ChampionshipReason,
  ChampionshipSubmitResponse,
  LeaderboardResponse,
  RunStartResponse,
  ScoreEntry,
} from "@/sdk/src/contract";
import type { ChampionshipBoardEntry } from "./config";
import { championshipStore, getPublicChampionship } from "./index";
import { issueRun, submitRun, type IssueOutcome, type SubmitOutcome } from "./intake";
import { attributeFromRequest, qualifyAfterRun } from "@/app/lib/referrals";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const PUBLIC_CACHE = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
} as const;

function json(body: unknown, status: number, headers: Record<string, string> = NO_STORE): Response {
  return Response.json(body, { status, headers });
}

function fail(entry: ChampionshipBoardEntry, status: number, reason: ChampionshipReason, error: string, detail?: string): Response {
  const body: ChampionshipError = { error, reason, championship: entry.championship.id, ...(detail ? { detail } : {}) };
  return json(body, status, status === 503 || status === 429 ? { ...NO_STORE, "Retry-After": "10" } : NO_STORE);
}

/** True when the request comes from another site. A request with no `Origin` (same-origin GET-style, tools) passes to the session check. */
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

/** The signed-in player's internal id, with the player row made sure of (the run row references it). */
async function sessionPlayer(where: string): Promise<string | null> {
  try {
    const session = await auth();
    const id = session?.user?.playerId;
    if (!id) return null;
    const email = session?.user?.email;
    if (email) {
      await upsertPlayerOnLogin({ id, email, name: session.user?.name, image: session.user?.image }).catch((error) =>
        console.error(`championship ${where}: player upsert failed:`, error),
      );
    }
    return id;
  } catch (error) {
    console.error(`championship ${where}: auth() failed:`, error);
    return null;
  }
}

const CLOSED_COPY: Record<string, string> = {
  off: "This championship is not running.",
  upcoming: "Fright Fest has not opened yet.",
  closed: "Fright Fest submissions have closed.",
  suspended: "Fright Fest is paused for a moment.",
  verification: "Results are being checked; submissions have closed.",
  finalised: "Fright Fest results are final.",
  "board-pending": "This game joins Fright Fest when its event mode is verified.",
  "board-paused": "This game's Fright Fest board is paused.",
  "board-withdrawn": "This game is no longer part of Fright Fest.",
  "board-not-open-yet": "This game's Fright Fest board has not opened yet.",
  "started-before-board-opened": "This run started before the board opened.",
};

/** `POST /api/v1/leaderboard/<board>/runs`: start a run, get a token. */
export async function postRunStart(req: Request, entry: ChampionshipBoardEntry): Promise<Response> {
  if (crossSite(req)) return json({ error: "Cross-site request refused" } satisfies ApiError, 403);
  const player = await sessionPlayer("run start");
  if (!player) return fail(entry, 401, "signed-out", "Sign in to enter Fright Fest.");
  let body: { seed?: unknown } = {};
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as { seed?: unknown };
  } catch {
    /* An empty body is a valid run start. */
  }
  // Friend referrals: a new player about to play their first ranked run is attributed to the link they came by.
  // Fail-soft by construction (never throws); the run start does not wait on anything else.
  await attributeFromRequest(req, player);
  let out: IssueOutcome;
  try {
    out = await issueRun(championshipStore, entry.championship, entry.game, player, { seed: body.seed });
  } catch (error) {
    console.error(`championship run start failed for ${entry.game.board}:`, error);
    return fail(entry, 503, "unavailable", "Fright Fest is unavailable right now. Try again shortly.");
  }
  if (out.ok) {
    const res: RunStartResponse = {
      token: out.token,
      expiresAt: out.expiresAt,
      board: entry.game.board,
      championship: entry.championship.id,
    };
    return json(res, 201);
  }
  if (out.reason === "rate-limited") return fail(entry, 429, "rate-limited", "Too many runs started. Take a breath.");
  if (out.reason === "unavailable") return fail(entry, 503, "unavailable", "Fright Fest is unavailable right now.");
  return fail(entry, 409, "closed", CLOSED_COPY[out.reason] ?? "Not accepting runs.", out.reason);
}

/** `POST /api/v1/leaderboard/<board>` for a championship board: record a finished run. */
export async function postChampionshipScore(req: Request, entry: ChampionshipBoardEntry, payload: unknown): Promise<Response> {
  if (crossSite(req)) return json({ error: "Cross-site request refused" } satisfies ApiError, 403);
  const player = await sessionPlayer("submit");
  if (!player) return fail(entry, 401, "signed-out", "Sign in to enter Fright Fest. This run was not counted.");
  const { score, meta } = (payload ?? {}) as { score?: unknown; meta?: unknown };
  let out: SubmitOutcome;
  try {
    out = await submitRun(championshipStore, entry.championship, entry.game, player, { score, meta });
  } catch (error) {
    console.error(`championship submit failed for ${entry.game.board}:`, error);
    return fail(entry, 503, "unavailable", "Fright Fest is unavailable right now. Your run was not recorded.");
  }
  if (out.ok) {
    // An accepted run is what qualifies a referred friend: pay whoever invited them (fail-soft, idempotent).
    if (out.status === "accepted") await qualifyAfterRun(player);
    const body: ChampionshipSubmitResponse = {
      ok: true,
      championship: entry.championship.id,
      status: out.status,
      ...(out.rank !== null ? { rank: out.rank } : {}),
      best: out.best,
      late: out.late,
      duplicate: out.duplicate,
      score: typeof score === "number" ? Math.trunc(score) : 0,
    };
    return json(body, 200);
  }
  switch (out.reason) {
    case "no-run":
    case "unknown-run":
      return fail(entry, 409, "no-run", "This run has no valid Fright Fest entry. Start a new run while signed in.", out.reason);
    case "expired":
      return fail(entry, 409, "expired", "This run's entry expired before it finished.");
    case "rejected":
    case "already-rejected":
      return fail(entry, 422, "rejected", "This run did not pass the Fright Fest checks.", out.detail);
    case "rate-limited":
      return fail(entry, 429, "rate-limited", "Submitting too fast. Wait a few seconds.");
    case "unavailable":
      return fail(entry, 503, "unavailable", "Fright Fest is unavailable right now.");
    default:
      return fail(entry, 409, "closed", CLOSED_COPY[out.reason] ?? "Not accepting runs.", out.reason);
  }
}

/** `GET /api/v1/leaderboard/<board>` for a championship board: the ordinary leaderboard shape. */
export async function getChampionshipBoard(entry: ChampionshipBoardEntry, limit: number): Promise<Response> {
  const pub = await getPublicChampionship(entry.championship);
  if (!pub.available || !pub.standings) {
    return json({ error: "Leaderboard temporarily unavailable" } satisfies ApiError, 503, { ...NO_STORE, "Retry-After": "10" });
  }
  const board = pub.standings.boards.find((b) => b.slug === entry.game.slug);
  const scores: ScoreEntry[] = (board?.entries ?? []).slice(0, Math.max(1, Math.min(100, limit))).map((e) => ({
    rank: e.rank,
    handle: e.name,
    score: e.score,
    verified: true,
    avatar: e.avatar,
    playerId: e.publicId,
  }));
  const body: LeaderboardResponse = {
    game: entry.game.board,
    title: `${entry.game.title}: ${entry.game.mode}`,
    scoreLabel: entry.game.metric.label,
    sort: entry.game.metric.sort,
    period: "all",
    scores,
  };
  return json(body, 200, PUBLIC_CACHE);
}
