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
import { findGame } from "@/app/lib/games";
import { reviewReportedCopy } from "@/app/lib/notifications/copy";
import { notifyAdmins } from "@/app/lib/notifications/deliver";
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
    const id = Math.trunc(reviewId);
    const outcome = await reviews.reportReview(
      id,
      playerId,
      reason,
      hashIp(clientKeyFromHeaders(req.headers)),
    );

    // The author reporting their own review. Suppressed as queue noise rather
    // than as a security control (see the store), and SAID OUT LOUD rather than
    // swallowed: this is the one refusal that leaks nothing at all — the person
    // being told already knows they wrote it — and it is the case a person
    // testing whether reporting works is most likely to try first.
    if (outcome === "self") {
      return Response.json(
        { ok: false, reason: "You can't report your own review." },
        { status: 400, headers: NO_STORE },
      );
    }

    // Raise it with the admins. This is the loudest of the moderation kinds —
    // it is the only one that defaults to `push` — because a report is somebody
    // saying something is wrong NOW, and reports are rare enough that a phone
    // buzzing for one is not noise.
    //
    // KEYED ON THE REVIEW, not on the report. Ten pupils reporting the same
    // review is ONE thing to look at, and ten identical banners would be the
    // fastest way to teach an admin to swipe the whole kind away. The tenth
    // report still lands in the queue with the other nine; it just does not
    // announce itself again.
    //
    // NEITHER THE REPORTER NOR THE REPORTED TEXT IS NAMED — see
    // `notifications/copy.ts`. The reporter is confidential, and the text is
    // usually the thing being complained about.
    const slug = await reviews.slugForReview(id).catch(() => null);
    await notifyAdmins({
      kind: "review_reported",
      copy: reviewReportedCopy({
        gameTitle: slug ? (findGame(slug)?.title ?? slug) : "a game",
      }),
      dedupeKey: `review_reported:${id}`,
    });

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
