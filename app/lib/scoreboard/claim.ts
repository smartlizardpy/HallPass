/**
 * HallPass Scoreboard — signed claim tokens.
 *
 * A claim token is a short-lived, tamper-proof handle for a single anonymous
 * score row. It lets a freshly-authenticated player "claim" a score they posted
 * as a guest, without the client being trusted to name an arbitrary `scoreId`.
 *
 * Like `guard.ts`, this module is pure and DB-free: it only mints and verifies
 * HMAC-signed strings from environment secrets, so it is safe to unit-test in a
 * plain Node environment (no `server-only`).
 *
 * Load-bearing decisions:
 *  - All `process.env` reads happen INSIDE the functions, never at module load,
 *    so tests can flip secrets per-case and routes pick up runtime config on
 *    Vercel — same discipline as `guard.ts`.
 *  - Signature comparison uses `timingSafeEqual` over the raw HMAC digests,
 *    which are fixed-length (32 bytes), so it can never throw on a length
 *    mismatch and timing cannot leak the secret — mirroring `guard.ts`.
 *  - The payload is JSON-encoded, then base64url-encoded whole. `boardId` is a
 *    game slug and can contain arbitrary characters; carrying it as a JSON
 *    string value means JSON escaping — not an ad-hoc delimiter — keeps fields
 *    apart. The only literal delimiter, `"."`, separates the two base64url
 *    halves and can never appear inside the base64url alphabet, so a crafted
 *    `boardId` cannot inject a delimiter or forge a different `scoreId`.
 *  - `verifyClaimToken` never throws: any malformed input, bad signature, or
 *    expiry returns `null`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Claim tokens are valid for six hours after issuance. */
export const CLAIM_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Upper bound on how many claim tokens a single claim request may present. */
export const MAX_CLAIM_TOKENS = 20;

/** Payload schema version, so the format can evolve without accepting old shapes. */
const PAYLOAD_VERSION = "1";

/** Shape of the JSON payload carried (base64url-encoded) in the first token half. */
interface ClaimPayload {
  /** Format version; must equal {@link PAYLOAD_VERSION}. */
  v: string;
  /** The `scores.id` being granted to the caller. */
  s: number;
  /** The board (game slug) the score belongs to. */
  b: string;
  /** Issued-at time in whole seconds since the Unix epoch. */
  iat: number;
}

/**
 * Resolve the HMAC signing secret from the pinned secret chain:
 * `SCOREBOARD_CLAIM_SECRET` → `AUTH_SECRET` → `SCOREBOARD_ADMIN_SECRET` →
 * `ADMIN_HTML_PASSWORD`. Returns `null` when none is set, which silently
 * disables the claim feature (mint returns `null`, verify rejects everything).
 * Read at call time so tests and Vercel pick up runtime config.
 */
export function claimSecret(): string | null {
  const secret = (
    process.env.SCOREBOARD_CLAIM_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.SCOREBOARD_ADMIN_SECRET ||
    process.env.ADMIN_HTML_PASSWORD
  )?.trim();
  return secret ? secret : null;
}

/** HMAC-SHA256 of `payload` under `secret`, returned as a raw 32-byte digest. */
function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

/**
 * Mint a signed claim token for `scoreId` on `boardId`.
 *
 * Wire format: `base64url(payloadJson) + "." + base64url(HMAC_SHA256(payloadJson, secret))`
 * where `payloadJson = JSON.stringify({ v, s, b, iat })`.
 *
 * Returns `null` when {@link claimSecret} is unset (feature off) or on any
 * unexpected failure — never throws.
 */
export function createClaimToken(scoreId: number, boardId: string, now?: number): string | null {
  try {
    const secret = claimSecret();
    if (!secret) return null;
    const payload: ClaimPayload = {
      v: PAYLOAD_VERSION,
      s: scoreId,
      b: boardId,
      iat: Math.floor((now ?? Date.now()) / 1000),
    };
    const payloadJson = JSON.stringify(payload);
    const payloadPart = Buffer.from(payloadJson, "utf8").toString("base64url");
    const sigPart = sign(payloadJson, secret).toString("base64url");
    return `${payloadPart}.${sigPart}`;
  } catch {
    return null;
  }
}

/**
 * Verify a claim token and return its `{ scoreId, boardId }`, or `null` when the
 * token is malformed, wrongly signed, or older than {@link CLAIM_MAX_AGE_MS}.
 *
 * The HMAC is recomputed over the decoded payload bytes and compared in constant
 * time before the payload is trusted or parsed. Never throws.
 */
export function verifyClaimToken(
  token: string,
  now?: number,
): { scoreId: number; boardId: string } | null {
  try {
    if (typeof token !== "string") return null;
    const secret = claimSecret();
    if (!secret) return null;

    const dot = token.indexOf(".");
    if (dot <= 0 || dot >= token.length - 1) return null;
    const payloadPart = token.slice(0, dot);
    const sigPart = token.slice(dot + 1);
    // A valid token has exactly one delimiter separating two base64url halves.
    if (sigPart.includes(".")) return null;

    const payloadJson = Buffer.from(payloadPart, "base64url").toString("utf8");
    const presentedSig = Buffer.from(sigPart, "base64url");
    const expectedSig = sign(payloadJson, secret);
    if (presentedSig.length !== expectedSig.length) return null;
    if (!timingSafeEqual(presentedSig, expectedSig)) return null;

    // Signature is valid: the payload is now trustworthy to parse.
    const parsed = JSON.parse(payloadJson) as Partial<ClaimPayload>;
    if (parsed.v !== PAYLOAD_VERSION) return null;
    if (typeof parsed.s !== "number" || !Number.isInteger(parsed.s)) return null;
    if (typeof parsed.b !== "string") return null;
    if (typeof parsed.iat !== "number" || !Number.isFinite(parsed.iat)) return null;

    const ageMs = (now ?? Date.now()) - parsed.iat * 1000;
    if (ageMs > CLAIM_MAX_AGE_MS) return null;

    return { scoreId: parsed.s, boardId: parsed.b };
  } catch {
    return null;
  }
}
