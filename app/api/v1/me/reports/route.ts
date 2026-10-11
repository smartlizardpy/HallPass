/**
 * Report a player — `POST|OPTIONS /api/v1/me/reports`.
 *
 *   POST { id: publicId, reason, note? }
 *     → { ok: true }
 *     → { ok: false, reason }   (see `ProfileReportRefusal`)
 *
 * The write behind the "Report" button on `/u/<username>`.
 * `docs/profile-reports-design.md` has the whole design.
 *
 * ── SIGNED IN ONLY, ORIGIN FIRST ────────────────────────────────────────────
 * The reporter comes from the session cookie, never the body. `isTrustedOrigin`
 * runs before anything else, as on every `/me/` write, so a game in an iframe
 * cannot file reports on the player's behalf (a report is a safeguarding signal,
 * and mass false reports are a harassment tool in their own right). The same
 * honest limits as `social/request-guard.ts` apply.
 *
 * ── WHAT THE RESPONSE REVEALS ───────────────────────────────────────────────
 * The target is a `public_id` only; the internal id never appears in this file.
 * A duplicate of an open report answers `ok` exactly like a fresh one, so the
 * endpoint cannot be used to learn whether a report already exists. A blocked or
 * private profile is reportable like any other: `/u/<username>` already renders
 * a minimal profile for those viewers, so reporting one reveals nothing the page
 * does not. An id that matches no player is `unavailable` (404), the same
 * collapsed answer `me/friends` gives, and reporting yourself is `self`.
 */

import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  isTrustedOrigin,
} from "@/app/lib/social/request-guard";
import { notifyAdmins } from "@/app/lib/notifications/deliver";
import { profileReportedCopy } from "@/app/lib/notifications/copy";
import { profileReports, reportUnexpected } from "@/app/lib/profile-reports";
import {
  MAX_BODY_BYTES,
  isProfileReportReason,
  parseNote,
  type ProfileReportReason,
  type ProfileReportRefusal,
} from "@/app/lib/profile-reports/config";

/** A public id. Validated here so a bad one is a 400, not a failed `::uuid` cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSAL_STATUS: Record<ProfileReportRefusal, number> = {
  forbidden: 403,
  "bad-request": 400,
  "signed-out": 401,
  self: 400,
  unavailable: 404,
  "rate-limited": 429,
  down: 503,
};

function refuse(reason: ProfileReportRefusal): Response {
  return Response.json(
    { ok: false, reason },
    { status: REFUSAL_STATUS[reason], headers: NO_STORE },
  );
}

/**
 * A JSON object body, or `null` (wrong content type, too big, not an object).
 * The content-type check is the CSRF guard `me/invites` documents.
 */
async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Tell the admins a new report is in the queue, the way `reviews/[id]/report`
 * does. BEST EFFORT AND FAIL-SOFT: `notifyAdmins` swallows its own failures, and
 * the `catch` here covers anything that escapes (an import-time fault, a throw
 * from the copy builder), so a notification problem can never fail the report
 * request: the report is already stored.
 *
 * The text names NO ONE: not the reporter (anonymous to moderators) and not the
 * reported child, only the fixed reason label (`profileReportedCopy`). Not
 * deduped (`dedupeKey: null`): a `created` outcome is by construction a new open
 * report, and the per-reporter rate limit already bounds the volume.
 */
async function announce(reason: ProfileReportReason): Promise<void> {
  try {
    await notifyAdmins({
      kind: "profile_reported",
      copy: profileReportedCopy({ reason }),
      dedupeKey: null,
    });
  } catch (error) {
    console.error("[profile-reports] admin notification failed:", error);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!isTrustedOrigin(req)) return refuse("forbidden");

  const body = await readJsonBody(req);
  if (!body) return refuse("bad-request");

  const id = typeof body.id === "string" ? body.id : "";
  if (!UUID_RE.test(id)) return refuse("bad-request");
  const reason = body.reason;
  if (!isProfileReportReason(reason)) return refuse("bad-request");
  const note = parseNote(body.note);
  if (note === undefined) return refuse("bad-request");

  const reporterId = await currentPlayerId();
  if (!reporterId) return refuse("signed-out");

  try {
    const outcome = await profileReports.create({
      reporterId,
      reportedPublicId: id.toLowerCase(),
      reason,
      note,
    });
    switch (outcome.result) {
      case "created":
        await announce(reason);
        return Response.json({ ok: true }, { headers: NO_STORE });
      case "duplicate":
        // Writes no row, so there is nothing new to announce.
        return Response.json({ ok: true }, { headers: NO_STORE });
      case "self":
        return refuse("self");
      case "unknown":
        return refuse("unavailable");
      case "rate-limited":
        return refuse("rate-limited");
    }
  } catch (error) {
    reportUnexpected("POST me/reports", error);
    return refuse("down");
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
