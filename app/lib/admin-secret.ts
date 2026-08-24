/**
 * HallPass — constant-time secret checking for the server-to-server surfaces.
 *
 * PURE and free of `server-only`: no database, no `next/headers`, no clock. It
 * inspects untrusted request headers and compares them against environment
 * secrets, so it unit-tests in the plain `node` environment.
 *
 * ── WHY THIS IS ONE MODULE AND NOT THREE COPIES ────────────────────────────
 * The same fifteen lines — sha256 both sides to a fixed-length digest, then
 * `timingSafeEqual` — were written out in `admin-html-auth.ts` and in
 * `scoreboard/guard.ts`, and the alerts gate would have been the third. Both
 * copies already carried the same reasoning in their comments, which is the
 * clearest possible signal that the reasoning belongs in one place:
 *
 *   * HASHING FIRST IS NOT DECORATION. `timingSafeEqual` THROWS on buffers of
 *     different lengths, so comparing raw secrets would turn "the presented
 *     secret is the wrong length" into a 500 — and, worse, into a length oracle
 *     that answers faster than a real comparison. Two sha256 hex digests are
 *     always 64 characters, whatever went in.
 *   * THE ENVIRONMENT IS READ BY THE CALLER, NOT HERE. Every consumer reads
 *     `process.env` INSIDE its own function so a value set after import (on
 *     Vercel, or by a test) is seen, and passes the resolved expectation in.
 *
 * ── THREE OUTCOMES, NOT A BOOLEAN ──────────────────────────────────────────
 * "No secret is configured" and "the wrong secret was presented" are different
 * facts about different parties, and collapsing them is how a feature that was
 * never provisioned comes to look like a caller's mistake. {@link AdminAuthResult}
 * keeps them apart so a route can answer 503 for the first and 401 for the
 * second.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Outcome of a secret check, distinguishing "no secret set" from "wrong secret". */
export type AdminAuthResult = "ok" | "unauthorized" | "unconfigured";

/** Hex sha256. Exported because callers salt-and-hash with it too (`hashIp`). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Constant-time string equality. Both inputs are reduced to their 64-char
 * sha256 hex digests first, guaranteeing equal-length buffers for
 * `timingSafeEqual` regardless of the raw input lengths.
 */
export function timingSafeSecretEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(sha256Hex(a), "utf8");
  const bBuf = Buffer.from(sha256Hex(b), "utf8");
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Pull the presented secret from either `Authorization: Bearer <secret>` or a
 * named fallback header. Returns `null` when neither carries one.
 *
 * The fallback header differs per surface (`x-scoreboard-secret`,
 * `x-hallpass-alerts-secret`) because a leaked CI credential should be
 * traceable to the surface it was issued for; `Bearer` is the common form every
 * caller can use.
 */
export function presentedSecret(
  headers: Headers,
  fallbackHeader: string,
): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (bearer) {
      const token = bearer[1].trim();
      if (token) return token;
    }
  }
  const direct = headers.get(fallbackHeader)?.trim();
  if (direct) return direct;
  return null;
}

/**
 * The whole gate: resolve `expected` (already read from the environment by the
 * caller), find what was presented, and compare in constant time.
 *
 * A blank or absent `expected` is `"unconfigured"` — never `"ok"`. That ordering
 * is the load-bearing part: a deploy with no secret set must refuse everybody
 * rather than accept anybody, and an empty-string secret is the shape that
 * mistake takes in practice.
 */
export function verifySecret(
  expected: string | null | undefined,
  headers: Headers,
  fallbackHeader: string,
): AdminAuthResult {
  const want = expected?.trim();
  if (!want) return "unconfigured";
  const presented = presentedSecret(headers, fallbackHeader);
  if (!presented) return "unauthorized";
  return timingSafeSecretEqual(presented, want) ? "ok" : "unauthorized";
}
