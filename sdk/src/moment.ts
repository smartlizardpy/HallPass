/**
 * HallPass — `HallPass.moment(name, data?, opts?)`: a game marks a moment worth
 * keeping ("boss-phase-2", "fell-through-floor").
 *
 * Pure: no imports, no DOM, no network. That is what lets it be the ONE set of
 * rules, shared by every place that has to judge a moment:
 *
 *   `sdk/src/client.ts`                 validates the call and settles its promise
 *   `app/lib/capture/moments.ts`        re-validates what the beta session receives
 *
 * The injected recording shim (`record-shim.ts`) is a string with no imports, so
 * it forwards the RAW arguments and leaves judging them to the app side — the
 * game's data is untrusted either way.
 *
 * ── WHAT THE SDK ITSELF DOES WITH A MOMENT ──────────────────────────────────
 * Nothing. It validates and resolves; it sends no request and stores nothing. The
 * call only has an effect inside a beta test session, where the page the game
 * runs in has been given the recording shim, which sees the call and takes a
 * picture on the TESTER'S device. Everywhere else it is a deliberate no-op, which
 * is why a game can ship the calls permanently.
 */

/** Longest moment name. */
export const MOMENT_NAME_MAX = 40;

/** Largest serialised `data`, in UTF-16 units of its JSON text (~2 KB of ASCII). */
export const MOMENT_DATA_MAX = 2048;

/** A moment name: lowercase, starts alphanumeric, then `[a-z0-9._-]`. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export type MomentOptions = {
  /**
   * `false` records the moment as an event with no picture — a death, a pause, a
   * score tick. Default `true`.
   */
  shot?: boolean;
};

export type MomentResult =
  | { ok: true; name: string }
  | { ok: false; reason: "bad-name" | "bad-data" | "inert" };

/** A moment that passed validation. */
export type ValidMoment = {
  name: string;
  /** JSON-safe, size-capped; `null` when the game passed none. */
  data: Record<string, unknown> | null;
  shot: boolean;
};

/**
 * Normalise a name: trimmed and lowercased, so `"Boss-1"` and `"boss-1"` are one
 * moment. Returns `null` for anything that is not a string or does not fit.
 */
export function normaliseMomentName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase();
  if (name.length === 0 || name.length > MOMENT_NAME_MAX) return null;
  return NAME_RE.test(name) ? name : null;
}

/**
 * Reduce `data` to plain JSON under the size cap.
 *
 * Round-tripped through JSON, so functions, DOM nodes and cycles cannot reach the
 * session page or a stored row, and what is kept is exactly what is measured.
 * Only a plain object is accepted — an array or a bare number is a game guessing
 * at a shape, and the dashboard renders keys. Returns `undefined` when `data` is
 * unusable (too big, circular, not an object), `null` when there is none.
 */
export function sanitiseMomentData(raw: unknown): Record<string, unknown> | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  try {
    const text = JSON.stringify(raw);
    if (typeof text !== "string" || text.length > MOMENT_DATA_MAX) return undefined;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Validate a whole call. Never throws. */
export function parseMoment(
  name: unknown,
  data?: unknown,
  opts?: unknown,
): { ok: true; moment: ValidMoment } | { ok: false; reason: "bad-name" | "bad-data" } {
  const n = normaliseMomentName(name);
  if (n === null) return { ok: false, reason: "bad-name" };
  const d = sanitiseMomentData(data);
  if (d === undefined) return { ok: false, reason: "bad-data" };
  const shot =
    !(opts && typeof opts === "object" && (opts as MomentOptions).shot === false);
  return { ok: true, moment: { name: n, data: d, shot } };
}
