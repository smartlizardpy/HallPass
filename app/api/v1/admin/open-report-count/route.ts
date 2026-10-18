/**
 * `GET /api/v1/admin/open-report-count` — the moderation badge's number.
 *
 * WHY A ROUTE AND NOT THE SERVER FUNCTION. The badge sits in the dashboard nav,
 * so its poll used to be a Server Function POST to whatever page the admin was
 * on, billed to that page's route. This is a plain GET that runs none of the
 * page's code: just a session check and two counts.
 *
 * Session-gated (an admin's cookie), unlike the secret-gated operator routes
 * beside it. Answers 401/403 as JSON rather than redirecting, because the caller
 * is `fetch`. Private and uncacheable: the answer is for one signed-in admin.
 */

import { auth } from "@/app/lib/auth";
import { atLeast } from "@/app/lib/permissions";
import { countOpenReports } from "@/app/lib/open-report-count";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(): Promise<Response> {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !session?.user?.email) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!atLeast(role, "admin")) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  return Response.json({ count: await countOpenReports() }, { headers: NO_STORE });
}
