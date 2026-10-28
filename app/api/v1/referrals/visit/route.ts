/**
 * HallPass referrals — `POST /api/v1/referrals/visit`, body `{ token }`.
 *
 * A friend landed on `/fright-fest?fref=<token>`. The page is static (no cookies
 * or headers), so a small client island posts the token here. This counts the
 * visit (analytics only: nothing is paid for a click) and stores the token in a
 * first-party cookie, FIRST TOUCH: an existing cookie is never overwritten, so a
 * second link cannot steal the attribution. A signed-in visitor is attributed
 * straight away. The answer never says whether the token exists or whose it is.
 */

import { referralStore, tokenFromCookieHeader } from "@/app/lib/referrals";
import { normalizeReferralToken } from "@/app/lib/referrals/config";
import { NO_STORE, crossSite, fail, pendingCookie, referralPlayer } from "@/app/lib/referrals/http";

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  let token: string | null = null;
  try {
    token = normalizeReferralToken(((await req.json()) as { token?: unknown })?.token);
  } catch {
    /* falls through to the 400 below */
  }
  if (!token) return fail(400, "Bad token");

  const headers: Record<string, string> = { ...NO_STORE };
  const hadCookie = tokenFromCookieHeader(req.headers.get("cookie"));
  const effective = hadCookie ?? token;
  try {
    // A repeat visit with the same token (a refresh) is not a new visit.
    if (hadCookie !== token) await referralStore.recordVisit(token);
    const playerId = await referralPlayer("visit");
    if (playerId) await referralStore.claim(playerId, effective);
  } catch (error) {
    console.error("referrals visit failed:", error);
  }
  if (!hadCookie) headers["Set-Cookie"] = pendingCookie(req.url, token);
  return Response.json({ ok: true }, { status: 200, headers });
}
