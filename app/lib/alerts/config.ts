/**
 * HallPass — what the site alerts on, and how loudly it is allowed to.
 *
 * PURE, and deliberately free of `server-only` (the same reasoning as
 * `growth/config.ts` and `notifications/config.ts`): the thresholds every rule
 * stands on can then be unit-tested without a network call, an API key or a
 * running project. The rules themselves live in `rules.ts`; the numbers live
 * here so they can be read, argued with and changed in one place.
 *
 * ── AN ALERT ID *IS* A NOTIFICATION KIND ───────────────────────────────────
 * There is no mapping table from alerts to notification kinds, and no second
 * catalogue. {@link ALERT_IDS} is declared `satisfies readonly NotificationKind[]`,
 * so an id with no entry in `notifications/config.ts` is a BUILD failure rather
 * than an alert that fires into nothing at three in the morning. Everything a
 * kind already carries — the wording, the discreet counterpart, the default
 * channel, the per-admin on/off switch — is therefore automatically true of the
 * alert, and an admin who mutes "Missing games" in their settings has muted this
 * alert, with no second preference to keep in step.
 *
 * ── WHY THE BASELINE IS THE SAME HOUR ON PREVIOUS DAYS ─────────────────────
 * This is a site played from school. Traffic at 12:30 on a Tuesday and traffic
 * at 03:00 on a Sunday differ by more than any spike worth telling somebody
 * about, so a rule comparing the last hour against "the last 24 hours" would
 * fire every single weekday morning and stay silent through a genuine surge on
 * a quiet evening. Comparing against the SAME HOUR OF THE DAY over the previous
 * week removes the daily shape from the comparison entirely, and a MEDIAN of
 * those days removes the one afternoon somebody posted a link.
 *
 * ── EVERY THRESHOLD HAS A FLOOR AS WELL AS A RATIO ─────────────────────────
 * A ratio alone is a generator of 4am nonsense: two players at three in the
 * morning where the median is zero is an infinite spike and means nothing. Each
 * rule pairs its ratio with an absolute floor, and none of them fires without
 * enough baseline days to have an opinion — a rule that cannot measure says
 * nothing rather than guessing.
 */

import type { NotificationKind } from "@/app/lib/notifications/config";

/**
 * Every alert the cron can raise, in the order a report lists them.
 *
 * The `satisfies` is load-bearing — see the module docblock.
 */
export const ALERT_IDS = [
  "traffic_spike",
  "error_spike",
  "content_gap",
] as const satisfies readonly NotificationKind[];

export type AlertId = (typeof ALERT_IDS)[number];

/**
 * Narrow an untrusted value to a known alert id.
 *
 * The notify endpoint takes its ids from a request body — from CI, but a
 * request body all the same — so nothing downstream may assume the string is one
 * of ours. An unknown id is dropped rather than delivered as itself: `kind` is
 * free TEXT in the database, so an unchecked id would file a notification no
 * deploy can render.
 */
export function isAlertId(value: unknown): value is AlertId {
  return (ALERT_IDS as readonly string[]).includes(String(value));
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The measured window, in minutes. One hour, matched to the baseline's
 * hour-of-day buckets so the two sides of every ratio are the same size.
 *
 * The cron runs more often than this (every 30 minutes), so consecutive runs
 * overlap. That is deliberate: a spike that starts at :29 is reported within a
 * minute rather than half an hour later, and the cooldown below is what stops
 * the overlap being told to anybody twice.
 */
export const ALERT_WINDOW_MINUTES = 60;

/** How many previous days the same-hour baseline is drawn from. */
export const BASELINE_DAYS = 7;

/**
 * The fewest baseline days a ratio rule will act on.
 *
 * Below this there is no median worth taking — a brand-new deploy, or a project
 * whose retention has aged the week out, has nothing to be a multiple OF. Such a
 * rule reports "no baseline" and fires nothing, which is why a fresh site is
 * quiet rather than screaming on its first busy hour.
 */
export const MIN_BASELINE_DAYS = 3;

/** The content-gap rule looks over a whole day, not an hour — see `rules.ts`. */
export const CONTENT_GAP_WINDOW_HOURS = 24;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Traffic spike: distinct players in the window, against the same hour's median.
 *
 * Three times the usual AND at least twenty-five players. Twenty-five is the
 * floor because it is roughly a class: below that a "spike" is a handful of
 * friends opening the site together, which is lovely and is not news.
 */
export const SPIKE_RATIO = 3;
export const SPIKE_MIN_VISITORS = 25;

/**
 * Error spike: captured exceptions in the window.
 *
 * TWO WAYS TO FIRE, because errors are unlike traffic — a big enough absolute
 * number is bad news whatever last week looked like:
 *   * {@link ERROR_RATIO} times the same hour's median, with at least
 *     {@link ERROR_MIN} of them, so a jump from 2 to 8 is not an incident; or
 *   * {@link ERROR_ALWAYS} in one hour, which fires with no baseline at all —
 *     the case that matters on the deploy that broke everything, when there is
 *     no "usual" because the site has never done this before.
 */
export const ERROR_RATIO = 3;
export const ERROR_MIN = 20;
export const ERROR_ALWAYS = 100;

/**
 * Content gap: distinct players who searched one term and matched no game.
 *
 * Counted by PEOPLE over a day rather than by searches over an hour, for the
 * reason `stats.ts` gives at length: one indecisive player typing six prefixes
 * is not six people wanting a game, and searching is spread thinly enough
 * through a day that an hour of it says nothing. Five people asking for the same
 * missing game is a request; two is a coincidence.
 */
export const CONTENT_GAP_MIN_PEOPLE = 5;

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

/**
 * How long one alert stays quiet after firing, in hours.
 *
 * A spike lasts hours and the cron runs every thirty minutes, so without this an
 * afternoon of good news would be a dozen identical buzzes — the fastest known
 * way to teach somebody to turn a feature off.
 */
export const ALERT_COOLDOWN_HOURS = 6;

/**
 * The dedupe key for one alert in one cooldown window.
 *
 * ── THE COOLDOWN IS A DEDUPE KEY, NOT A TABLE ──────────────────────────────
 * `notifications.dedupe_key` is already unique table-wide, and `deliver.ts`
 * already declines to push what it did not write. Bucketing the clock into
 * fixed windows and putting the bucket in the key therefore buys a cooldown with
 * NO new table, NO migration — which `HANDOFF.md` shows is the step that
 * actually goes missing in production — and no cleanup job. It is also correct
 * across concurrent runs and across instances, because the unique index is doing
 * the work rather than a read-then-write in application code.
 *
 * WHAT IT COSTS, HONESTLY: the windows are fixed rather than sliding, so an
 * alert firing at 11:58 and again at 12:02 lands in two different buckets and is
 * told twice. That is the worst case, it needs a spike to straddle a boundary,
 * and the alternative — a stored last-fired timestamp per alert — is a table and
 * a migration to turn a rare double buzz into no double buzz. Not worth it.
 *
 * `deliver.ts` suffixes the recipient, so this key means "this alert, this
 * window, this admin" and one admin's row cannot swallow another's.
 */
export function alertDedupeKey(
  id: AlertId,
  nowMs: number,
  cooldownHours: number = ALERT_COOLDOWN_HOURS,
): string {
  const bucket = Math.floor(nowMs / (cooldownHours * 60 * 60 * 1000));
  return `alert:${id}:${bucket}`;
}
