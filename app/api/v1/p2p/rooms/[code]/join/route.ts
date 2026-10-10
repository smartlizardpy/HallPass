/**
 * Ask to join a P2P room — `POST /api/v1/p2p/rooms/<code>/join`.
 *
 * Body: `{ gameId, gameVersion, secret, name }`. On success the server queues a
 * `join` signal for the host and answers `{ ok, peerId, hostId, token,
 * relayOnly, pollMs }`; the SDK then sends its WebRTC offer to `hostId` through
 * `…/signal` and waits for the host to accept or refuse. The HOST decides —
 * it re-checks capacity, lock and version itself — so a 200 here means "the host
 * will hear you", not "you are in".
 *
 * What this endpoint refuses up front, so a doomed join never wakes the host:
 *   404 `room-not-found`   no live room with that code for this game (an unknown
 *                          or not-visible game answers the same, by design)
 *   409 `version-mismatch` `{ hostVersion }` — the room runs another build
 *   409 `room-locked`      the host reported the room locked (or started+locked)
 *   409 `room-full`        the host reported every slot taken
 *   429 `rate-limited`     too many joins, or too many joins to rooms that do
 *                          not exist (the code-guessing signal), from this
 *                          player — or this IP, for guests
 *
 * The name is sanitised here as well as in the SDK; it travels to the host and
 * nowhere else.
 */

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
import { POLL_HINT_MS, RATE_LIMITS } from "@/app/lib/p2p/config";
import { mintSignalToken, signalSecret } from "@/app/lib/p2p/tokens";
import {
  derivePeerId,
  isValidGameId,
  isValidSecret,
  normalizeCode,
  sanitizeName,
  sanitizeVersion,
} from "@/sdk/p2p/src/codes";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  if (isP2PDisabled() || !signalSecret()) return unavailable();
  const code = normalizeCode((await params).code);
  const body = await readJsonBody(req);
  if (!code || !body || !isValidGameId(body.gameId) || !isValidSecret(body.secret)) {
    return fail(400, "bad-request");
  }
  const gameId = body.gameId;
  if (!(await canUseGame(gameId))) return fail(404, "room-not-found");

  const playerId = await currentPlayerId();
  const key = rateKey(req, playerId);
  const peerId = await derivePeerId(body.secret);
  const gameVersion = sanitizeVersion(body.gameVersion);

  try {
    const { joins, misses, room } = await p2pStore.lookupForJoin(gameId, code, key);
    if (joins >= RATE_LIMITS.join.maxPerWindow || misses >= RATE_LIMITS.miss.maxPerWindow) {
      return fail(429, "rate-limited");
    }
    if (!room) {
      await p2pStore.recordJoin(key, "miss");
      return fail(404, "room-not-found");
    }
    if (peerId === room.hostPeer) return fail(400, "bad-request");

    let refusal: string | null = null;
    if (room.gameVersion !== gameVersion) refusal = "version-mismatch";
    else if (room.locked) refusal = "room-locked";
    else if (room.full) refusal = "room-full";
    if (refusal) {
      await p2pStore.recordJoin(key, "join");
      return fail(409, refusal, refusal === "version-mismatch" ? { hostVersion: room.gameVersion } : undefined);
    }

    const token = mintSignalToken({ r: room.roomId, p: peerId, hp: room.hostPeer });
    if (!token) return unavailable();
    await p2pStore.recordJoin(key, "join", {
      roomId: room.roomId,
      to: room.hostPeer,
      from: peerId,
      body: { k: "join", name: sanitizeName(body.name), v: gameVersion },
    });
    return json({
      ok: true,
      peerId,
      hostId: room.hostPeer,
      token,
      relayOnly: room.relayOnly,
      pollMs: POLL_HINT_MS,
    });
  } catch (error) {
    return storeFailure("join room", error);
  }
}
