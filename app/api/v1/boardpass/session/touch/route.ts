/**
 * "Keep Playing" — `POST /api/v1/boardpass/session/touch`.
 *
 * The ONLY thing that extends a lobby session. It is a deliberate tap, never a
 * background heartbeat, so an abandoned board cannot keep itself alive. It cannot
 * pass the 45-minute absolute limit.
 */

import { cookies } from "next/headers";
import { guardWrite, json } from "@/app/lib/boardpass/http";
import { touchSession } from "@/app/lib/boardpass/sessions";
import { BOARDPASS_COOKIE, hashSessionToken, isWellFormedToken } from "@/app/lib/boardpass/token";

export async function POST(req: Request): Promise<Response> {
  const blocked = await guardWrite(req);
  if (blocked) return blocked;
  const token = (await cookies()).get(BOARDPASS_COOKIE)?.value;
  if (!isWellFormedToken(token)) return json({ ok: false, error: "expired" }, 401);
  const times = await touchSession(hashSessionToken(token));
  return times ? json({ ok: true, ...times }) : json({ ok: false, error: "expired" }, 401);
}
