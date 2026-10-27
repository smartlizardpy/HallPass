/**
 * Remove one player — `DELETE /api/v1/boardpass/session/participants/[id]`.
 *
 * `[id]` is a participant row id, and only a seat in THIS browser's live session
 * can be removed: the statement is scoped to the cookie's session, so one board
 * cannot remove another's players. The other players stay signed in.
 */

import { cookies } from "next/headers";
import { guardWrite, json } from "@/app/lib/boardpass/http";
import { removeParticipant } from "@/app/lib/boardpass/sessions";
import { BOARDPASS_COOKIE, hashSessionToken, isWellFormedToken } from "@/app/lib/boardpass/token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const blocked = await guardWrite(req);
  if (blocked) return blocked;
  const { id } = await params;
  const token = (await cookies()).get(BOARDPASS_COOKIE)?.value;
  if (!isWellFormedToken(token) || !UUID.test(id)) {
    return json({ ok: false, error: "not-found" }, 404);
  }
  const removed = await removeParticipant(hashSessionToken(token), id);
  return removed ? json({ ok: true }) : json({ ok: false, error: "not-found" }, 404);
}
