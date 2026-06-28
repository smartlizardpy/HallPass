/**
 * Player handle (display name) storage and sanitisation.
 *
 * A "handle" is the short label shown next to a score. It is persisted in
 * `localStorage` under `hallpass:handle` so a returning player keeps their name
 * across sessions on the same origin.
 *
 * Anonymous players are NEVER prompted. The first time a name is needed and
 * nothing is stored, `ensureHandle` mints a stable `Guest#NNNN` handle (four
 * random digits, e.g. "Guest#4821"), PERSISTS it, and reuses it on every later
 * session — so an anonymous player keeps one consistent leaderboard name without
 * ever seeing a dialog.
 *
 * Load-bearing decisions:
 *  - Every storage touch is wrapped: a sandboxed/blocked `localStorage` throws
 *    `SecurityError` on access, so reads degrade to `null` and writes are
 *    best-effort (swallowed).
 *  - Handles are sanitised to `[A-Za-z0-9 _#-]`, 1..12 chars — the `#` is allowed
 *    so a generated `Guest#NNNN` name survives — and fall back to a freshly
 *    generated Guest handle, so neither storage nor the wire ever sees arbitrary
 *    input.
 *  - `window.prompt` is never called; there is no prompt path at all.
 */

/** localStorage key the handle is persisted under. */
const STORAGE_KEY = "hallpass:handle";

/** Max handle length enforced on read and write. ("Guest#4821" is 10 chars.) */
const MAX_LEN = 12;

export interface EnsureHandleOptions {
  /** Use this handle for the current submission only (not persisted). */
  handle?: string;
  /**
   * Back-compat only. Prompts have been removed, so this field is now IGNORED:
   * anonymous players always receive an auto-generated Guest handle and are
   * never shown a dialog regardless of this value.
   */
  promptHandle?: boolean;
}

/**
 * Mint a fresh anonymous handle of the form `Guest#NNNN`, where `NNNN` is a
 * random integer from 1000 to 9999 inclusive (always four digits). This is the
 * auto name given to a player who never chose one.
 */
export function generateGuestHandle(): string {
  const n = Math.floor(Math.random() * 9000) + 1000; // 1000..9999, four digits.
  return "Guest#" + n;
}

/**
 * Coerce arbitrary input into a safe handle: strip disallowed characters (the
 * `#` is kept so "Guest#NNNN" names survive), trim, cap at 12 chars, and fall
 * back to a freshly generated Guest handle if nothing usable remains.
 */
export function sanitizeHandle(value: unknown): string {
  try {
    const raw =
      typeof value === "string" ? value : value == null ? "" : String(value);
    const cleaned = raw
      .replace(/[^A-Za-z0-9 _#-]/g, "")
      .slice(0, MAX_LEN)
      .trim();
    return cleaned.length >= 1 ? cleaned : generateGuestHandle();
  } catch {
    return generateGuestHandle();
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
 * Resolve the handle to attach to a submission. Never prompts, never throws:
 *  1. An explicit `opts.handle` override (sanitised, NOT persisted).
 *  2. The stored handle from a previous session.
 *  3. Otherwise mint a fresh `Guest#NNNN` handle, PERSIST it (via `setHandle`)
 *     so it stays stable across sessions, and return it.
 * `opts.promptHandle` is accepted for back-compat but ignored — no dialog is
 * ever shown, so an anonymous player always gets a stable Guest name.
 */
export function ensureHandle(opts: EnsureHandleOptions = {}): string {
  if (typeof opts.handle === "string" && opts.handle.trim()) {
    return sanitizeHandle(opts.handle);
  }

  const stored = getHandle();
  if (stored) return stored;

  // Nothing stored and no prompt: give the anonymous player a stable Guest name
  // and persist it so the same name is reused on every later session.
  return setHandle(generateGuestHandle());
}
