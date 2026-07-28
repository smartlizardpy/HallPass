/**
 * Report a review — `POST|OPTIONS /api/v1/reviews/[id]/report`.
 *
 * SIGNED-IN ONLY, and that is a deliberate trade rather than an oversight. An
 * anonymous report endpoint is a free denial of service on the moderation queue:
 * a loop of curl requests produces thousands of open reports and the one real
 * one becomes unfindable. A session buys dedup by `(review_id, reporter_id)`, a
 * per-reporter rate limit, and traceability if reporting itself is abused.
 *
 * The cost is real: a signed-out pupil who sees something awful cannot report
 * it. The mitigation is the mailto in the page footer, not a weaker endpoint.
 *
 * ALWAYS ANSWERS `ok`, including for a duplicate report, so the response never
 * leaks whether this person had already reported that review.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { reviews } from "@/app/lib/reviews";
import { isReportReason } from "@/app/lib/reviews/config";
import { clientKeyFromHeaders, hashIp } from "@/app/lib/scoreboard/guard";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isFinite(reviewId) || reviewId <= 0) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }

  let reason = "other";
  try {
    const body = (await req.json()) as { reason?: unknown };
    // Whitelisted union, chosen in JS — the column's CHECK is the backstop, not
    // the gate, and an unknown value falls back rather than erroring.
    if (isReportReason(body?.reason)) reason = body.reason;
  } catch {
    reason = "other";
  }

  try {
    await reviews.reportReview(
      Math.trunc(reviewId),
      playerId,
      reason,
      hashIp(clientKeyFromHeaders(req.headers)),
    );
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
    }
    console.error("review report failed:", error);
    // Still answers ok: a failed report must not tell the reporter anything about
    // the review's state, and the UI has already thanked them.
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
