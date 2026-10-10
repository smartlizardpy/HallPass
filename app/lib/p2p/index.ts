/**
 * HallPass P2P — the signaling store bound to the shared Neon client, plus the
 * request helpers every P2P route shares.
 *
 * Mirrors `challenges/index.ts`: the factory in `store.ts` stays testable
 * against a fake `sql`; this module reaches for the live connection and auth,
 * so it is the one that must never reach a client bundle.
 */

import "server-only";
import { sql, isMissingColumnError, isUnconfiguredDbError } from "@/app/lib/db";
import { isKnownSlug, isStagedSlug } from "@/app/lib/games-store";
import { canViewStaged } from "@/app/lib/beta/staged-access";
import { clientKeyFromHeaders, hashIp } from "@/app/lib/scoreboard/guard";
import { DEMO_GAME_ID } from "@/sdk/p2p/src/codes";
import { createP2PStore } from "./store";
import { isP2PDisabled } from "./config";

export const p2pStore = createP2PStore(sql);

/** Per-user, never shared-cacheable — every P2P response. */
export const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The uniform refusal shape: `{ ok: false, error: <code> }`. */
export function fail(status: number, error: string, extra?: Record<string, unknown>): Response {
  return json({ ok: false, error, ...extra }, status);
}

/** 503 for a switched-off feature or a database that cannot serve it. */
export function unavailable(): Response {
  return fail(503, "unavailable");
}

export { isP2PDisabled };

/**
 * Map a store failure to a response: a missing table or unconfigured database is
 * "the feature is not deployed yet" (503, quiet), anything else is logged (500).
 */
export function storeFailure(where: string, error: unknown): Response {
  if (isMissingColumnError(error) || isUnconfiguredDbError(error)) return unavailable();
  console.error(`[p2p] ${where} failed:`, error);
  return fail(500, "server-error");
}

/**
 * The rate-limit key: a salted hash of the player id when signed in, else of
 * the client IP. Never stored raw.
 */
export function rateKey(req: Request, playerId: string | null): string {
  return hashIp(playerId ? `p2p-player:${playerId}` : `p2p-ip:${clientKeyFromHeaders(req.headers)}`);
}

/**
 * May this caller open rooms for `gameId`? The demo id always; a real game slug
 * when it exists, and a STAGED game only for those who may see it. A denied
 * staged slug answers exactly like an unknown one (the caller cannot tell the
 * difference), the same rule `game-html` follows.
 */
export async function canUseGame(gameId: string): Promise<boolean> {
  if (gameId === DEMO_GAME_ID) return true;
  if (!(await isKnownSlug(gameId))) return false;
  return (await isStagedSlug(gameId)) ? canViewStaged() : true;
}

/**
 * Read a JSON object body, or `null` for anything else (oversized, malformed, or
 * not sent as `application/json`).
 *
 * The content-type check is the CSRF guard. These endpoints set no CORS headers,
 * and a cross-site `application/json` POST needs a preflight that therefore
 * fails; only a "simple" request (a form's `text/plain`) could slip through, and
 * that is exactly what this refuses.
 */
export async function readJsonBody(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
