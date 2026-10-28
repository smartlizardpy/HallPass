/**
 * HallPass referrals — `POST /api/v1/referrals/track`, body `{ kind }`.
 *
 * Counts a copy ("post_copy", "comment_copy", "link_copy", "message_copy") or an
 * invite-modal open. A daily tally with no player and no device, in our own
 * database (the growth panels' convention: exact, and unaffected by ad blockers).
 * Pays nothing, and says nothing about the caller.
 */

import { COUNTER_KINDS, type CounterKind } from "@/app/lib/referrals/store";
import { referralStore } from "@/app/lib/referrals";
import { NO_STORE, crossSite, fail } from "@/app/lib/referrals/http";

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  let kind: unknown;
  try {
    kind = ((await req.json()) as { kind?: unknown })?.kind;
  } catch {
    /* 400 below */
  }
  if (typeof kind !== "string" || !(COUNTER_KINDS as readonly string[]).includes(kind)) return fail(400, "Bad kind");
  try {
    await referralStore.track(kind as CounterKind);
  } catch (error) {
    console.error("referrals track failed:", error);
  }
  return Response.json({ ok: true }, { status: 200, headers: NO_STORE });
}
