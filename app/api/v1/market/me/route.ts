/** Hall Tokens wallet — `GET /api/v1/market/me`: balance, recent ledger and the shelf. Credentialed, no-store. */

import { getMyTokens } from "@/app/lib/hall-tokens";
import { fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";

export async function GET(): Promise<Response> {
  const playerId = await sessionPlayerId("market me");
  if (!playerId) return fail(401, "Sign in required");
  return json(await getMyTokens(playerId), 200);
}
