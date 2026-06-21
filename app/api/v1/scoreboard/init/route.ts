import type { NextRequest } from "next/server";
import { games } from "@/app/lib/games";
import {
  isAdminPasswordConfigured,
  isHtmlAdminAuthenticated,
  verifyAdminPassword,
} from "@/app/lib/admin-html-auth";
import {
  boardExists,
  createBoard,
  isScoreboardConfigured,
} from "@/app/lib/scoreboard";

/**
 * Initialize a leaderboard board for a game. This is the "AI agent asks the
 * creator for the admin password to create the board" flow.
 *
 * AUTH: reuses the existing admin password (ADMIN_HTML_PASSWORD). Accept ANY of:
 *   - the admin-html session cookie (a logged-in admin in the browser), OR
 *   - an `X-Admin-Password: <pw>` header, OR
 *   - an `Authorization: Bearer <pw>` header
 * so a non-browser caller (an AI agent) can authenticate with just the password.
 */
export async function POST(req: NextRequest) {
  if (!isAdminPasswordConfigured()) {
    return Response.json(
      { error: "Admin password not configured on the server" },
      { status: 503 }
    );
  }

  if (!isScoreboardConfigured()) {
    return Response.json(
      { error: "Scoreboard backend (PANTRY_ID) not configured" },
      { status: 503 }
    );
  }

  // Header password (preferred for agents) OR an authenticated admin cookie.
  const headerPw =
    req.headers.get("x-admin-password") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;

  const authed =
    verifyAdminPassword(headerPw) ||
    (await isHtmlAdminAuthenticatedSafe());

  if (!authed) {
    return Response.json(
      { error: "Unauthorized: provide a valid admin password" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = typeof (body as { slug?: unknown })?.slug === "string"
    ? (body as { slug: string }).slug.trim()
    : "";

  if (!slug) {
    return Response.json({ error: "Missing slug" }, { status: 400 });
  }
  if (!games.some((g) => g.slug === slug)) {
    return Response.json({ error: "Unknown game slug" }, { status: 404 });
  }

  // Idempotent: if the board already exists, don't POST (which would wipe it).
  if (await boardExists(slug)) {
    return Response.json({ ok: true, alreadyInitialized: true });
  }

  const created = await createBoard(slug);
  if (!created.ok) {
    if (created.rateLimited) {
      return Response.json(
        {
          error:
            "Leaderboard backend is rate-limited right now. Try again in a few seconds.",
        },
        { status: 503, headers: { "Retry-After": "3" } }
      );
    }
    return Response.json({ error: "Failed to create board" }, { status: 502 });
  }

  return Response.json({ ok: true });
}

/** The cookie store can throw in some contexts; never let auth-check crash the route. */
async function isHtmlAdminAuthenticatedSafe(): Promise<boolean> {
  try {
    return await isHtmlAdminAuthenticated();
  } catch {
    return false;
  }
}
