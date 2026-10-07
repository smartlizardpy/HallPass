/**
 * The survey banner's data — `GET /api/v1/surveys/active`.
 *
 * Answers `{ survey: { slug, title } | null }` for the CURRENT player: the newest
 * live survey they have not answered yet, or `null`.
 *
 * A ROUTE HANDLER READ BY A CLIENT ISLAND, not a layout reading the session. The
 * pages this banner mounts on are statically prerendered and precached, and
 * everything per-viewer arrives from `/api/` (see `FeaturePromo`'s header);
 * reading the session in a layout would make every page dynamic for the sake of
 * one optional strip.
 *
 * SIGNED-OUT PLAYERS GET `null` WITHOUT A DATABASE READ. Surveys are for signed-in
 * players (one answer each, tied to the account), so a guest has nothing to be
 * shown and costs this route one cookie check. It is `no-store` because the
 * answer depends on who is asking.
 *
 * FAIL-SOFT. `getBannerSurvey` degrades a missing table to `null`, so a deploy
 * that ships before migration 037 shows no banner instead of an error on the
 * network tab of every page.
 */

import { getBannerSurvey } from "@/app/lib/surveys";
import { NO_STORE, credentialedOptions, currentPlayerId } from "@/app/lib/social/request-guard";

export async function GET(): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return Response.json({ survey: null }, { headers: NO_STORE });

  const banner = await getBannerSurvey(playerId);
  if (!banner || banner.answered) return Response.json({ survey: null }, { headers: NO_STORE });

  return Response.json(
    { survey: { slug: banner.slug, title: banner.title } },
    { headers: NO_STORE },
  );
}

export function OPTIONS(): Response {
  return credentialedOptions("GET, OPTIONS");
}
