/**
 * HallPass set-handle endpoint — `POST|OPTIONS /api/v1/me/handle`.
 *
 * Lets a signed-in player choose the display handle that tags their leaderboard
 * scores (the override stored in `players.handle`; clearing it reverts the
 * effective display to their Google name). This is a CREDENTIALED action keyed
 * by the Auth.js session cookie, so it is SAME-ORIGIN only: a player edits their
 * handle from hallpass.gg, where the cookie is attached. No verified session →
 * `401`.
 *
 * CORS, deliberately minimal: this is a same-origin, cookie-credentialed write,
 * so we do NOT emit a wildcard `Access-Control-Allow-Origin` (a wildcard origin
 * cannot legally carry credentials). Same-origin requests need no CORS grant at
 * all; the bare OPTIONS below simply advertises the method without opening the
 * write up cross-origin. The success body is the email-free {@link PlayerIdentity}
 * — EMAIL is NEVER exposed — and is marked `private, no-store` (per-user).
 */

import { auth } from "@/app/lib/auth";
import { getPublicIdentity, setPlayerHandle } from "@/app/lib/players";
import type { Session } from "next-auth";
import type { ApiError, MeResponse, SetHandleRequest } from "@/sdk/src/contract";

const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

export async function POST(req: Request): Promise<Response> {
  // No try/catch around auth() here: unlike the public leaderboard, this is a
  // gated same-origin action, so a missing/invalid session is simply "not signed
  // in" → 401 rather than a silent anonymous fallback.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    console.error("me/handle POST auth() failed:", error);
    session = null;
  }

  const playerId = session?.user?.playerId;
  if (!playerId) {
    return Response.json({ error: "Sign in required" } satisfies ApiError, {
      status: 401,
      headers: NO_STORE,
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, {
      status: 400,
      headers: NO_STORE,
    });
  }
  const { handle } = (payload ?? {}) as Partial<SetHandleRequest>;
  if (typeof handle !== "string") {
    return Response.json({ error: "handle must be a string" } satisfies ApiError, {
      status: 400,
      headers: NO_STORE,
    });
  }

  // `setPlayerHandle` sanitises and caps the input, reverting to NULL (→ Google
  // name) when nothing usable remains. We re-read the effective identity so the
  // caller sees exactly what was stored.
  await setPlayerHandle(playerId, handle);
  const player = await getPublicIdentity(playerId);
  return Response.json({ player } satisfies MeResponse, { headers: NO_STORE });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
