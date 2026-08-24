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
 *  - Admin-secret comparison lives in `app/lib/admin-secret.ts`, shared with the
 *    site admin login and the alerts gate: hash both sides to a fixed-length
 *    sha256 hex digest first, then `timingSafeEqual`, so a length mismatch can
 *    never throw and timing cannot leak the secret. This module keeps only the
 *    part that is scoreboard-specific — WHICH env vars are accepted, and the
 *    header they may be presented in.
 *  - IPs are never stored in the clear: `hashIp` salts with a dedicated salt
 *    (falling back to the admin secret/password) before hashing, so the
 *    `scores.ip_hash` column is a one-way pseudonym used only for rate-limit
 *    bucketing.
 */

import {
  sha256Hex,
  verifySecret,
  type AdminAuthResult,
} from "@/app/lib/admin-secret";
import { GLOBAL_MAX_SCORE } from "./config";

const HANDLE_ALLOWED = /[^A-Za-z0-9 _#-]/g;
const HANDLE_MAX_LENGTH = 12;

/**
 * Generate an anonymous display handle of the form `Guest####` (four digits,
 * 1000–9999). Used when no usable handle was supplied; replaces the old
 * static `"ANON"` fallback. `Math.random` is fine for a non-security label.
 */
function guestHandle(): string {
  return `Guest#${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Last-resort salt for {@link hashIp} when neither `SCOREBOARD_IP_SALT` nor
 * `SCOREBOARD_ADMIN_SECRET` is set. Not secret, but it keeps `ip_hash` from
 * being a bare `sha256(ip)` that a precomputed table could trivially reverse.
 */
const IP_HASH_FALLBACK_PEPPER = "hallpass-scoreboard-ip-pepper-v1";

/** Re-exported so the scoreboard's callers keep importing it from here. */
export type { AdminAuthResult };

/**
 * The scoreboard's own secret header, alongside `Authorization: Bearer`.
 *
 * Named per surface rather than shared: a credential presented in
 * `x-scoreboard-secret` was issued for board provisioning, and one in
 * `x-hallpass-alerts-secret` for the alerts cron. If either leaks, the header it
 * arrives in says which one it was.
 */
const SCOREBOARD_SECRET_HEADER = "x-scoreboard-secret";

/**
 * Reduce arbitrary user input to a safe display handle: keep only
 * `[A-Za-z0-9 _#-]`, trim, cap at 12 characters. When nothing usable remains
 * (empty, all-illegal, or a non-string), fall back to a generated guest handle
 * (`Guest#` + four random digits) via {@link guestHandle}. An already-valid
 * handle such as `"Guest#4821"` passes through unchanged since `#` is allowed.
 */
export function sanitizeHandle(input?: string): string {
  if (typeof input !== "string") return guestHandle();
  const cleaned = input
    .replace(HANDLE_ALLOWED, "")
    .trim()
    .slice(0, HANDLE_MAX_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : guestHandle();
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
 * `SCOREBOARD_IP_SALT`, falling back to `SCOREBOARD_ADMIN_SECRET`, then
 * `ADMIN_HTML_PASSWORD`, then a constant app pepper, so the digest is never a
 * bare `sha256(ip)` that a precomputed table could reverse.
 */
export function hashIp(ip: string): string {
  const salt =
    process.env.SCOREBOARD_IP_SALT ||
    process.env.SCOREBOARD_ADMIN_SECRET ||
    process.env.ADMIN_HTML_PASSWORD ||
    IP_HASH_FALLBACK_PEPPER;
  return sha256Hex(ip + salt);
}

/**
 * Gate the admin board endpoints. The accepted secret is `SCOREBOARD_ADMIN_SECRET`
 * if set, otherwise the site admin password `ADMIN_HTML_PASSWORD` — so an operator
 * can provision boards with the same password they already use for this site's
 * admin, without juggling a second secret. Set `SCOREBOARD_ADMIN_SECRET` only to
 * decouple the two.
 *  - `"unconfigured"` — neither secret nor admin password is set; the caller
 *    should answer 503 (the feature is not provisioned, not a client error).
 *  - `"unauthorized"` — a secret is required but missing or wrong (→ 401).
 *  - `"ok"` — presented secret matches in constant time.
 */
export function verifyAdminSecret(headers: Headers): AdminAuthResult {
  return verifySecret(
    process.env.SCOREBOARD_ADMIN_SECRET || process.env.ADMIN_HTML_PASSWORD,
    headers,
    SCOREBOARD_SECRET_HEADER,
  );
}
