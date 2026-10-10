/**
 * HallPass P2P — signaling tokens.
 *
 * `create` and `join` hand each peer a token that the `signal` endpoint accepts
 * WITHOUT a database read: the payload names the room instance (`room_id`), the
 * peer, the room's host, and whether the bearer is that host; the HMAC proves
 * the server minted it. Bound to `room_id` (random per room instance), not to
 * the 4-character code, so a token from a closed room is useless once the code
 * is reused.
 *
 * Wire format mirrors `scoreboard/claim.ts`:
 *   base64url(payloadJson) + "." + base64url(HMAC_SHA256(payloadJson, secret))
 *
 * Secret chain: `P2P_SIGNING_SECRET` → `AUTH_SECRET`. `AUTH_SECRET` is always set
 * where Auth.js works, so the feature needs no new secret to run; set the first
 * to rotate P2P tokens independently. With neither, minting returns `null` and
 * the routes answer 503.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignalTokenPayload {
  /** Format version. */
  v: 1;
  /** Room instance id. */
  r: string;
  /** The bearer's peer id. */
  p: string;
  /** The room host's peer id. */
  hp: string;
}

export function signalSecret(): string | null {
  const s = (process.env.P2P_SIGNING_SECRET || process.env.AUTH_SECRET)?.trim();
  return s ? s : null;
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", "hallpass-p2p-token:" + secret).update(payload, "utf8").digest();
}

export function mintSignalToken(p: Omit<SignalTokenPayload, "v">): string | null {
  const secret = signalSecret();
  if (!secret) return null;
  const json = JSON.stringify({ v: 1, r: p.r, p: p.p, hp: p.hp } satisfies SignalTokenPayload);
  return Buffer.from(json, "utf8").toString("base64url") + "." + sign(json, secret).toString("base64url");
}

/** The verified payload, or `null` for anything malformed, forged or unsigned. */
export function verifySignalToken(token: unknown): SignalTokenPayload | null {
  const secret = signalSecret();
  if (!secret || typeof token !== "string" || token.length > 512) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let json: string;
  try {
    json = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = sign(json, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(json) as Partial<SignalTokenPayload>;
    if (p.v !== 1 || typeof p.r !== "string" || typeof p.p !== "string" || typeof p.hp !== "string") {
      return null;
    }
    return { v: 1, r: p.r, p: p.p, hp: p.hp };
  } catch {
    return null;
  }
}
