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
import { PLACEHOLDER_STEM } from "./display-name";

const HANDLE_ALLOWED = /[^A-Za-z0-9 _#-]/g;
const HANDLE_MAX_LENGTH = 12;

/**
 * A handle THIS CODE generated, rather than one a person typed.
 *
 * `sanitizeHandle` lets one through unchanged, length cap included — see there
 * for why that exemption has to exist. Anchored and four digits exactly, so it
 * matches what {@link guestHandle} mints and nothing longer.
 */
const GENERATED_HANDLE = new RegExp(`^${PLACEHOLDER_STEM}#\\d{4}$`);

/**
 * Generate an anonymous display handle: the same {@link PLACEHOLDER_STEM} a
 * signed-in player with no chosen name gets, plus four digits (1000–9999).
 * Used when no usable handle was supplied. `Math.random` is fine for a
 * non-security label.
 *
 * THE STEM IS SHARED WITH `display-name.ts` ON PURPOSE: a board should not read
 * as two populations, one called `Guest#…` and one called something else, when
 * the only difference between them is whether the player happened to be signed
 * in. The digits are random here rather than derived, because at submission time
 * a guest has no id to derive anything from — which is exactly why the result is
 * STORED in `scores.handle` and the SDK persists its own copy: randomness once,
 * then stability forever.
 *
 * `sdk/src/handle.ts` mints the same shape in the browser and is the copy that
 * usually wins, since the SDK sends a handle with every submission. The two must
 * agree; this one is the fallback for a submission that carries none.
 */
function guestHandle(): string {
  return `${PLACEHOLDER_STEM}#${Math.floor(1000 + Math.random() * 9000)}`;
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
 * `[A-Za-z0-9 _#-]`, trim, cap at {@link HANDLE_MAX_LENGTH} characters. When
 * nothing usable remains (empty, all-illegal, or a non-string), fall back to a
 * generated guest handle via {@link guestHandle}.
 *
 * ── THE ONE EXEMPTION, AND WHY IT IS NOT A HOLE ────────────────────────────
 *
 * A handle we generated passes through whole, cap and all. It has to: the SDK
 * mints one in the browser, persists it in `localStorage`, and RESENDS it with
 * every later score. The generated name is longer than the typed-input cap, so
 * without this the guest's second score would arrive as a truncated stub and the
 * player would watch their name change under them — and, because `getTopScores`
 * identifies a guest BY their handle string, would split into two leaderboard
 * rows.
 *
 * It is not a way to smuggle a long handle in: the pattern is anchored to the
 * exact shape this file mints, so the only thing it admits is a name this code
 * chose. What it does admit is somebody claiming a generated name that is not
 * theirs, which is the same collision a guest can already reach by chance and
 * which nothing treats as an identity.
 *
 * The cap still binds everything a person actually types.
 */
export function sanitizeHandle(input?: string): string {
  if (typeof input !== "string") return guestHandle();
  const allowed = input.replace(HANDLE_ALLOWED, "");
  const whole = allowed.trim();
  if (GENERATED_HANDLE.test(whole)) return whole;
  const cleaned = allowed.trim().slice(0, HANDLE_MAX_LENGTH).trim();
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
