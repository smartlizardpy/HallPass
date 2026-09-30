/**
 * Toggle a helpful vote — `POST|OPTIONS /api/v1/reviews/[id]/helpful`.
 *
 * Signed-in only. The vote is idempotent by PRIMARY KEY on
 * `(review_id, player_id)`, so a double-click cannot inflate the count, and the
 * denormalised `helpful_count` is updated in the SAME statement as the vote so
 * the two can never drift.
 *
 * A review of a STAGED (beta-only) game answers a viewer who cannot see staged
 * games exactly as it answers an id that matches nothing: a no-op vote of zero.
 * Ids are sequential, so anything else would let a stranger probe for them.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { isReviewHiddenFromViewer } from "@/app/lib/beta/staged-review";
import { reviews } from "@/app/lib/reviews";
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
  // Guarded in JS: a non-numeric id would make Postgres raise 22P02 and turn a
  // bad request into a 500.
  if (!Number.isFinite(reviewId) || reviewId <= 0) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }

  try {
    if (await isReviewHiddenFromViewer(Math.trunc(reviewId))) {
      return Response.json({ ok: true, helpful: false, count: 0 }, { headers: NO_STORE });
    }
    const result = await reviews.toggleHelpful(Math.trunc(reviewId), playerId);
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
    }
    console.error("review helpful failed:", error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
