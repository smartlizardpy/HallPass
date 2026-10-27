/**
 * Board session state — `GET|DELETE /api/v1/boardpass/session`.
 *
 * GET tells the board page what to show: `unavailable` (BoardPass is off or not
 * configured), `google-session` (a normal Google sign-in lives in this browser, so
 * Board Mode refuses to mix with it), `none` (no live session), or `active` with
 * the roster and expiry times. It never extends the session: reading state must
 * not keep a board alive. It answers 200 even when BoardPass is off, so the page
 * can say so; it reveals nothing about any account.
 *
 * DELETE ends the whole session and clears the cookie ("End Session").
 */

import { cookies } from "next/headers";
import { currentPlayerId } from "@/app/lib/social/request-guard";
import { getBoardPassMode } from "@/app/lib/boardpass/mode";
import { isPinConfigured } from "@/app/lib/boardpass/pin";
import { endSession, getLiveSession } from "@/app/lib/boardpass/sessions";
import {
  BOARDPASS_COOKIE,
  clearedCookieOptions,
  hashSessionToken,
  isWellFormedToken,
} from "@/app/lib/boardpass/token";
import { guardWrite, json } from "@/app/lib/boardpass/http";

export async function GET(): Promise<Response> {
  if ((await getBoardPassMode()) === "off" || !isPinConfigured()) {
    return json({ state: "unavailable" });
  }
  if (await currentPlayerId()) return json({ state: "google-session" });

  const token = (await cookies()).get(BOARDPASS_COOKIE)?.value;
  if (!isWellFormedToken(token)) return json({ state: "none" });
  const live = await getLiveSession(hashSessionToken(token));
  if (!live) {
    // Expired or ended: tell the browser to drop the dead cookie.
    const res = json({ state: "none", expired: true });
    res.headers.append(
      "Set-Cookie",
      `${BOARDPASS_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
        process.env.NODE_ENV === "production" ? "; Secure" : ""
      }`,
    );
    return res;
  }
  return json({ state: "active", session: live });
}

export async function DELETE(req: Request): Promise<Response> {
  const blocked = await guardWrite(req);
  if (blocked) return blocked;
  const jar = await cookies();
  const token = jar.get(BOARDPASS_COOKIE)?.value;
  if (isWellFormedToken(token)) await endSession(hashSessionToken(token));
  jar.set(BOARDPASS_COOKIE, "", clearedCookieOptions());
  return json({ ok: true });
}
