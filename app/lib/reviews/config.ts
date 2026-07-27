/**
 * HallPass — review tunables.
 *
 * Mirrors `scoreboard/config.ts` and `social/config.ts`: pure, no `server-only`,
 * read by both the store and the routes so the two cannot drift.
 */

/**
 * Per-player write limit.
 *
 * Counts EDITS as well as new reviews (the store's window looks at `updated_at`),
 * because the one-per-player model means a determined poster's only remaining
 * lever is rewriting the same review over and over.
 */
export const REVIEW_PLAYER_RATE_LIMIT = {
  maxPerWindow: 5,
  windowSeconds: 600,
} as const;

/**
 * Per-IP backstop — LOOSE ON PURPOSE, and this is the number most likely to be
 * "tightened" by someone who has not read this comment.
 *
 * A school NATs its entire network to one egress address, and
 * `clientKeyFromHeaders()` takes the first hop of `x-forwarded-for`. A per-IP
 * limit strict enough to stop one griefer would stop the whole computing lab.
 * This exists only to cut off a scripted flood, never as the real limit — that
 * job belongs to the per-player limit above.
 */
export const REVIEW_IP_RATE_LIMIT = {
  maxPerWindow: 30,
  windowSeconds: 600,
} as const;

/**
 * How long an identical body from the same player is treated as a repeat.
 *
 * This IS the idempotency mechanism: a double-click, a retry, or a resend over a
 * flaky connection becomes a no-op. Preferred over a client-generated
 * idempotency key because it needs no extra trusted input and it incidentally
 * stops copy-paste spam.
 */
export const REVIEW_DUP_WINDOW_SECONDS = 600;

/**
 * Minimum account age before a first review.
 *
 * One extra condition in the existing write statement, invisible to anyone who
 * signed in more than a few minutes ago, and the only real lever against ban
 * evasion by fresh Google account: it puts a fixed cost on every
 * throwaway-account cycle.
 */
export const REVIEW_MIN_ACCOUNT_AGE_MINUTES = 10;

/**
 * Distinct reporters before a review auto-hides.
 *
 * On a school site the HARM WINDOW dominates: a wrongly-hidden review costs its
 * author mild annoyance and one admin click, whereas an un-hidden abusive one
 * sits in front of a class until somebody logs in. Three distinct signed-in
 * reporters is high enough that one griefer, or a pair of friends, cannot nuke a
 * review on their own.
 *
 * Auto-hide sets `hidden` (reversible), never `deleted`, and does NOT resolve the
 * reports — the queue still gets human eyes.
 */
export const REVIEW_AUTO_HIDE_REPORTS = 3;

/** Reviews per page. Keyset-paginated, so this is a page size, not an offset. */
export const REVIEWS_PAGE_SIZE = 20;

/** Report reasons, ordered so the highest-severity one is the easiest to reach. */
export const REPORT_REASONS = [
  { value: "personal_info", label: "Personal info (name, phone, address)" },
  { value: "bullying", label: "Bullying or harassment" },
  { value: "hate", label: "Hate speech" },
  { value: "sexual", label: "Sexual content" },
  { value: "spam", label: "Spam or advertising" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export function isReportReason(value: unknown): value is ReportReason {
  return REPORT_REASONS.some((r) => r.value === value);
}
