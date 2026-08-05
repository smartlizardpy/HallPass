/**
 * HallPass — streams a beta replay clip to the people entitled to see it.
 *
 * A REPLAY IS A RECORDING OF A CHILD'S SCREEN. That single fact decides the
 * whole design of this route, and it is why the clip is NOT served the way game
 * screenshots are (`/game-media/`, `immutable`, readable by anyone with the
 * URL). Two rules follow:
 *
 *   1. THE RAW BLOB URL IS NEVER RENDERED. `beta_reports.clip_blob_path` stays
 *      server-side; the dashboard points its `<video>` at this route instead. A
 *      public blob URL is a bearer token that cannot be revoked, and one pasted
 *      into a chat would stay readable forever.
 *   2. ACCESS IS CHECKED PER REQUEST, and only two parties pass: the tester who
 *      filed the report, and an admin. Not other testers, not the game's author.
 *
 * `private, no-store` for the same reason — a shared cache holding this would
 * defeat both rules at once.
 */

import { auth } from "@/app/lib/auth";
import { beta } from "@/app/lib/beta";

const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

const DENY = () =>
  new Response("Not found", { status: 404, headers: NO_STORE });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0) return DENY();

  const session = await auth();
  const playerId = session?.user?.playerId;
  const isAdmin = Boolean(session?.user?.role);
  if (!playerId && !isAdmin) return DENY();

  let report;
  try {
    report = await beta.reportById(reportId);
  } catch (error) {
    console.error(`beta clip read failed for ${reportId}:`, error);
    // Fail CLOSED. Unable to confirm entitlement is not permission to stream.
    return DENY();
  }
  if (!report?.clipBlobPath) return DENY();

  // 404 rather than 403 for a real report someone is not entitled to: a 403
  // confirms the report exists, which is itself information.
  if (!isAdmin && report.playerId !== playerId) return DENY();

  // The URL was recorded when the browser uploaded the clip, so streaming it
  // costs no billed `head()`. The blob is public-but-unguessable; the guard
  // above is what actually restricts access, and the URL never leaves the
  // server — the dashboard only ever sees this route's path.
  if (!report.clipUrl) return DENY();
  let upstream: Response;
  try {
    upstream = await fetch(report.clipUrl);
  } catch (error) {
    console.error(`beta clip fetch failed for ${reportId}:`, error);
    return DENY();
  }
  if (!upstream.ok || !upstream.body) return DENY();

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "video/webm",
      "content-disposition": "inline",
      ...NO_STORE,
      "x-content-type-options": "nosniff",
    },
  });
}
