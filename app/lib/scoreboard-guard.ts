import "server-only";

/**
 * Shared validation / anti-cheat helpers for the leaderboard write path.
 *
 * ANTI-CHEAT (v1 — intentionally simple, honest about its limits):
 *   - Slug must be a registered game (checked in the route via `games`).
 *   - Board must already be initialized (PUT can't create — see scoreboard.ts).
 *   - Server-side score cap (MAX_SCORE) rejects absurd values.
 *   - Handle sanitization to a tight charset.
 *   - Best-effort per-IP token-bucket rate limiter (below).
 *
 * NOT durable: the rate limiter lives in module memory. On serverless this is
 * per-instance and resets on cold start, so it only blunts naive floods.
 *
 * TODO(v1.1 hardening): issue a short-lived, single-use HMAC-signed session
 * token when a game starts and require it on submit. That makes replay/scripted
 * submissions much harder and gives a durable, per-session rate limit. Not
 * implemented here on purpose.
 */

/**
 * Global score ceiling. Generous so it never rejects a legitimate high score.
 * TODO(per-game-caps): move this to a per-game value on the Game type so e.g.
 * a clicker can allow far higher numbers than a timed runner.
 */
export const MAX_SCORE = 1e9;

const HANDLE_RE = /^[A-Za-z0-9 _-]{1,12}$/;
export const DEFAULT_HANDLE = "ANON";

/** Sanitize a handle to [A-Za-z0-9 _-]{1,12}; falls back to "ANON". */
export function sanitizeHandle(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_HANDLE;
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_HANDLE;
  // Strip disallowed chars, then clamp length.
  const cleaned = trimmed.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 12).trim();
  if (!cleaned || !HANDLE_RE.test(cleaned)) return DEFAULT_HANDLE;
  return cleaned;
}

/** Validate a submitted score: finite number within [0, MAX_SCORE]. */
export function isValidScore(score: unknown): score is number {
  return (
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= MAX_SCORE
  );
}

/* ----------------------------- rate limiter ----------------------------- */

type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();

const BUCKET_CAPACITY = 10; // burst allowance per key
const REFILL_PER_SEC = 0.2; // ~1 token / 5s sustained
const BUCKET_TTL_MS = 10 * 60 * 1000; // evict idle keys after 10 min

/**
 * Best-effort token-bucket. Returns true if the request is allowed.
 * NON-DURABLE: per-process memory only (see file header). A few requests may
 * slip through across instances; that's acceptable for v1.
 */
export function allowSubmit(key: string, now = Date.now()): boolean {
  // Opportunistic cleanup to bound memory.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (now - b.updated > BUCKET_TTL_MS) buckets.delete(k);
    }
  }

  const existing = buckets.get(key);
  if (!existing) {
    buckets.set(key, { tokens: BUCKET_CAPACITY - 1, updated: now });
    return true;
  }

  const elapsedSec = (now - existing.updated) / 1000;
  const refilled = Math.min(
    BUCKET_CAPACITY,
    existing.tokens + elapsedSec * REFILL_PER_SEC
  );

  if (refilled < 1) {
    existing.tokens = refilled;
    existing.updated = now;
    return false;
  }

  existing.tokens = refilled - 1;
  existing.updated = now;
  return true;
}

/** Derive a rate-limit key from request headers (best-effort client IP). */
export function clientKeyFromHeaders(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
