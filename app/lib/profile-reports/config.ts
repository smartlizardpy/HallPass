/**
 * HallPass — profile-report tunables and vocabulary.
 *
 * PURE: no database, no `server-only`, no `window`. Read by the store, the
 * route, the report dialog AND the dashboard queue, so what the dialog offers
 * cannot drift from what the server accepts or the CHECK in
 * `043_profile_reports.sql` allows. `docs/profile-reports-design.md` has the
 * whole design.
 */

/** Reason codes, in the order the dialog lists them, with kid-facing labels. */
export const PROFILE_REPORT_REASONS = [
  { value: "bullying", label: "They're being mean or bullying", admin: "Bullying" },
  { value: "inappropriate_name", label: "Their name isn't okay", admin: "Inappropriate name" },
  { value: "inappropriate_content", label: "Their picture isn't okay", admin: "Inappropriate picture or content" },
  { value: "impersonation", label: "They're pretending to be someone else", admin: "Impersonation" },
  { value: "other", label: "Something else", admin: "Other" },
] as const;

export type ProfileReportReason = (typeof PROFILE_REPORT_REASONS)[number]["value"];

export function isProfileReportReason(value: unknown): value is ProfileReportReason {
  return PROFILE_REPORT_REASONS.some((r) => r.value === value);
}

/** Status values (the same trio `review_reports` uses). */
export type ProfileReportStatus = "open" | "actioned" | "dismissed";

/** Longest note, in characters. Mirrors the CHECK in the migration. */
export const NOTE_MAX_CHARS = 300;

/** Largest request body the route reads. A note is at most 300 chars. */
export const MAX_BODY_BYTES = 2048;

export interface RateLimit {
  maxPerWindow: number;
  windowSeconds: number;
}

/**
 * Reports one player may file per rolling hour. Low on purpose: a real child
 * reports one or two people; a bored one spams the queue. A duplicate of an
 * open report is a no-op and writes no row, so it does not count.
 */
export const REPORT_HOURLY_LIMIT = {
  maxPerWindow: 5,
  windowSeconds: 3600,
} as const satisfies RateLimit;

/** And per rolling day. The day limit is the real cap. */
export const REPORT_DAILY_LIMIT = {
  maxPerWindow: 15,
  windowSeconds: 86400,
} as const satisfies RateLimit;

/**
 * Why the route refused. `self` and `unavailable` (no such player) are the only
 * target errors; `down` is a database fault, so the dialog can say "try later".
 */
export type ProfileReportRefusal =
  | "forbidden"
  | "bad-request"
  | "signed-out"
  | "self"
  | "unavailable"
  | "rate-limited"
  | "down";

/**
 * Trim a note, collapse it to `null` when blank, and refuse (`undefined`) one
 * that is not a string or is over the cap. Control characters are stripped
 * except newlines.
 */
export function parseNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  if (cleaned.length > NOTE_MAX_CHARS) return undefined;
  return cleaned.length === 0 ? null : cleaned;
}
