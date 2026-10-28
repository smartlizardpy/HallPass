/**
 * Public play counter — `POST /api/v1/plays`.
 *
 * Adds one to a game's PERMANENT total (`game_play_totals`). This is the count
 * the site prints, replacing the rolling 30-day PostHog query that made a game's
 * plays disappear while its scores stayed.
 *
 * ANONYMOUS ON PURPOSE, unlike `/api/v1/me/plays`: `game_started` has always
 * counted guests, and a total that left them out would drop below the numbers
 * already shown. Nothing about the caller is read or stored — no cookie, no IP.
 *
 * Because it is unauthenticated it is gated the same way the social mutations
 * are: the referrer must be one of our own pages (`isTrustedOrigin`), which
 * closes the background-request path from a game running in the player frame.
 * It is NOT a defence against someone scripting the endpoint with a forged
 * referrer; a public counter has that ceiling. Honest traffic is one tiny upsert
 * per game open, the same cadence as `game_started`.
 *
 * Failure policy follows the other beacons: a bad request is 4xx, anything the
 * player cannot act on (database down, table not migrated yet) is still
 * `200 { recorded: false }` so a play never makes noise in their console.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { isResolvedSlug } from "@/app/lib/games-store";
import { playTotals } from "@/app/lib/play-totals";
import {
  NO_STORE,
  credentialedOptions,
  forbidden,
  isTrustedOrigin,
} from "@/app/lib/social/request-guard";

export async function POST(req: Request): Promise<Response> {
  if (!isTrustedOrigin(req)) return forbidden();

  let slug = "";
  try {
    const body = (await req.json()) as { slug?: unknown };
    slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  } catch {
    slug = "";
  }
  if (!slug) {
    return Response.json({ ok: false, recorded: false }, { status: 400, headers: NO_STORE });
  }

  try {
    // `isResolvedSlug`, not the static array: an external game is a real game.
    // It also bounds the table to the catalogue — no arbitrary slug can add a row.
    if (!(await isResolvedSlug(slug))) {
      return Response.json({ ok: false, recorded: false }, { status: 404, headers: NO_STORE });
    }
    await playTotals.recordPlay(slug);
    return Response.json({ ok: true, recorded: true }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("plays failed:", error);
    }
    return Response.json({ ok: true, recorded: false }, { headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
