/**
 * Player handle (display name) storage and sanitisation.
 *
 * A "handle" is the short label shown next to a score. It is persisted in
 * `localStorage` under `hallpass:handle` so a returning player keeps their name
 * across sessions on the same origin.
 *
 * Load-bearing decisions:
 *  - Every storage touch is wrapped: a sandboxed/blocked `localStorage` throws
 *    `SecurityError` on access, so reads degrade to `null` and writes are
 *    best-effort (swallowed).
 *  - Handles are sanitised to `[A-Za-z0-9 _-]`, 1..12 chars, with an `"ANON"`
 *    fallback, so neither storage nor the wire ever sees arbitrary input.
 *  - `ensureHandle` may prompt the player exactly once; the prompt is wrapped so
 *    that a browser that blocks `window.prompt` (or throws) can never break a
 *    score submission.
 */

/** localStorage key the handle is persisted under. */
const STORAGE_KEY = "hallpass:handle";

/** Used whenever sanitisation yields nothing usable. */
const FALLBACK = "ANON";

/** Max handle length enforced on read, write, and prompt. */
const MAX_LEN = 12;

export interface EnsureHandleOptions {
  /** Use this handle for the current submission only (not persisted). */
  handle?: string;
  /** When nothing is stored, prompt once. Default `true`. */
  promptHandle?: boolean;
}

/**
 * Coerce arbitrary input into a safe handle: strip disallowed characters, trim,
 * cap at 12 chars, and fall back to `"ANON"` if nothing remains.
 */
export function sanitizeHandle(value: unknown): string {
  try {
    const raw =
      typeof value === "string" ? value : value == null ? "" : String(value);
    const cleaned = raw
      .replace(/[^A-Za-z0-9 _-]/g, "")
      .slice(0, MAX_LEN)
      .trim();
    return cleaned.length >= 1 ? cleaned : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** Read the stored handle, or `null` if absent/unreadable. */
export function getHandle(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && value.length ? value : null;
  } catch {
    return null;
  }
}

/** Sanitise and best-effort persist a handle; returns the sanitised value. */
export function setHandle(value: string): string {
  const handle = sanitizeHandle(value);
  try {
    window.localStorage.setItem(STORAGE_KEY, handle);
  } catch {
    // SecurityError / quota exceeded — keep going with the in-memory value.
  }
  return handle;
}

/**
 * Resolve the handle to attach to a submission:
 *  1. An explicit `opts.handle` override (sanitised, NOT persisted).
 *  2. The stored handle.
 *  3. A one-time prompt (unless `promptHandle === false` or unavailable).
 *  4. `"ANON"`.
 * Never throws.
 */
export function ensureHandle(opts: EnsureHandleOptions = {}): string {
  if (typeof opts.handle === "string" && opts.handle.trim()) {
    return sanitizeHandle(opts.handle);
  }

  const stored = getHandle();
  if (stored) return stored;

  if (opts.promptHandle !== false) {
    const prompted = promptForHandle();
    if (prompted) return setHandle(prompted);
  }

  return FALLBACK;
}

/** Prompt once for initials, fully guarded. Returns `null` if unavailable/cancelled. */
function promptForHandle(): string | null {
  try {
    if (typeof window === "undefined" || typeof window.prompt !== "function") {
      return null;
    }
    const answer = window.prompt(
      "Enter a name for the leaderboard (up to 12 characters):",
      "",
    );
    if (answer == null) return null; // Cancelled.
    return sanitizeHandle(answer);
  } catch {
    return null;
  }
}
