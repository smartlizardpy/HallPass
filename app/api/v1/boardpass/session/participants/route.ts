/**
 * Sign a player in to this board — `POST /api/v1/boardpass/session/participants`.
 *
 * Body `{ username, pin }`. Creates the board session on the first player, or
 * adds to the live one. See `app/lib/boardpass/login.ts` for the order of checks;
 * the answers here are deliberately few:
 *   200 { ok:true, participantId }   signed in
 *   401 { error:"invalid" }          unknown user, wrong PIN, locked, not enabled
 *   429 { error:"throttled" }        too many tries from this network
 *   409 { error:"duplicate"|"full"|"google-session" }
 * Nothing in the body or the timing says which of the 401 cases it was.
 */

import { cookies } from "next/headers";
import { currentPlayerId } from "@/app/lib/social/request-guard";
import { ipHashFor } from "@/app/lib/boardpass/attempts";
import { guardWrite, json, readObject } from "@/app/lib/boardpass/http";
import { attemptLogin } from "@/app/lib/boardpass/login";
import {
  BOARDPASS_COOKIE,
  hashSessionToken,
  isWellFormedToken,
  sessionCookieOptions,
} from "@/app/lib/boardpass/token";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const blocked = await guardWrite(req);
  if (blocked) return blocked;

  // A Google session and a board session never mix in one browser.
  if (await currentPlayerId()) {
    return json({ ok: false, error: "google-session" }, 409);
  }

  const body = await readObject(req);
  if (!body) return json({ ok: false, error: "invalid" }, 401);

  const jar = await cookies();
  const existing = jar.get(BOARDPASS_COOKIE)?.value;
  const outcome = await attemptLogin({
    username: body.username,
    pin: body.pin,
    ipHash: ipHashFor(req.headers),
    tokenHash: isWellFormedToken(existing) ? hashSessionToken(existing) : null,
  });

  switch (outcome.kind) {
    case "invalid":
      return json({ ok: false, error: "invalid" }, 401);
    case "throttled":
      return json({ ok: false, error: "throttled" }, 429);
    case "duplicate":
      return json({ ok: false, error: "duplicate" }, 409);
    case "full":
      return json({ ok: false, error: "full" }, 409);
    case "ok":
      if (outcome.newToken) {
        jar.set(BOARDPASS_COOKIE, outcome.newToken, sessionCookieOptions());
      }
      return json({ ok: true, participantId: outcome.participantId });
  }
}
