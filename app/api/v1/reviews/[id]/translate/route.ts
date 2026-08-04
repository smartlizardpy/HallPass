/**
 * Translate a review — `GET|OPTIONS /api/v1/reviews/[id]/translate?to=<lang>`.
 *
 * A GET, not a POST, and IDENTITY-FREE for the same reasons the reviews list is
 * (see `games/[slug]/reviews/route.ts`): the translation of a public review into a
 * given language depends on nothing but the review and the language, so it is
 * CDN-cacheable and needs no session. Caching is what makes the free, unofficial
 * upstream viable at all — the set of distinct upstream calls is bounded by
 * (#reviews × #languages) and every repeat is served from the edge.
 *
 * NOT AN OPEN PROXY. The text handed upstream is looked up from a VISIBLE review by
 * its numeric id — it is never taken from the caller. So this cannot be used to
 * launder arbitrary text through our origin, and it cannot reach a hidden or
 * deleted review's body. The only caller-controlled input is the target language,
 * which `normalizeTargetLang` reduces to `[a-z]{2}` (or `zh-CN`/`zh-TW`) before it
 * ever touches the request URL.
 *
 * SOFT FAILURE. A missing review is a 404, an unusable language is a 400, but a
 * translation that simply did not come back (upstream timeout, rate-limit, or shape
 * change) answers `{ ok: false, reason: "unavailable" }` with a short cache — the
 * client keeps showing the original text rather than erroring in front of a pupil.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { reviews } from "@/app/lib/reviews";
import { normalizeTargetLang, translateReviewBody } from "@/app/lib/reviews/translate";
import { NO_STORE } from "@/app/lib/social/request-guard";

/** Public, identity-free, CDN-cacheable — a translation is stable per (review, language). */
const PUBLIC_CACHE: Record<string, string> = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
};

/** Shorter cache for a soft miss, so a transient upstream blip self-heals within the hour. */
const SOFT_MISS_CACHE: Record<string, string> = {
  "Cache-Control": "public, s-maxage=60",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const reviewId = Number(id);
  // Guarded in JS: a non-numeric id would make Postgres raise 22P02 and turn a bad
  // request into a 500 — the same reason `helpful` and `report` pre-check it.
  if (!Number.isFinite(reviewId) || reviewId <= 0) {
    return Response.json({ ok: false, reason: "bad-id" }, { status: 400, headers: NO_STORE });
  }

  const target = normalizeTargetLang(new URL(req.url).searchParams.get("to"));
  if (!target) {
    return Response.json(
      { ok: false, reason: "bad-language" },
      { status: 400, headers: NO_STORE },
    );
  }

  let body: string | null;
  try {
    body = await reviews.visibleReviewBody(Math.trunc(reviewId));
  } catch (error) {
    // Schema behind the deploy, or a blip. Treat as "no review to translate".
    if (!isMissingColumnError(error)) {
      console.error("review translate lookup failed:", error);
    }
    return Response.json({ ok: false, reason: "unavailable" }, { status: 503, headers: NO_STORE });
  }

  if (body === null) {
    return Response.json({ ok: false, reason: "not-found" }, { status: 404, headers: NO_STORE });
  }

  const result = await translateReviewBody(body, target);
  if (!result) {
    return Response.json(
      { ok: false, reason: "unavailable" },
      { status: 502, headers: SOFT_MISS_CACHE },
    );
  }

  return Response.json(
    { ok: true, text: result.text, source: result.source, target },
    { headers: PUBLIC_CACHE },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
