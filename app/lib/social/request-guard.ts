/**
 * HallPass — shared guards for the credentialed social endpoints.
 *
 * Two concerns, both of which every social route needs and neither of which
 * belongs copy-pasted into six files.
 *
 * ── 1. WHO IS CALLING ──────────────────────────────────────────────────────
 * The player is derived ENTIRELY from the session cookie, never from the request
 * body — the invariant already documented on `/api/v1/me/favorites`. Reading
 * `auth()` must never throw to the caller: any failure reads as "not signed in",
 * which is the same answer a cookie-less call gets.
 *
 * ── 2. WHERE THE CALL CAME FROM ────────────────────────────────────────────
 * Games are served from `/game-html/<slug>/` on OUR OWN ORIGIN, inside an iframe
 * with no `sandbox` attribute. That means a game's JavaScript runs with the
 * player's session cookie and can call these endpoints directly. Today a game is
 * reviewed before upload and only two trusted people upload them, so this is
 * defence in depth rather than the primary control — but a review can miss
 * something, and the cost here is a few lines.
 *
 * `Sec-Fetch-Site` cannot help: the iframe genuinely IS same-origin, so it sends
 * exactly what a legitimate page sends. What DOES separate them is the referrer —
 * a fetch from inside the game frame carries `/game-html/…`, while one from our
 * own UI carries the page the user is looking at.
 *
 * It is written as an ALLOWLIST, not a denylist, and that distinction is the
 * whole point: a game could set `<meta name="referrer" content="no-referrer">` in
 * its own HTML to suppress the header entirely, which would sail past a "reject
 * if it looks like a game" rule. Requiring a referrer from a known app path fails
 * closed instead.
 *
 * HONEST LIMITS. This closes the silent background-request path — the one that
 * scales to mass harassment. It does not stop a game that navigates the top frame
 * to a real page, and a browser that strips referrers entirely would be blocked
 * from these endpoints (no current browser does this same-origin under the
 * default `strict-origin-when-cross-origin` policy). The real fix is an iframe
 * sandbox with an opaque origin, which costs the 8 games that use localStorage
 * their saved progress and the SDK its identity call — deliberately not paid here.
 */

import { auth } from "@/app/lib/auth";
import { isTrustedOrigin } from "./origin";
import type { Session } from "next-auth";

/** Per-user, never shared-cacheable. */
export const NO_STORE: Record<string, string> = {
  "Cache-Control": "private, no-store",
};

/**
 * The signed-in player's internal id, or `null` for a guest. Never throws.
 */
export async function currentPlayerId(): Promise<string | null> {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    console.error("social auth() failed:", error);
    session = null;
  }
  // `playerId` is the Google subject pinned at login. NEVER `session.user.id`,
  // which `app/lib/auth.ts` documents as a fresh random UUID on every login.
  return session?.user?.playerId ?? null;
}

/**
 * Standard 403 for a mutation from an untrusted surface.
 *
 * Deliberately vague. Naming the referrer rule would tell an embedded game
 * exactly what to spoof, and the legitimate caller never sees this response.
 */
export function forbidden(): Response {
  return Response.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
}

/** Standard 401 for an unauthenticated mutation. */
export function unauthorized(): Response {
  return Response.json({ ok: false, error: "signed-out" }, { status: 401, headers: NO_STORE });
}

/**
 * Bare OPTIONS for a cookie-credentialed endpoint: methods only, and NO
 * `Access-Control-Allow-Origin`. A wildcard origin cannot legally carry
 * credentials, and there is no third-party origin that should be calling these —
 * unlike `/api/v1/leaderboard/*`, which games do call cross-origin.
 */
export function credentialedOptions(methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export { isTrustedOrigin };
