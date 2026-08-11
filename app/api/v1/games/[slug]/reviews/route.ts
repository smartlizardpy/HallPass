/**
 * Game reviews — `GET|POST|DELETE|OPTIONS /api/v1/games/[slug]/reviews`.
 *
 * A ROUTE HANDLER, not a server action, and that is a convention call worth
 * stating: every one of the ~70 `requireRole` sites in this codebase is a
 * dashboard page or an admin server action, so server actions here are
 * uniformly admin-only and role-guarded. A review is a public write by a player
 * with no role. All three existing player-scoped writes — `/me/handle`,
 * `/me/favorites`, `/leaderboard/[slug]` — are route handlers, and reviews
 * belong with them. It also sidesteps the global 25 MB
 * `serverActions.bodySizeLimit` set for game-zip uploads.
 *
 * GET is IDENTITY-FREE so it can be CDN-cached: it carries no "is this mine" or
 * "did I vote" flag, and the client compares against its own `/api/v1/me` data.
 * The cost is that a freshly-posted review may not appear on a cold reload for up
 * to 30s, which optimistic client-side insertion covers. Converting this to
 * `no-store` to "fix" that would put every review read on the origin.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { findGame } from "@/app/lib/games";
import { isResolvedSlug } from "@/app/lib/games-store";
import { reviewPostedCopy } from "@/app/lib/notifications/copy";
import { notifyAdmins } from "@/app/lib/notifications/deliver";
import { authorTagSalt, hashBody, reviews } from "@/app/lib/reviews";
import type { ReviewSort } from "@/app/lib/reviews";
import { REVIEWS_PAGE_SIZE } from "@/app/lib/reviews/config";
import {
  REVIEW_REJECTION_MESSAGES,
  softenShouting,
  validateReviewBody,
} from "@/app/lib/reviews/validate";
import { containsBlockedReviewTerm } from "@/app/lib/reviews/wordlist";
import { clientKeyFromHeaders, hashIp } from "@/app/lib/scoreboard/guard";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

/** Public, identity-free, CDN-cacheable. */
const PUBLIC_CACHE: Record<string, string> = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
  "Access-Control-Allow-Origin": "*",
};

const EMPTY = { reviews: [], total: 0, recommended: 0, enabled: true };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const url = new URL(req.url);

  const sort: ReviewSort = url.searchParams.get("sort") === "helpful" ? "helpful" : "recent";
  const rawBefore = url.searchParams.get("before");
  const beforeNum = Number(rawBefore);
  const before =
    rawBefore && Number.isFinite(beforeNum) && beforeNum > 0 ? Math.trunc(beforeNum) : null;

  try {
    const [page, summary] = await Promise.all([
      reviews.listReviews(slug, { sort, before, salt: authorTagSalt() }),
      reviews.summary(slug),
    ]);
    return Response.json(
      {
        reviews: page.reviews,
        total: summary.total,
        recommended: summary.recommended,
        pageSize: REVIEWS_PAGE_SIZE,
        enabled: true,
      },
      { headers: PUBLIC_CACHE },
    );
  } catch (error) {
    // Schema behind the deploy, or a blip. Either way the store page must render.
    if (!isMissingColumnError(error)) {
      console.error("reviews GET failed:", error);
    }
    return Response.json({ ...EMPTY, enabled: false }, { headers: NO_STORE });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let raw: unknown;
  let recommended: unknown;
  try {
    const body = (await req.json()) as { body?: unknown; recommended?: unknown };
    raw = body?.body;
    recommended = body?.recommended;
  } catch {
    return Response.json({ ok: false, reason: "Bad request" }, { status: 400, headers: NO_STORE });
  }

  if (typeof recommended !== "boolean") {
    return Response.json(
      { ok: false, reason: "Say whether you'd recommend it" },
      { status: 400, headers: NO_STORE },
    );
  }

  const check = validateReviewBody(raw);
  if (!check.ok) {
    return Response.json(
      { ok: false, reason: REVIEW_REJECTION_MESSAGES[check.reason] },
      { status: 400, headers: NO_STORE },
    );
  }
  const body = softenShouting(check.body);

  // The wordlist runs LAST, on fully-unmasked text — zero-width and leetspeak
  // folding both happen upstream in the validator.
  //
  // FLAGGED terms post but land in the moderation queue; only BLOCKED terms are
  // refused. Two tiers let the list be aggressive without making the product
  // unusable, and mean a borderline review is seen by a human rather than being
  // invisible by default.
  const verdict = containsBlockedReviewTerm(body);
  if (verdict === "blocked") {
    return Response.json(
      { ok: false, reason: REVIEW_REJECTION_MESSAGES["blocked-word"] },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    if (!(await isResolvedSlug(slug))) {
      return Response.json({ ok: false, reason: "Unknown game" }, { status: 404, headers: NO_STORE });
    }

    const outcome = await reviews.upsertReview({
      slug,
      playerId,
      recommended,
      body,
      bodyHash: hashBody(body),
      ipHash: hashIp(clientKeyFromHeaders(req.headers)),
      // A flagged review is published but hidden pending review — it never sits
      // in front of a class unseen, and it never silently vanishes either.
      status: verdict === "flagged" ? "hidden" : "visible",
    });

    if (outcome === "ok") {
      // Put it in front of the admins.
      //
      // ONCE PER (GAME, AUTHOR), not once per write. `upsertReview` is an
      // upsert, so every edit a player makes comes back through here — and a
      // review being reworded is not a new thing to moderate, it is the same
      // one. The key makes the announcement idempotent for the life of that
      // review; the moderation queue, which reads the CURRENT text, is what
      // covers a review edited after the fact.
      //
      // The author is deliberately not named. An admin triages by game and
      // opens the queue to see who wrote what, and a lock-screen banner naming
      // a pupil beside "new review" is more than the notification needs to do.
      await notifyAdmins({
        kind: "review_posted",
        copy: reviewPostedCopy({
          gameTitle: findGame(slug)?.title ?? slug,
          slug,
        }),
        dedupeKey: `review_posted:${slug}:${playerId}`,
      });

      return Response.json({ ok: true, pending: verdict === "flagged" }, { headers: NO_STORE });
    }
    return Response.json(
      { ok: false, reason: OUTCOME_MESSAGES[outcome] },
      { status: outcome === "banned" ? 403 : 429, headers: NO_STORE },
    );
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json(
        { ok: false, reason: "Reviews aren't switched on yet" },
        { status: 503, headers: NO_STORE },
      );
    }
    console.error("reviews POST failed:", error);
    return Response.json(
      { ok: false, reason: "Could not save that review" },
      { status: 500, headers: NO_STORE },
    );
  }
}

const OUTCOME_MESSAGES: Record<string, string> = {
  // Deliberately does not spell out the duration or the cause — a banned player
  // does not need a countdown to plan around.
  banned: "You can't post reviews right now.",
  "too-new": "New accounts can review after a few minutes.",
  duplicate: "You've already posted that.",
  "rate-limited": "That's a lot of edits — try again shortly.",
};

/** Author self-delete. A tombstone, so reports still point at real text. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  try {
    await reviews.softDeleteOwnReview(slug, playerId);
    // Reports success even when nothing matched: the caller's intent is "I don't
    // want my review there", and it is satisfied either way.
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
    }
    console.error("reviews DELETE failed:", error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, POST, DELETE, OPTIONS");
}
