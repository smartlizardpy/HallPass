/**
 * Accept or dismiss one challenge — `PATCH /api/v1/me/challenges/<id>`.
 *
 * ── WHY BOTH LIVE ON ONE VERB ──────────────────────────────────────────────
 * They are the two ways the SAME row leaves the inbox, they take the same
 * guards, and the caller is one component with two buttons. Splitting them into
 * `/accept` and `/dismiss` sub-routes would duplicate the session read, the
 * origin check and the id parse for no gain.
 *
 * ── OWNERSHIP IS ENFORCED IN THE STATEMENT, NOT HERE ───────────────────────
 * Neither handler reads the row first to check it belongs to the caller. Both
 * store methods carry `target_id = <me>` inside their own `UPDATE`, so there is
 * no window between the check and the write, and "not yours" is indistinguishable
 * from "no such id" — which is the answer both should get anyway.
 *
 * ── NEITHER IS AN ERROR WHEN IT CHANGES NOTHING ────────────────────────────
 * Accepting twice, or dismissing something already dismissed, resolves `ok` with
 * `changed: false`. The player pressed a button and the world is now how they
 * wanted it; reporting that as a failure would be a lie about a double tap.
 */

import { challenges } from "@/app/lib/challenges";
import { isMissingColumnError } from "@/app/lib/db";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

const ACTIONS = ["accept", "dismiss"] as const;
type Action = (typeof ACTIONS)[number];

function toAction(value: unknown): Action | null {
  return (ACTIONS as readonly string[]).includes(String(value))
    ? (value as Action)
    : null;
}

function bad(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  const { id: rawId } = await params;
  const id = Number(rawId);
  // `Number.isSafeInteger` rather than a truthiness check: the column is BIGINT
  // and a value past 2^53 would arrive here already rounded, so it could not
  // name the row the caller meant.
  if (!Number.isSafeInteger(id) || id <= 0) return bad("bad-request", 400);

  let action: Action | null = null;
  try {
    const body = (await req.json()) as { action?: unknown };
    action = toAction(body.action);
  } catch {
    return bad("bad-request", 400);
  }
  if (!action) return bad("bad-request", 400);

  try {
    const changed =
      action === "accept"
        ? await challenges.accept(playerId, id)
        : await challenges.dismiss(playerId, id);
    // `changed: false` covers "already in that state" AND "not yours" — see the
    // header. Both are `ok`, because neither is something the player can act on
    // and neither left the world other than how they asked for it.
    return Response.json({ ok: true, changed }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error(`me/challenges PATCH ${action} failed:`, error);
    }
    return bad("unavailable", 503);
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("PATCH, OPTIONS");
}
