/**
 * HallPass — is today 10 November in Türkiye?
 *
 * 10 Kasım is the anniversary of Mustafa Kemal Atatürk's death (10 November
 * 1938, 09:05). It is a day of remembrance, not a celebration, and the notice
 * `FeaturePromo` raises for it is written in that register.
 *
 * ── WHY ISTANBUL TIME, NOT THE VIEWER'S ─────────────────────────────────────
 * The day belongs to Türkiye's calendar. A player in Ankara at 00:30 on the 10th
 * should see it, and a player abroad whose local clock says the 10th while
 * Istanbul is already on the 11th should not. `Intl` with an explicit time zone
 * is the only way to ask that in the browser; parsing `Date#toString` would
 * answer in the device's zone instead. Türkiye has been fixed at UTC+3 since
 * 2016, but naming the zone keeps this correct if that ever changes.
 *
 * ── WHY THE DISMISSAL IS KEYED BY YEAR ──────────────────────────────────────
 * Closing the notice should silence it for the rest of the day, not forever:
 * the anniversary comes round every year. {@link remembranceKey} carries the
 * year so last year's dismissal does not swallow this year's notice.
 *
 * Pure and DOM-free, so it runs under the default `node` test environment.
 */

const TIME_ZONE = "Europe/Istanbul";

/** The year, month (1–12) and day it currently is in Türkiye. */
function istanbulDate(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** True for the whole of 10 November, Istanbul time. */
export function isRemembranceDay(now: Date = new Date()): boolean {
  const { month, day } = istanbulDate(now);
  return month === 11 && day === 10;
}

/** The dismissal key for this year's notice, e.g. `remembrance:2026`. */
export function remembranceKey(now: Date = new Date()): string {
  return `remembrance:${istanbulDate(now).year}`;
}
