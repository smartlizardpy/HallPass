/**
 * Open a P2P room — `POST /api/v1/p2p/rooms`.
 *
 * Body: `{ gameId, gameVersion, secret, relayOnly? }`. The caller becomes the
 * room's host. `secret` is the client's private random value; the host's public
 * peer id is derived from it (`derivePeerId`), so nobody else can later present
 * that id. Answers `{ ok, code, peerId, token, relayOnly, pollMs }`, where
 * `token` authorises the host's polls of `…/rooms/<code>/signal`.
 *
 * The room exists for as long as the host keeps polling (see
 * `ROOM_TTL_SECONDS`). Nothing about the host is stored beyond its peer id, the
 * game version and its relay-only preference.
 *
 * Refusals: 400 `bad-request`, 404 `unknown-game`, 429 `rate-limited`,
 * 503 `unavailable` (feature off, migration not applied, no signing secret).
 */

import { randomBytes } from "node:crypto";
import { currentPlayerId } from "@/app/lib/social/request-guard";
import {
  canUseGame,
  fail,
  isP2PDisabled,
  json,
  p2pStore,
  rateKey,
  readJsonBody,
  storeFailure,
  unavailable,
} from "@/app/lib/p2p";
import { POLL_HINT_MS, isRelayForced } from "@/app/lib/p2p/config";
import { mintSignalToken, signalSecret } from "@/app/lib/p2p/tokens";
import {
  derivePeerId,
  generateCode,
  isValidGameId,
  isValidSecret,
  sanitizeVersion,
} from "@/sdk/p2p/src/codes";

/** Attempts at finding a free code before giving up (1M codes per game). */
const CODE_ATTEMPTS = 8;

export async function POST(req: Request): Promise<Response> {
  if (isP2PDisabled() || !signalSecret()) return unavailable();
  const body = await readJsonBody(req);
  if (!body || !isValidGameId(body.gameId) || !isValidSecret(body.secret)) {
    return fail(400, "bad-request");
  }
  const gameId = body.gameId;
  if (!(await canUseGame(gameId))) return fail(404, "unknown-game");

  const playerId = await currentPlayerId();
  const peerId = await derivePeerId(body.secret);
  const gameVersion = sanitizeVersion(body.gameVersion);
  const relayOnly = body.relayOnly === true || isRelayForced();

  try {
    if (!(await p2pStore.allowAttempt(rateKey(req, playerId), "create", true))) {
      return fail(429, "rate-limited");
    }
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      const code = generateCode();
      const roomId = randomBytes(16).toString("hex");
      const created = await p2pStore.createRoom({ gameId, code, roomId, hostPeer: peerId, gameVersion, relayOnly });
      if (created) {
        const token = mintSignalToken({ r: roomId, p: peerId, hp: peerId });
        if (!token) return unavailable();
        return json({ ok: true, code, peerId, token, relayOnly, pollMs: POLL_HINT_MS });
      }
    }
    console.error(`[p2p] no free room code for ${gameId} after ${CODE_ATTEMPTS} attempts`);
    return fail(503, "unavailable");
  } catch (error) {
    return storeFailure("create room", error);
  }
}
