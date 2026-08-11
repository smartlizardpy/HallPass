/**
 * The signed-in player's notification inbox — `/api/v1/me/notifications`.
 *
 * ── WHY THE BELL READS FROM `/api` AND NOT FROM THE SERVER COMPONENT ───────
 * The bell is mounted in `SiteHeader`, which every public page renders. Those
 * pages are statically prerendered, and that is load-bearing twice over:
 * `prerender-manifest.json` is what `scripts/build-sw-manifest.mjs` turns into
 * the service-worker precache, so a page that went dynamic would drop out of
 * offline support entirely. Reading per-viewer data in the header would do
 * exactly that to the whole site.
 *
 * So the header stays static and the bell hydrates from here, the same
 * arrangement `AccountMenu` uses for identity and the friend-request badge.
 * `/api/` is never intercepted by the service worker, so none of this is ever
 * served from a shared cache.
 *
 * ── IT ANSWERS FOR A SIGNED-OUT VISITOR ────────────────────────────────────
 * With `signedIn: false` and an empty inbox, rather than a 401. The bell is on
 * every page including the ones most visitors see logged out, and a 401 per page
 * load is a console full of red for the site's ordinary state.
 *
 * ── THE PLAYER IS THE COOKIE ───────────────────────────────────────────────
 * Derived from the session, never from a parameter — the invariant
 * `request-guard.ts` documents for every credentialed route. There is no
 * `playerId` in the querystring to swap for somebody else's.
 */

import {
  BELL_LIST_LIMIT,
  NOTIFICATION_LIST_LIMIT,
} from "@/app/lib/notifications/config";
import { getInbox } from "@/app/lib/notifications";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";

/**
 * Read `?limit`, clamped to the two sizes that exist.
 *
 * An ALLOW-LIST of two rather than a clamped integer: the only callers are the
 * bell (a peek) and the notifications page (the list), and letting a caller name
 * an arbitrary size makes the row count a request parameter on an endpoint every
 * page hits. Anything unrecognised falls back to the bell's smaller page.
 */
function readLimit(url: string): number {
  const raw = new URL(url).searchParams.get("limit");
  return raw === String(NOTIFICATION_LIST_LIMIT)
    ? NOTIFICATION_LIST_LIMIT
    : BELL_LIST_LIMIT;
}

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json(
      { signedIn: false, items: [], unread: 0 },
      { headers: NO_STORE },
    );
  }

  // Already fail-soft: a database with no `notifications` table yet answers with
  // an empty inbox rather than throwing, which matters because this response
  // feeds a control in the site header on every page.
  const inbox = await getInbox(playerId, readLimit(req.url));

  return Response.json(
    { signedIn: true, items: inbox.items, unread: inbox.unread },
    { headers: NO_STORE },
  );
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, OPTIONS");
}
