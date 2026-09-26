/**
 * HallPass — display helpers for an ISO 3166-1 alpha-2 country code.
 *
 * Pure and dependency-free (no `server-only`): both the dashboard's server
 * component and its client toggle need these, and neither needs a network
 * call or a new npm package to get a flag or a name — the runtime already
 * ships both.
 */

/** Where the flag emoji's code points start; regional indicators run A–Z from here. */
const REGIONAL_INDICATOR_BASE = 0x1f1e6 - "A".charCodeAt(0);

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * The flag emoji for a 2-letter country code, built from the two Unicode
 * "regional indicator" characters it maps to (the same technique
 * `@vercel/functions`'s own `geolocation()` uses internally) — no flag image
 * asset or icon package required. `null`/an implausible code renders as a
 * plain globe, the "no particular place" glyph.
 */
export function countryFlagEmoji(code: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((char) => REGIONAL_INDICATOR_BASE + char.charCodeAt(0)),
  );
}

/**
 * The English display name for a 2-letter country code, via the built-in
 * `Intl.DisplayNames` — no `world-countries`/`i18n-iso-countries` dependency
 * needed for a lookup the platform already has. `null` (undetected) reads as
 * "Unknown"; a code the runtime does not recognise falls back to the raw code
 * rather than throwing.
 */
export function countryDisplayName(code: string | null): string {
  if (!code) return "Unknown";
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
