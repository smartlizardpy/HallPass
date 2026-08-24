/**
 * Tests for the alert catalogue and the cooldown key.
 *
 * The properties pinned here are the silent ones: an alert id that no
 * notification kind can render, a cooldown key that does not actually change
 * between windows (an alert that fires once and never again), and thresholds
 * that would let a ratio rule loose with no floor under it.
 */

import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KINDS,
  isNotificationKind,
} from "@/app/lib/notifications/config";
import {
  ALERT_COOLDOWN_HOURS,
  ALERT_IDS,
  ALERT_WINDOW_MINUTES,
  BASELINE_DAYS,
  CONTENT_GAP_MIN_PEOPLE,
  ERROR_ALWAYS,
  ERROR_MIN,
  ERROR_RATIO,
  MIN_BASELINE_DAYS,
  SPIKE_MIN_VISITORS,
  SPIKE_RATIO,
  alertDedupeKey,
  isAlertId,
} from "./config";

const HOUR = 60 * 60 * 1000;

describe("the catalogue", () => {
  it("names a notification kind for every alert", () => {
    // The `satisfies` in config.ts makes this a build error too; asserted here
    // as well because the failure — an alert firing into a kind nothing can
    // render — is silent at runtime.
    for (const id of ALERT_IDS) {
      expect(isNotificationKind(id), id).toBe(true);
    }
  });

  it("only ever alerts an admin", () => {
    // A site-health alert delivered to a player would publish the error rate of
    // the arcade to the people playing it.
    for (const id of ALERT_IDS) {
      expect(NOTIFICATION_KINDS[id].audience, id).toBe("admin");
      expect(NOTIFICATION_KINDS[id].scope, id).toBe("personal");
    }
  });

  it("narrows an untrusted id and drops everything else", () => {
    expect(isAlertId("traffic_spike")).toBe(true);
    expect(isAlertId("challenge_received")).toBe(false);
    expect(isAlertId("../../etc/passwd")).toBe(false);
    expect(isAlertId(null)).toBe(false);
    expect(isAlertId(undefined)).toBe(false);
    expect(isAlertId(7)).toBe(false);
    expect(isAlertId({ id: "traffic_spike" })).toBe(false);
  });
});

describe("thresholds", () => {
  it("pairs every ratio with an absolute floor", () => {
    // A ratio with no floor is a generator of 4am nonsense: two players where
    // the median is zero is an infinite spike and means nothing.
    expect(SPIKE_RATIO).toBeGreaterThan(1);
    expect(SPIKE_MIN_VISITORS).toBeGreaterThan(0);
    expect(ERROR_RATIO).toBeGreaterThan(1);
    expect(ERROR_MIN).toBeGreaterThan(0);
    expect(CONTENT_GAP_MIN_PEOPLE).toBeGreaterThan(1);
  });

  it("sets the no-baseline error floor above the ratio floor", () => {
    // ERROR_ALWAYS fires with nothing to compare against, so it has to be a
    // number that is bad news on its own terms.
    expect(ERROR_ALWAYS).toBeGreaterThan(ERROR_MIN);
  });

  it("asks for fewer baseline days than it collects", () => {
    // Otherwise a single missing day of history mutes every ratio rule.
    expect(MIN_BASELINE_DAYS).toBeGreaterThan(1);
    expect(MIN_BASELINE_DAYS).toBeLessThanOrEqual(BASELINE_DAYS);
  });

  it("measures an hour, matching the baseline's buckets", () => {
    expect(ALERT_WINDOW_MINUTES).toBe(60);
  });
});

describe("alertDedupeKey", () => {
  it("is stable inside one cooldown window", () => {
    const start = 1_700_000_000_000;
    const key = alertDedupeKey("traffic_spike", start);
    // Same window an hour later: the second run of the cron says nothing.
    expect(alertDedupeKey("traffic_spike", start + HOUR)).toBe(key);
  });

  it("changes once the window has passed", () => {
    // The assertion that catches a key which never changes — an alert that
    // fires once and is silent forever after.
    const start = 1_700_000_000_000;
    const later = start + (ALERT_COOLDOWN_HOURS + 1) * HOUR;
    expect(alertDedupeKey("traffic_spike", later)).not.toBe(
      alertDedupeKey("traffic_spike", start),
    );
  });

  it("keeps the alerts apart from each other", () => {
    // A shared key would mean the first alert of a window silenced the rest —
    // an error spike swallowed by a traffic spike that fired ten minutes before.
    const now = 1_700_000_000_000;
    const keys = ALERT_IDS.map((id) => alertDedupeKey(id, now));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("honours a caller's own cooldown length", () => {
    const now = 1_700_000_000_000;
    expect(alertDedupeKey("content_gap", now, 24)).not.toBe(
      alertDedupeKey("content_gap", now, 6),
    );
  });

  it("is namespaced, so it cannot collide with a producer's key", () => {
    // `dedupe_key` is unique across the WHOLE table and other producers write to
    // it too ("game:duskfall", "review:42").
    expect(alertDedupeKey("error_spike", 1_700_000_000_000)).toMatch(
      /^alert:error_spike:\d+$/,
    );
  });
});
