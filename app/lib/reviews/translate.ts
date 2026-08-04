/**
 * HallPass — on-demand translation of review bodies.
 *
 * FREE AND KEYLESS BY DESIGN. There is no translation vendor, no account, and no
 * API key in this codebase — the school deployment has no budget line for one and
 * a key would be one more secret to leak. This talks to Google's public `gtx`
 * translate endpoint, the same one the browser extension uses: no auth, no quota
 * signup, auto source-language detection. It is UNOFFICIAL and can change shape or
 * rate-limit without notice, so every failure here is soft — the caller falls back
 * to showing the original text, never an error in front of a pupil.
 *
 * WHY THIS IS SERVER-SIDE. The endpoint sends no CORS headers, so a browser fetch
 * would be blocked; routing it through our own origin fixes that and, more
 * importantly, keeps the provider swappable behind `/api/v1/reviews/[id]/translate`
 * without touching the client. The route translates ONLY an existing visible
 * review body it looked up by id — never arbitrary caller-supplied text — so this
 * can never become an open translation proxy, and the set of distinct upstream
 * calls is bounded by (#reviews × #languages) and then CDN-cached.
 *
 * This module is pure enough to unit-test without a network: {@link parseGtxResponse}
 * and {@link normalizeTargetLang} carry the only logic that can be got wrong, and
 * both are exported for exactly that reason. `translateReviewBody` is the only part
 * that touches the wire.
 */

/**
 * How long to wait on the upstream before giving up and showing the original.
 * A translation is a nicety; nobody should watch a spinner for it.
 */
const TRANSLATE_TIMEOUT_MS = 6000;

/**
 * Upstream cannot translate more than a review could ever be (500 chars, see
 * `validate.ts`). This is a defence-in-depth cap on what we hand the endpoint in a
 * single GET query, not the product limit.
 */
const MAX_TRANSLATE_CHARS = 1000;

/**
 * A Google `translate_a/single` reply is a deeply nested, mostly-null array. Only
 * two parts matter and their positions are stable across the years this endpoint
 * has existed:
 *
 *   data[0]  — an array of [translatedSegment, originalSegment, …] tuples. The
 *              translation is those first elements joined; a long body comes back
 *              split across several tuples and dropping any of them silently
 *              truncates the result.
 *   data[2]  — the detected source language code (e.g. "es"). Used for the
 *              "Translated from Spanish" note and to suppress the offer when a
 *              review is already in the reader's language.
 *
 * Anything unexpected returns null so the caller falls back to the original.
 */
export function parseGtxResponse(
  json: unknown,
): { text: string; source: string } | null {
  if (!Array.isArray(json)) return null;
  const segments = json[0];
  if (!Array.isArray(segments)) return null;

  let text = "";
  for (const seg of segments) {
    // Each segment is itself an array whose first element is the translated
    // chunk. A malformed segment is skipped rather than aborting the whole join.
    if (Array.isArray(seg) && typeof seg[0] === "string") {
      text += seg[0];
    }
  }
  if (text.trim().length === 0) return null;

  const source = typeof json[2] === "string" && json[2] ? json[2] : "auto";
  return { text, source };
}

/**
 * Reduce a browser locale (`navigator.language`, e.g. `en-GB`, `pt-BR`, `zh-Hant`)
 * to a target code the `gtx` endpoint accepts, or null when it is not something we
 * offer.
 *
 * Everything collapses to its primary two-letter subtag EXCEPT Chinese, where the
 * script genuinely changes the output and the endpoint wants `zh-CN` / `zh-TW`.
 * The result is always `[a-z]{2}` or one of those two literals, so it is safe to
 * splice into the request URL — there is no path by which caller input reaches the
 * wire as anything but letters.
 */
export function normalizeTargetLang(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const lower = input.trim().toLowerCase();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(lower)) return null;

  if (lower.startsWith("zh")) {
    // Traditional-script tags (Taiwan, Hong Kong, or an explicit `hant`) map to
    // zh-TW; everything else Chinese to Simplified.
    return /(^|-)(tw|hk|hant)(-|$)/.test(lower) ? "zh-TW" : "zh-CN";
  }

  const base = lower.split("-")[0];
  return /^[a-z]{2}$/.test(base) ? base : null;
}

/**
 * Translate a review body into `target`, or return null on any failure.
 *
 * Soft everywhere: a timeout, a non-200, a shape we do not recognise, or a body
 * that is too long all resolve to null, and the route turns null into "keep the
 * original text". Nothing here throws.
 */
export async function translateReviewBody(
  text: string,
  target: string,
): Promise<{ text: string; source: string } | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TRANSLATE_CHARS) return null;

  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(trimmed)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // The endpoint is content-addressed by its query, so let the platform cache
      // identical lookups; the route in front adds the real HTTP caching.
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const parsed = parseGtxResponse(await res.json());
    if (!parsed) return null;

    // A "translation" into the language the text is already in is just the text
    // back. Signal that with source === target so the UI can say so instead of
    // toggling to an identical string.
    return parsed;
  } catch {
    // AbortError, network error, or malformed JSON — all mean "no translation".
    return null;
  } finally {
    clearTimeout(timer);
  }
}
