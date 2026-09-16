/**
 * Player handle (display name) storage and sanitisation.
 *
 * A "handle" is the short label shown next to a score. It is persisted in
 * `localStorage` under `hallpass:handle` so a returning player keeps their name
 * across sessions on the same origin.
 *
 * Anonymous players are NEVER prompted. The first time a name is needed and
 * nothing is stored, `ensureHandle` mints a stable `SigmaAlphaMale#NNNN` handle
 * (four random digits, e.g. "SigmaAlphaMale#4821"), PERSISTS it, and reuses it on
 * every later session — so an anonymous player keeps one consistent leaderboard
 * name without ever seeing a dialog.
 *
 * Load-bearing decisions:
 *  - Every storage touch is wrapped: a sandboxed/blocked `localStorage` throws
 *    `SecurityError` on access, so reads degrade to `null` and writes are
 *    best-effort (swallowed).
 *  - Handles are sanitised to `[A-Za-z0-9 _#-]`, 1..12 chars, and fall back to a
 *    freshly generated one, so neither storage nor the wire ever sees arbitrary
 *    input. A handle THIS FILE generated is exempt from the length cap — it is
 *    longer than 12 characters and has to survive being read back, see
 *    `sanitizeHandle`.
 *  - The generated shape is mirrored by `sanitizeHandle` in
 *    `app/lib/scoreboard/guard.ts`, which mints the same name server-side for a
 *    submission that carries no handle at all. THE TWO MUST AGREE; the stem is
 *    also what a signed-in player with no chosen name is published under, so a
 *    board does not read as two populations.
 *  - `window.prompt` is never called; there is no prompt path at all.
 */

/** localStorage key the handle is persisted under. */
const STORAGE_KEY = "hallpass:handle";

/** Max length enforced on read and write for a handle a PERSON typed. */
const MAX_LEN = 12;

/**
 * The stem of every handle this file mints. Shared verbatim with the server (see
 * the module docblock) and with the name a signed-in player who never chose one
 * is published under.
 */
const GUEST_STEM = "SigmaAlphaMale";

/**
 * A handle THIS CODE generated, as opposed to one somebody typed. Anchored and
 * exactly four digits, so it admits the shape below and nothing longer.
 */
const GENERATED = /^SigmaAlphaMale#\d{4}$/;

export interface EnsureHandleOptions {
  /** Use this handle for the current submission only (not persisted). */
  handle?: string;
  /**
   * Back-compat only. Prompts have been removed, so this field is now IGNORED:
   * anonymous players always receive an auto-generated handle and are never
   * shown a dialog regardless of this value.
   */
  promptHandle?: boolean;
}

/**
 * Mint a fresh anonymous handle of the form `SigmaAlphaMale#NNNN`, where `NNNN`
 * is a random integer from 1000 to 9999 inclusive (always four digits). This is
 * the auto name given to a player who never chose one.
 *
 * Random once, then STABLE: the result is persisted by `ensureHandle`, so the
 * same anonymous player keeps the same name across sessions. Two guests drawing
 * the same number is possible and is not treated as a problem — this is a label,
 * not an identity, and nothing keys off it.
 */
export function generateGuestHandle(): string {
  const n = Math.floor(Math.random() * 9000) + 1000; // 1000..9999, four digits.
  return GUEST_STEM + "#" + n;
}

/**
 * Coerce arbitrary input into a safe handle: strip disallowed characters (the
 * `#` is kept), trim, cap at {@link MAX_LEN} chars, and fall back to a freshly
 * generated handle if nothing usable remains.
 *
 * A handle this file generated passes through WHOLE, past the cap. That is not a
 * loophole, it is the round trip working: the generated name is longer than the
 * cap, it is what `ensureHandle` persisted, and it is read back through here on
 * every later session. Truncating it would rename the player mid-session and —
 * because the server identifies a guest by their handle string — split them into
 * two leaderboard rows. The pattern is anchored to the exact shape minted above,
 * so the only thing it admits is a name this code chose.
 */
export function sanitizeHandle(value: unknown): string {
  try {
    const raw =
      typeof value === "string" ? value : value == null ? "" : String(value);
    const allowed = raw.replace(/[^A-Za-z0-9 _#-]/g, "");
    const whole = allowed.trim();
    if (GENERATED.test(whole)) return whole;
    const cleaned = allowed.slice(0, MAX_LEN).trim();
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
 *  3. Otherwise mint a fresh `SigmaAlphaMale#NNNN` handle, PERSIST it (via `setHandle`)
 *     so it stays stable across sessions, and return it.
 * `opts.promptHandle` is accepted for back-compat but ignored — no dialog is
 * ever shown, so an anonymous player always gets a stable generated name.
 */
export function ensureHandle(opts: EnsureHandleOptions = {}): string {
  if (typeof opts.handle === "string" && opts.handle.trim()) {
    return sanitizeHandle(opts.handle);
  }

  const stored = getHandle();
  if (stored) return stored;

  // Nothing stored and no prompt: give the anonymous player a stable generated
  // name and persist it so the same name is reused on every later session.
  return setHandle(generateGuestHandle());
}
