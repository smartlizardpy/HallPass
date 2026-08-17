import "server-only";

/**
 * HallPass — the ACQUISITION picture: where devices come from, and whether they
 * come back.
 *
 * The PostHog half of the growth page. Everything here is DIRECTIONAL and the
 * page says so: a school content filter, an ad blocker or a browser with
 * analytics disabled all remove real visits from these numbers silently. The
 * share-loop panel reads our own database and is exact; when the two disagree,
 * that one wins. See `marketing-design.md` §7.
 *
 * DEVICES, NOT PEOPLE — everywhere, without exception. `distinct_id` identifies a
 * browser profile, and a class shares a trolley of Chromebooks, so one id is
 * frequently many children and one child is many ids. Every count here is
 * therefore named for devices, and nothing in this module may be labelled
 * "users" downstream. That is a correctness rule, not a wording preference.
 *
 * WHY `day_played` CARRIES RETENTION rather than a PostHog cohort: the event is
 * emitted from the streak store, which already knows the device's whole played
 * history, so first-vs-returning is a fact the client states rather than
 * something a query infers from event ranges. It also keeps working for the
 * majority of our players who never sign in and never get a person profile.
 *
 * The split is taken from `days_played` (a number) rather than the `returning`
 * boolean the same event carries, even though the boolean is what the split
 * means. JSON booleans reach HogQL as values needing coercion and compare
 * inconsistently depending on how a property was materialised; an integer
 * compares the same way everywhere. `returning` stays on the event because it is
 * the readable form for anyone exploring in the PostHog UI.
 *
 * EVERY QUERY HERE READS ITS ROWS BY NAME through `hogqlNamed`, and every value
 * leaves through `toCount` / `toText`. PostHog answers positionally — `results`
 * is an array of arrays, the names are in a sibling `columns` array — so rows
 * typed as objects without that mapping read `undefined` out of every field.
 * This module shipped exactly that once: the KPIs fell through `undefined ?? 0`
 * into a confident row of zeros, the bars formatted as `NaN`, and an absent
 * `lastEventAt` had the page announce that PostHog held no events at all while
 * it was receiving them normally. None of it failed loudly, which is why the
 * mapping is a named one now.
 */

import { hogqlNamed, isStatsConfigured } from "@/app/lib/stats";
import { toCount, toText } from "@/app/lib/hogql-rows";
import {
  ACQUISITION_WINDOW_DAYS,
  isReportingHealthy,
  normaliseLastEvent,
} from "./config";
import { channelLabel } from "./channels";

/** A source with the devices it brought. */
export type SourceRow = {
  /** The `ref` bucket, `unknown`, or `null` for untagged traffic. */
  bucket: string | null;
  label: string;
  devices: number;
};

export type EntryPage = { path: string; devices: number };
export type ReferrerRow = { domain: string; devices: number };
export type RetentionDay = { date: string; first: number; returning: number };

export type Acquisition = {
  /** Devices that started a session in the window. */
  devices: number;
  /** Devices whose first-ever play day was in the window. */
  firstTimeDevices: number;
  /** Devices that played on a day after their first. The north-star number. */
  returningDevices: number;
  /** First-touch channel breakdown, biggest first. */
  channels: SourceRow[];
  /** Where the browser said it came from, for untagged traffic. */
  referrers: ReferrerRow[];
  /** The page a session started on — what search actually lands people on. */
  entryPages: EntryPage[];
  /** Daily first-time vs returning devices. */
  retention: RetentionDay[];
  /** ISO timestamp of the newest event PostHog has, or null if it has none. */
  lastEventAt: string | null;
  /**
   * True when we hold a server-side read key. False means the PANEL cannot read,
   * which is a different failure from the site not sending — the page must not
   * render either as "no visitors".
   */
  configured: boolean;
  /** False when the newest event is stale (or absent) — see `config.ts`. */
  reporting: boolean;
};

const EMPTY: Acquisition = {
  devices: 0,
  firstTimeDevices: 0,
  returningDevices: 0,
  channels: [],
  referrers: [],
  entryPages: [],
  retention: [],
  lastEventAt: null,
  configured: false,
  reporting: false,
};

const WINDOW = `INTERVAL ${ACQUISITION_WINDOW_DAYS} DAY`;

/** A panel query that must never blank the whole page. */
function safe<T>(p: Promise<T[]>): Promise<T[]> {
  return p.catch(() => [] as T[]);
}

/**
 * Normalise a channel value coming back from HogQL.
 *
 * PostHog returns an absent property as an empty string rather than SQL NULL, so
 * `''` here means "this device carries no first-touch ref" — untagged traffic,
 * which is the normal case and must stay distinct from `unknown` (a tagged link
 * wearing a label we do not publish). Collapsing them would hide the one of the
 * two that is worth investigating.
 */
function toBucket(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw;
}

/**
 * Row shapes, typed as `unknown` per column on purpose.
 *
 * `hogqlNamed` can put a name to a value; it cannot promise a type, and HogQL
 * hands a large enough integer back as a JSON string. Declaring `number` here
 * would be a claim we are in no position to make, so each field is coerced at
 * the point of use instead.
 */
type TotalsRow = {
  devices: unknown;
  first_devices: unknown;
  returning_devices: unknown;
};
type ChannelRow = { bucket: unknown; devices: unknown };
type ReferrerQueryRow = { domain: unknown; devices: unknown };
type EntryPageRow = { path: unknown; devices: unknown };
type RetentionRow = { date: unknown; first: unknown; returning: unknown };
type FreshnessRow = { last_event: unknown };

export async function getAcquisition(): Promise<Acquisition> {
  if (!isStatsConfigured()) return { ...EMPTY };

  const TAG = "posthog-growth";

  const [totals, channels, referrers, entryPages, retention, freshness] =
    await Promise.all([
      safe(
        hogqlNamed<TotalsRow>(
          `
        SELECT
          count(DISTINCT distinct_id) AS devices,
          count(DISTINCT if(event = 'day_played' AND toInt(properties.days_played) = 1, distinct_id, NULL)) AS first_devices,
          count(DISTINCT if(event = 'day_played' AND toInt(properties.days_played) > 1, distinct_id, NULL)) AS returning_devices
        FROM events
        WHERE timestamp >= now() - ${WINDOW}
      `,
          TAG,
        ),
      ),

      /**
       * FIRST-touch channel, not last. `hp_initial_ref_channel` is a super
       * property written once per device by `growth/first-touch.ts`, so it rides
       * on every event that device ever sends and survives the visitor never
       * signing in. Counting distinct devices rather than events stops one
       * enthusiastic player from outranking a channel that brought thirty.
       */
      safe(
        hogqlNamed<ChannelRow>(
          `
        SELECT properties.hp_initial_ref_channel AS bucket,
               count(DISTINCT distinct_id) AS devices
        FROM events
        WHERE timestamp >= now() - ${WINDOW}
        GROUP BY bucket
        ORDER BY devices DESC
        LIMIT 12
      `,
          TAG,
        ),
      ),

      /**
       * Referring domains, excluding our own — a same-origin referrer is a
       * navigation between our pages, not an acquisition.
       */
      safe(
        hogqlNamed<ReferrerQueryRow>(
          `
        SELECT properties.$referring_domain AS domain,
               count(DISTINCT distinct_id) AS devices
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= now() - ${WINDOW}
          AND domain NOT IN ('', '$direct')
          AND domain NOT ILIKE '%hallpass%'
        GROUP BY domain
        ORDER BY devices DESC
        LIMIT 10
      `,
          TAG,
        ),
      ),

      /**
       * The page a session STARTED on, via `argMin` over the session — not every
       * pageview. That difference is the whole value of the panel: a plain
       * pageview ranking is dominated by the home grid because everyone passes
       * through it, while the entry page is what search or a shared link
       * actually dropped somebody onto.
       */
      safe(
        hogqlNamed<EntryPageRow>(
          `
        SELECT entry AS path, count(DISTINCT distinct_id) AS devices
        FROM (
          SELECT distinct_id,
                 argMin(properties.$pathname, timestamp) AS entry
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= now() - ${WINDOW}
            AND properties.$session_id IS NOT NULL
          GROUP BY distinct_id, properties.$session_id
        )
        WHERE entry != ''
        GROUP BY entry
        ORDER BY devices DESC
        LIMIT 10
      `,
          TAG,
        ),
      ),

      safe(
        hogqlNamed<RetentionRow>(
          `
        SELECT toString(toDate(timestamp)) AS date,
               count(DISTINCT if(toInt(properties.days_played) = 1, distinct_id, NULL)) AS first,
               count(DISTINCT if(toInt(properties.days_played) > 1, distinct_id, NULL)) AS returning
        FROM events
        WHERE event = 'day_played' AND timestamp >= now() - ${WINDOW}
        GROUP BY date
        ORDER BY date ASC
      `,
          TAG,
        ),
      ),

      /**
       * The newest event of ANY kind. This is what separates "nobody visited"
       * from "nothing is reaching us", which otherwise render identically as a
       * screen of zeros — and the second one is a bug, not a marketing result.
       */
      safe(
        hogqlNamed<FreshnessRow>(
          `SELECT toString(max(timestamp)) AS last_event FROM events WHERE timestamp >= now() - INTERVAL 30 DAY`,
          TAG,
        ),
      ),
    ]);

  const t = totals[0];
  const lastEventAt = normaliseLastEvent(freshness[0]?.last_event);

  return {
    devices: toCount(t?.devices),
    firstTimeDevices: toCount(t?.first_devices),
    returningDevices: toCount(t?.returning_devices),
    channels: channels.map((row) => {
      const bucket = toBucket(row.bucket);
      return { bucket, label: channelLabel(bucket), devices: toCount(row.devices) };
    }),
    referrers: referrers.map((row) => ({
      domain: toText(row.domain),
      devices: toCount(row.devices),
    })),
    entryPages: entryPages.map((row) => ({
      path: toText(row.path),
      devices: toCount(row.devices),
    })),
    retention: retention.map((row) => ({
      date: toText(row.date),
      first: toCount(row.first),
      returning: toCount(row.returning),
    })),
    lastEventAt,
    configured: true,
    reporting: isReportingHealthy(lastEventAt, new Date()),
  };
}
