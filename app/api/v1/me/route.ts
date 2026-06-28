/**
 * HallPass current-player endpoint — `GET|OPTIONS /api/v1/me`.
 *
 * The SDK calls this to learn who (if anyone) is signed in, so a game can show a
 * verified badge / avatar and skip the anonymous handle prompt. Identity rides
 * the Auth.js SESSION COOKIE, which the browser only attaches SAME-ORIGIN — so
 * on hallpass.gg the cookie arrives and `auth()` resolves a player, while a
 * cross-origin embed sends no cookie and we answer `{ player: null }` (the
 * cross-origin token flow is a later phase, out of scope here).
 *
 * CORS mirrors the public leaderboard route (permissive `*`) so the call never
 * trips a preflight; note that a wildcard origin cannot carry credentials, which
 * is fine because cookies only ever travel same-origin anyway. The body is the
 * email-free {@link PlayerIdentity} (or null) — EMAIL is NEVER exposed. The
 * response is marked `private, no-store`: it is per-user and must never be cached
 * by a shared CDN.
 */

import { auth } from "@/app/lib/auth";
import { getPublicIdentity } from "@/app/lib/players";
import type { Session } from "next-auth";
import type { MeResponse, PlayerIdentity } from "@/sdk/src/contract";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "private, no-store",
};

export async function GET(): Promise<Response> {
  // Reading auth() must never throw to the caller: any failure → no session →
  // an anonymous (null) identity, the same answer a cross-origin call gets.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    console.error("me GET auth() failed:", error);
    session = null;
  }

  const playerId = session?.user?.playerId;
  // A dashboard role (admin/super_admin) lets the site header show a Dashboard
  // link. This is the user's own status only — not sensitive, never the email.
  const isAdmin = Boolean(session?.user?.role);
  const role = session?.user?.role ?? null;
  if (!playerId) {
    return Response.json({ player: null, isAdmin: false, role: null } satisfies MeResponse, {
      headers: CORS_HEADERS,
    });
  }

  // A DB hiccup here must not 500 the endpoint — degrade to a null identity,
  // which the caller treats exactly like "not signed in".
  let ident: PlayerIdentity | null = null;
  try {
    ident = await getPublicIdentity(playerId);
  } catch (error) {
    console.error("me GET getPublicIdentity failed:", error);
  }
  return Response.json({ player: ident, isAdmin, role } satisfies MeResponse, {
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
