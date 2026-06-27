/**
 * HallPass Scoreboard — request validation, IP hashing, and admin auth.
 *
 * Everything here defends the write path. None of it touches the database; it
 * only inspects untrusted request data and environment secrets, so it is safe
 * to unit-test in a plain Node environment (no `server-only`).
 *
 * Load-bearing decisions:
 *  - All `process.env` reads happen INSIDE the functions, never at module load,
 *    so tests can flip `SCOREBOARD_ADMIN_SECRET` per-case and routes pick up
 *    runtime config on Vercel.
 *  - Admin-secret comparison mirrors `app/lib/admin-html-auth.ts`: hash both
 *    sides to a fixed-length sha256 hex digest first, then `timingSafeEqual`,
 *    so a length mismatch can never throw and timing cannot leak the secret.
 *  - IPs are never stored in the clear: `hashIp` salts with a dedicated salt
 *    (falling back to the admin secret) before hashing, so the `scores.ip_hash`
 *    column is a one-way pseudonym used only for rate-limit bucketing.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { GLOBAL_MAX_SCORE } from "./config";

const HANDLE_ALLOWED = /[^A-Za-z0-9 _-]/g;
const HANDLE_MAX_LENGTH = 12;
const FALLBACK_HANDLE = "ANON";

/**
 * Last-resort salt for {@link hashIp} when neither `SCOREBOARD_IP_SALT` nor
 * `SCOREBOARD_ADMIN_SECRET` is set. Not secret, but it keeps `ip_hash` from
 * being a bare `sha256(ip)` that a precomputed table could trivially reverse.
 */
const IP_HASH_FALLBACK_PEPPER = "hallpass-scoreboard-ip-pepper-v1";

/** Outcome of an admin-secret check, distinguishing "no secret set" from "wrong secret". */
export type AdminAuthResult = "ok" | "unauthorized" | "unconfigured";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Constant-time string equality. Both inputs are reduced to their 64-char
 * sha256 hex digests first, guaranteeing equal-length buffers for
 * `timingSafeEqual` regardless of the raw input lengths.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(sha256Hex(a), "utf8");
  const bBuf = Buffer.from(sha256Hex(b), "utf8");
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Reduce arbitrary user input to a safe display handle: keep only
 * `[A-Za-z0-9 _-]`, trim, cap at 12 characters, and fall back to `"ANON"` when
 * nothing usable remains.
 */
export function sanitizeHandle(input?: string): string {
  if (typeof input !== "string") return FALLBACK_HANDLE;
  const cleaned = input
    .replace(HANDLE_ALLOWED, "")
    .trim()
    .slice(0, HANDLE_MAX_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : FALLBACK_HANDLE;
}

/**
 * Type-guard for an acceptable score: a finite, non-negative number that does
 * not exceed the board's `maxScore` (or {@link GLOBAL_MAX_SCORE} when the board
 * sets no ceiling).
 */
export function isValidScore(score: unknown, maxScore?: number | null): score is number {
  if (typeof score !== "number" || !Number.isFinite(score)) return false;
  if (score < 0) return false;
  const cap = maxScore ?? GLOBAL_MAX_SCORE;
  return score <= cap;
}

/**
 * Derive a stable per-client key from proxy headers: the first hop of
 * `x-forwarded-for`, else `x-real-ip`, else the literal `"unknown"`. The raw
 * value is never persisted — feed it to {@link hashIp} first.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim();
    if (firstHop) return firstHop;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

/**
 * One-way hash of a client key for the `scores.ip_hash` column. Salts with
 * `SCOREBOARD_IP_SALT`, falling back to `SCOREBOARD_ADMIN_SECRET`, then to a
 * constant app pepper, so the digest is never a bare `sha256(ip)` that a
 * precomputed table could reverse.
 */
export function hashIp(ip: string): string {
  const salt =
    process.env.SCOREBOARD_IP_SALT ||
    process.env.SCOREBOARD_ADMIN_SECRET ||
    IP_HASH_FALLBACK_PEPPER;
  return sha256Hex(ip + salt);
}

/**
 * Pull the presented admin secret from either `Authorization: Bearer <secret>`
 * or `X-Scoreboard-Secret: <secret>`. Returns `null` when neither is present.
 */
function presentedSecret(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (bearer) {
      const token = bearer[1].trim();
      if (token) return token;
    }
  }
  const direct = headers.get("x-scoreboard-secret")?.trim();
  if (direct) return direct;
  return null;
}

/**
 * Gate the admin board endpoints.
 *  - `"unconfigured"` — `SCOREBOARD_ADMIN_SECRET` is unset; the caller should
 *    answer 503 (the feature is not provisioned, not a client error).
 *  - `"unauthorized"` — a secret is required but missing or wrong (→ 401).
 *  - `"ok"` — presented secret matches in constant time.
 */
export function verifyAdminSecret(headers: Headers): AdminAuthResult {
  const expected = process.env.SCOREBOARD_ADMIN_SECRET?.trim();
  if (!expected) return "unconfigured";
  const presented = presentedSecret(headers);
  if (!presented) return "unauthorized";
  return safeEqual(presented, expected) ? "ok" : "unauthorized";
}
