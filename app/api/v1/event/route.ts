/**
 * `GET /api/v1/event` — is the seasonal event on right now, for a GAME to ask.
 *
 * Public and cross-origin on purpose: games embedded on other origins read it
 * through the SDK's `getEvent()`. The body carries no player data, so a shared
 * cache may serve it to everyone. The cache window is short (30 s) so flipping
 * the dashboard switch reaches open games within about a minute.
 *
 * The answer is `resolveGameEvent` over the dashboard mode and the event config
 * (see `app/lib/events/game-event.ts` for what "off" means to a game).
 */

import { GAME_EVENT_THEME, resolveGameEvent } from "@/app/lib/events/game-event";
import { getGameEventMode } from "@/app/lib/events/game-event-mode";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
} as const;

export async function GET(): Promise<Response> {
  const mode = await getGameEventMode();
  return Response.json(resolveGameEvent(GAME_EVENT_THEME, mode, Date.now()), { headers: HEADERS });
}
