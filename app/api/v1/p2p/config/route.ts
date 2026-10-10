/**
 * P2P client configuration — `GET /api/v1/p2p/config?game=<gameId>`.
 *
 * Called once by `HallPassP2P.connect()` (and again when TURN credentials are
 * about to expire). One round trip gives the SDK everything it needs before a
 * room exists:
 *
 *   - `self`: the signed-in player's PUBLIC display name, or `null` for a guest
 *     (the game's fallback name is used). This is `publicDisplayName()` — handle,
 *     else `@username`, else "Player" — and deliberately NOT `/api/v1/me`'s
 *     `handle`, which falls back to the Google account name: other players in a
 *     room must never see a child's real name. `avatarUrl` is `null` unless
 *     `SHARE_AVATAR_WITH_PEERS` is turned on (see `p2p/config.ts`).
 *   - `iceServers`: public STUN plus, when a provider is configured, TURN with
 *     credentials minted for this request and expiring at `iceExpiresAt`.
 *   - `turn`: whether TURN is in the list; `forceRelay`: whether the operator
 *     requires relay-only connections (`P2P_FORCE_RELAY`).
 *
 * Same-origin and cookie-credentialed (no CORS headers): a game served from
 * HallPass calls it directly. TURN minting is rate-limited per player/IP;
 * over the limit the answer is STUN only rather than an error.
 */

import { currentPlayerId } from "@/app/lib/social/request-guard";
import { publicDisplayName } from "@/app/lib/players";
import { isMissingColumnError, isUnconfiguredDbError } from "@/app/lib/db";
import { canUseGame, fail, isP2PDisabled, json, p2pStore, rateKey, unavailable } from "@/app/lib/p2p";
import { buildIceConfig, turnProvider } from "@/app/lib/p2p/ice";
import { SHARE_AVATAR_WITH_PEERS, isRelayForced } from "@/app/lib/p2p/config";
import { isValidGameId, sanitizeName } from "@/sdk/p2p/src/codes";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (isP2PDisabled()) return unavailable();
  const gameId = new URL(req.url).searchParams.get("game");
  if (!isValidGameId(gameId)) return fail(400, "bad-request");
  if (!(await canUseGame(gameId))) return fail(404, "unknown-game");

  const playerId = await currentPlayerId();

  let self: { name: string; avatarUrl: string | null } | null = null;
  if (playerId) {
    try {
      const fields = await p2pStore.playerNameFields(playerId);
      if (fields) {
        self = {
          name: sanitizeName(publicDisplayName(fields)),
          avatarUrl: SHARE_AVATAR_WITH_PEERS ? fields.image : null,
        };
      }
    } catch (error) {
      // A guest name is a fine answer; a missing identity never blocks play.
      if (!isMissingColumnError(error) && !isUnconfiguredDbError(error)) {
        console.error("[p2p] config identity read failed:", error);
      }
    }
  }

  let withTurn = turnProvider() !== null;
  if (withTurn) {
    try {
      withTurn = await p2pStore.allowAttempt(rateKey(req, playerId), "ice");
    } catch (error) {
      // Fail OPEN: without the table (migration not applied) players still get
      // relay; the TURN credential's own short lifetime bounds any abuse.
      if (!isMissingColumnError(error) && !isUnconfiguredDbError(error)) {
        console.error("[p2p] TURN rate-limit check failed:", error);
      }
    }
  }
  const ice = await buildIceConfig({ withTurn });

  return json({
    ok: true,
    self,
    iceServers: ice.iceServers,
    iceExpiresAt: ice.expiresAt,
    turn: ice.turn,
    forceRelay: isRelayForced(),
  });
}
