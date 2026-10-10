/**
 * Room codes, peer ids and the small vocabulary both the browser SDK and the
 * HallPass signaling routes must agree on.
 *
 * Pure and dependency-free: the server imports this file (`@/sdk/p2p/src/codes`)
 * so the alphabet, the limits and the peer-id derivation can never drift apart.
 * Like `sdk/src/contract.ts`, nothing here may import server code.
 */

/** Unambiguous alphabet: no I, O, 0 or 1. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;

/** Hard cap on players in one room (full mesh). */
export const MAX_PLAYERS = 8;

/** The demo page's game id; the server accepts it alongside real game slugs. */
export const DEMO_GAME_ID = "hallpass-p2p-demo";

const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PEER_ID_RE = /^[a-z2-7]{12}$/;

/** Random integer in [0, n) from the platform CSPRNG. */
function randomInt(n: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % n;
}

/** A fresh room code. 32 divides 2^32, so the modulo is unbiased. */
export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * Normalise what a player typed: trim, uppercase, drop spaces and dashes.
 * Returns `null` when the result is not a well-formed code (the look-alikes
 * I, O, 0 and 1 are not in the alphabet, so they never appear in a real code).
 */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(code) ? code : null;
}

export function isValidGameId(id: unknown): id is string {
  return typeof id === "string" && GAME_ID_RE.test(id);
}

export function isValidPeerId(id: unknown): id is string {
  return typeof id === "string" && PEER_ID_RE.test(id);
}

/** A random secret, 128 bits as hex. The peer id is derived from it. */
export function generateSecret(): string {
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function isValidSecret(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * The public peer id for a private secret: the first 60 bits of
 * SHA-256("hallpass-p2p:" + secret), base32. The server recomputes it from the
 * secret a client presents when it creates or joins a room, so a client can
 * only ever obtain a signaling token for an id it holds the preimage of — it
 * cannot claim another player's id and take over their reconnect.
 */
export async function derivePeerId(secret: string): Promise<string> {
  const data = new TextEncoder().encode("hallpass-p2p:" + secret);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; out.length < 12; ) {
    if (bits < 5) {
      value = (value << 8) | digest[i++];
      bits += 8;
    }
    out += B32[(value >>> (bits - 5)) & 31];
    bits -= 5;
  }
  return out;
}

/** Display-name rule shared by both sides: printable, single-spaced, ≤ 24 chars. */
export function sanitizeName(input: unknown, fallback = "Player"): string {
  if (typeof input !== "string") return fallback;
  const clean = input
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
  return clean || fallback;
}

/** Game version strings are opaque but bounded. */
export function sanitizeVersion(input: unknown): string {
  return typeof input === "string" ? input.trim().slice(0, 32) : "";
}
