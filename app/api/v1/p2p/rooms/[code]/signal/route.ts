/**
 * Send and receive P2P signaling messages — `POST /api/v1/p2p/rooms/<code>/signal`.
 *
 * Body: `{ token, after?, send?: [{ to, data }], state?: { locked, full }, bye? }`.
 * Answers `{ ok, alive, messages: [{ id, from, data }] }`.
 *
 * One request does a whole poll: acknowledge (delete) every message up to
 * `after`, queue `send`, and return what is waiting for the caller. The SDK
 * passes the highest `id` it has processed as the next `after`, so a response
 * lost in transit is simply delivered again.
 *
 * WHO MAY TALK TO WHOM. The token names the bearer and the room's host. The host
 * may message anyone; everyone else may message only the host. Peer-to-peer
 * signaling between two guests is relayed by the host over its data channels,
 * so it never needs this endpoint — which keeps a guest from using a room
 * mailbox to reach strangers.
 *
 * The host's polls are its heartbeat: they refresh `host_seen_at` and record its
 * lobby `state`, which `join` reads to refuse a locked or full room early.
 * `bye: true` from the host deletes the room. `alive: false` tells a client the
 * room is gone.
 *
 * `<code>` in the path is informational; the token alone authorises.
 */

import {
  fail,
  isP2PDisabled,
  json,
  p2pStore,
  readJsonBody,
  storeFailure,
  unavailable,
} from "@/app/lib/p2p";
import { MAX_SIGNAL_BYTES, MAX_SIGNALS_PER_REQUEST } from "@/app/lib/p2p/config";
import { verifySignalToken } from "@/app/lib/p2p/tokens";
import { isValidPeerId } from "@/sdk/p2p/src/codes";

/** Largest body accepted: a full batch of maximal messages plus framing. */
const MAX_BODY_BYTES = MAX_SIGNALS_PER_REQUEST * MAX_SIGNAL_BYTES + 4096;

export async function POST(req: Request): Promise<Response> {
  if (isP2PDisabled()) return unavailable();
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body) return fail(400, "bad-request");
  const tok = verifySignalToken(body.token);
  if (!tok) return fail(401, "bad-token");
  const isHost = tok.p === tok.hp;

  const after = body.after === undefined ? 0 : Number(body.after);
  if (!Number.isSafeInteger(after) || after < 0) return fail(400, "bad-request");

  const rawSend = body.send === undefined ? [] : body.send;
  if (!Array.isArray(rawSend) || rawSend.length > MAX_SIGNALS_PER_REQUEST) return fail(400, "bad-request");
  const outgoing: { to: string; body: unknown }[] = [];
  for (const m of rawSend) {
    const to = (m as { to?: unknown } | null)?.to;
    const data = (m as { data?: unknown } | null)?.data;
    if (!isValidPeerId(to) || to === tok.p || data === undefined) return fail(400, "bad-request");
    if (!isHost && to !== tok.hp) return fail(403, "forbidden");
    if (JSON.stringify(data).length > MAX_SIGNAL_BYTES) return fail(413, "too-large");
    outgoing.push({ to, body: data });
  }

  let state: { locked: boolean; full: boolean } | null = null;
  if (isHost && body.state && typeof body.state === "object") {
    const s = body.state as { locked?: unknown; full?: unknown };
    state = { locked: s.locked === true, full: s.full === true };
  }

  try {
    if (body.bye === true && isHost) {
      await p2pStore.closeRoom(tok.r, tok.p);
      return json({ ok: true, alive: false, messages: [] });
    }
    const res = await p2pStore.poll({ roomId: tok.r, peerId: tok.p, isHost, after, outgoing, state });
    return json({ ok: true, alive: res.alive, messages: res.messages });
  } catch (error) {
    return storeFailure("signal", error);
  }
}
