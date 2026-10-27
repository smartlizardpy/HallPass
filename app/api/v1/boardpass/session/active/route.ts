/**
 * Who's playing — `POST|DELETE /api/v1/boardpass/session/active`.
 *
 * POST `{ participantId, slug, day, tzOffsetMin }` binds the chosen player to the
 * game that is about to open. From then until DELETE (the game closed) scores and
 * achievements posted for THAT game credit that player — and no other game does.
 * It also records the play and the streak day for them, SERVER-SIDE, here: the
 * host-side beacons that normally do this run as a guest on a board. No device
 * streak seed is accepted — a shared board's localStorage is nobody's history.
 *
 *   409 busy   a different player or game is already bound; close that game first
 *   404        unknown game, or the seat is gone
 */

import { cookies } from "next/headers";
import { isMissingColumnError } from "@/app/lib/db";
import { isResolvedSlug } from "@/app/lib/games-store";
import { social } from "@/app/lib/social";
import { isMissingStreakSchema, streaks } from "@/app/lib/streak";
import { clampDay, parseTzOffset } from "@/app/lib/streak/server-core";
import { guardWrite, json, readObject } from "@/app/lib/boardpass/http";
import { bindActive, clearActive } from "@/app/lib/boardpass/sessions";
import { BOARDPASS_COOKIE, hashSessionToken, isWellFormedToken } from "@/app/lib/boardpass/token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tokenHash(): Promise<string | null> {
  const token = (await cookies()).get(BOARDPASS_COOKIE)?.value;
  return isWellFormedToken(token) ? hashSessionToken(token) : null;
}

export async function POST(req: Request): Promise<Response> {
  const blocked = await guardWrite(req);
  if (blocked) return blocked;
  const hash = await tokenHash();
  if (!hash) return json({ ok: false, error: "expired" }, 401);

  const body = await readObject(req);
  const participantId = typeof body?.participantId === "string" ? body.participantId : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!UUID.test(participantId) || !slug) return json({ ok: false, error: "bad-request" }, 400);

  if (!(await isResolvedSlug(slug))) return json({ ok: false, error: "not-found" }, 404);

  const bound = await bindActive({ tokenHash: hash, participantId, slug });
  if (!bound.ok) {
    return bound.reason === "busy"
      ? json({ ok: false, error: "busy" }, 409)
      : json({ ok: false, error: "not-found" }, 404);
  }

  // Best effort, like the beacons they replace: never fail the launch over these.
  try {
    await social.recordPlay(bound.playerId, slug);
  } catch (error) {
    if (!isMissingColumnError(error)) console.error("boardpass recordPlay failed:", error);
  }
  const day = clampDay(body?.day, Date.now());
  const tz = parseTzOffset(body?.tzOffsetMin);
  if (day !== null && tz !== null) {
    try {
      await streaks.recordDay(bound.playerId, day, tz);
    } catch (error) {
      if (!isMissingStreakSchema(error)) console.error("boardpass streak failed:", error);
    }
  }
  return json({ ok: true });
}

export async function DELETE(req: Request): Promise<Response> {
  const blocked = await guardWrite(req);
  if (blocked) return blocked;
  const hash = await tokenHash();
  if (hash) await clearActive(hash);
  return json({ ok: true });
}
