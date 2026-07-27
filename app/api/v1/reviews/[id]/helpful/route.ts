/**
 * Toggle a helpful vote — `POST|OPTIONS /api/v1/reviews/[id]/helpful`.
 *
 * Signed-in only. The vote is idempotent by PRIMARY KEY on
 * `(review_id, player_id)`, so a double-click cannot inflate the count, and the
 * denormalised `helpful_count` is updated in the SAME statement as the vote so
 * the two can never drift.
 */

import { isMissingColumnError } from "@/app/lib/db";
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
