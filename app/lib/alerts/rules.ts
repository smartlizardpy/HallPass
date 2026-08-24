/**
 * HallPass — deciding whether a measurement is worth waking somebody for.
 *
 * PURE: no database, no network, no `server-only`, and NO CLOCK — the snapshot
 * carries its own timestamp. That is what lets the whole of the site's alerting
 * judgement be unit-tested in the plain `node` environment, against fixtures,
 * without a PostHog project or a spike to wait for.
 *
 * ── THE QUERIES RETURN FACTS; THIS FILE DOES THE ARITHMETIC ────────────────
 * `metrics.ts` selects counts and nothing else — no `avg`, no `quantile`, no
 * CASE expression deciding whether something is bad. Every median, ratio and
 * threshold comparison happens here instead, for one reason: HogQL cannot be
 * unit-tested in this repo. A rule expressed in SQL is a rule nobody can write a
 * failing test for, and "it fired at 4am and we do not know why" is the shape
 * that bug takes at three in the morning. Splitting it this way means the part
 * that is easy to get wrong is the part that is easy to check.
 *
 * ── A RULE THAT CANNOT MEASURE SAYS NOTHING ────────────────────────────────
 * Every ratio rule needs {@link MIN_BASELINE_DAYS} days of history before it
 * will act. A brand-new deploy, a project whose retention has aged the week out,
 * or an outage that ate the comparison window all produce "no baseline" — and
 * the answer to that is silence, not a guess. Firing on a missing denominator is
 * how alerting earns itself a filter rule in somebody's inbox.
 *
 * ── WHY A MEDIAN AND NOT A MEAN ────────────────────────────────────────────
 * Seven samples, one of which may be the afternoon somebody posted the site to a
 * group chat. A mean lets that afternoon raise the bar for the whole following
 * week — the next real spike then has to clear a threshold set by the last one,
 * which is precisely backwards. The median ignores it.
 */

import {
  ALERT_IDS,
  CONTENT_GAP_MIN_PEOPLE,
  ERROR_ALWAYS,
  ERROR_MIN,
  ERROR_RATIO,
  MIN_BASELINE_DAYS,
  SPIKE_MIN_VISITORS,
  SPIKE_RATIO,
  isAlertId,
  type AlertId,
} from "./config";

// ---------------------------------------------------------------------------
// What a measurement looks like
// ---------------------------------------------------------------------------

/** One search term that matched no game, and how many people typed it. */
export type MissingGame = {
  term: string;
  /** DISTINCT people, never searches — see `CONTENT_GAP_MIN_PEOPLE`. */
  people: number;
};

/**
 * Everything the rules are allowed to look at, as `metrics.ts` measured it.
 *
 * `baseline` arrays hold ONE ENTRY PER PREVIOUS DAY at the same hour of the day
 * — not per hour of the last week. That distinction is the whole reason the
 * comparison works on a site played during lessons; see `config.ts`.
 */
export type AlertSnapshot = {
  /** When the measurement was taken, ISO-8601. Carried so nothing here needs a clock. */
  takenAt: string;
  /** The measured window, in minutes. */
  windowMinutes: number;
  current: {
    /** Distinct players who started a game in the window. */
    visitors: number;
    /** Exceptions captured in the window. */
    errors: number;
  };
  baseline: {
    /** Same hour, previous days. Most recent first; length may be short. */
    visitors: number[];
    errors: number[];
  };
  /** Top zero-result search terms over the last day, most-wanted first. */
  missingGames: MissingGame[];
};

/**
 * An alert that fired, carrying the numbers that fired it.
 *
 * A DISCRIMINATED UNION rather than a bag of optional fields, because the notify
 * endpoint builds the wording from exactly these values — see
 * `notifications/copy.ts`. A shape that let `traffic_spike` arrive without its
 * `visitors` would be a notification reading "undefined players in the last
 * hour", and there is no reason to make that expressible.
 *
 * `ratio` is `null` where there was nothing to divide by. The copy has a branch
 * for that; `NaN×` and `Infinity×` are what it exists to prevent.
 */
export type FiredAlert =
  | {
      id: "traffic_spike";
      visitors: number;
      /** The same hour's median over the baseline days. */
      baseline: number;
      ratio: number;
    }
  | {
      id: "error_spike";
      errors: number;
      baseline: number | null;
      ratio: number | null;
    }
  | {
      id: "content_gap";
      term: string;
      people: number;
    };

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/** A finite, non-negative number, or `0`. Everything from a query goes through it. */
function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The median of a sample, or `null` when there is not enough of one.
 *
 * "Not enough" is {@link MIN_BASELINE_DAYS}, not one — see the module docblock.
 * An even-length sample averages the two middle values, which for a week of
 * daily counts is the usual convention and never matters much either way.
 *
 * A sample that is not an array at all is treated as an absent one. That is not
 * defensive habit: the snapshot arrives as JSON from a route, so a field the
 * query never selected reads as `undefined` here, and the contract this whole
 * module is written to is that an unknown falls the QUIET way rather than
 * throwing inside the cron.
 */
export function median(
  sample: readonly number[],
  minSamples = MIN_BASELINE_DAYS,
): number | null {
  const values = (Array.isArray(sample) ? sample : []).map(num).sort((a, b) => a - b);
  if (values.length < minSamples) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
}

/** How many times `baseline` the `value` is. `null` when there is nothing to divide by. */
function ratioOf(value: number, baseline: number | null): number | null {
  if (baseline === null || baseline <= 0) return null;
  return value / baseline;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/**
 * Traffic spike: three times the usual for this hour, and at least a classroom
 * of people.
 *
 * BOTH CONDITIONS, ALWAYS. The ratio is what makes it a spike rather than a busy
 * Tuesday; the floor is what stops "three players where the median is one" being
 * reported as one. Neither is redundant.
 */
function trafficSpike(snapshot: AlertSnapshot): FiredAlert | null {
  const visitors = num(snapshot.current?.visitors);
  if (visitors < SPIKE_MIN_VISITORS) return null;

  const baseline = median(snapshot.baseline?.visitors);
  const ratio = ratioOf(visitors, baseline);
  // A null ratio here is "no week to compare against" or "the median is zero".
  // Both are silence: a site with no history has nothing to be a multiple of.
  if (baseline === null || ratio === null || ratio < SPIKE_RATIO) return null;

  return { id: "traffic_spike", visitors, baseline, ratio };
}

/**
 * Error spike, in three cases that are genuinely different questions.
 *
 *   1. THERE IS A USABLE BASELINE. Compare against it: at least {@link ERROR_MIN}
 *      errors AND {@link ERROR_RATIO} times the median. A site that normally
 *      throws two hundred an hour is not having an incident at a hundred, which
 *      is exactly what an absolute threshold would claim.
 *   2. THE BASELINE EXISTS AND IS ZERO. Nothing to divide by, but "this hour is
 *      unlike every other hour this week" is the strongest signal there is, so
 *      {@link ERROR_MIN} alone fires — with a `null` ratio, which the copy renders
 *      as "the site is usually quiet".
 *   3. THERE IS NO BASELINE AT ALL. Only an obviously bad number counts:
 *      {@link ERROR_ALWAYS}. This is the deploy-broke-everything case, where the
 *      week of history is exactly what is missing.
 */
function errorSpike(snapshot: AlertSnapshot): FiredAlert | null {
  const errors = num(snapshot.current?.errors);
  const baseline = median(snapshot.baseline?.errors);

  if (baseline === null) {
    return errors >= ERROR_ALWAYS
      ? { id: "error_spike", errors, baseline: null, ratio: null }
      : null;
  }

  if (baseline === 0) {
    return errors >= ERROR_MIN
      ? { id: "error_spike", errors, baseline: 0, ratio: null }
      : null;
  }

  const ratio = ratioOf(errors, baseline);
  if (errors < ERROR_MIN || ratio === null || ratio < ERROR_RATIO) return null;
  return { id: "error_spike", errors, baseline, ratio };
}

/**
 * Content gap: the most-wanted game the arcade does not have.
 *
 * ONE ALERT, NOT ONE PER TERM. A day's worth of misses is a list, and a list is
 * what the dashboard is for; the notification's job is to say that the list is
 * worth opening and to name the top of it. Fanning out a notification per term
 * would turn a good week of search traffic into a bad afternoon of buzzing.
 *
 * The caller sorts, but this does not trust that: it takes the maximum itself,
 * so a query whose ORDER BY is edited later cannot quietly start reporting the
 * fifth-most-wanted game as the headline.
 */
function contentGap(snapshot: AlertSnapshot): FiredAlert | null {
  let best: MissingGame | null = null;
  for (const candidate of snapshot.missingGames ?? []) {
    const term = typeof candidate?.term === "string" ? candidate.term.trim() : "";
    if (!term) continue;
    const people = num(candidate.people);
    if (people < CONTENT_GAP_MIN_PEOPLE) continue;
    if (!best || people > best.people) best = { term, people };
  }
  return best ? { id: "content_gap", term: best.term, people: best.people } : null;
}

/**
 * Every alert this snapshot fires, in catalogue order.
 *
 * Order is `ALERT_IDS` rather than severity, so a report reads the same way
 * every time. Nothing here throws on a malformed snapshot: a missing field
 * degrades to zero and therefore to silence, which is the right direction for a
 * path that can only ever wake somebody up.
 */
export function evaluateAlerts(snapshot: AlertSnapshot): FiredAlert[] {
  const byId: Record<AlertId, (s: AlertSnapshot) => FiredAlert | null> = {
    traffic_spike: trafficSpike,
    error_spike: errorSpike,
    content_gap: contentGap,
  };
  const fired: FiredAlert[] = [];
  for (const id of ALERT_IDS) {
    const alert = byId[id](snapshot);
    if (alert) fired.push(alert);
  }
  return fired;
}

// ---------------------------------------------------------------------------
// Coming back off the wire
// ---------------------------------------------------------------------------

/**
 * Narrow one JSON object from the notify endpoint's body back to a {@link FiredAlert}.
 *
 * THE MEASUREMENT MAKES THE ROUND TRIP; THE WORDING NEVER DOES. The cron posts
 * ids and numbers, and the server builds the notification text from them — so
 * the worst a caller holding the secret can do is report a spike that did not
 * happen, rather than put arbitrary text on an admin's lock screen. That is why
 * this returns a typed union and not the parsed body.
 *
 * Anything unrecognised is `null` rather than a throw: one malformed entry
 * should cost its own alert, not the whole request.
 */
export function parseFiredAlert(value: unknown): FiredAlert | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isAlertId(raw.id)) return null;

  switch (raw.id) {
    case "traffic_spike": {
      const visitors = num(raw.visitors);
      const baseline = num(raw.baseline);
      const ratio = num(raw.ratio);
      if (visitors <= 0 || ratio <= 0) return null;
      return { id: "traffic_spike", visitors, baseline, ratio };
    }
    case "error_spike": {
      const errors = num(raw.errors);
      if (errors <= 0) return null;
      // `null` is meaningful here rather than missing: it is what the copy
      // renders as "the site is usually quiet".
      const ratio = raw.ratio === null ? null : num(raw.ratio) || null;
      const baseline = raw.baseline === null ? null : num(raw.baseline);
      return { id: "error_spike", errors, baseline, ratio };
    }
    case "content_gap": {
      const term = typeof raw.term === "string" ? raw.term.trim() : "";
      const people = num(raw.people);
      if (!term || people <= 0) return null;
      return { id: "content_gap", term, people };
    }
  }
}
