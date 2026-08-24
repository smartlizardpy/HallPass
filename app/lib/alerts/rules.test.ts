/**
 * Tests for the site's alerting judgement.
 *
 * This is the file that exists so nobody has to wait for 4am to find out what
 * the rules do. Every case is a snapshot the cron could genuinely produce, and
 * the ones asserting SILENCE matter more than the ones asserting an alert: an
 * alert that fires when it should not is how a feature ends up muted, after
 * which the alert that mattered is muted too.
 */

import { describe, expect, it } from "vitest";
import {
  CONTENT_GAP_MIN_PEOPLE,
  ERROR_ALWAYS,
  ERROR_MIN,
  MIN_BASELINE_DAYS,
  SPIKE_MIN_VISITORS,
} from "./config";
import {
  evaluateAlerts,
  median,
  parseFiredAlert,
  type AlertSnapshot,
} from "./rules";

/** A quiet, healthy site with a full week of history. Nothing fires from this. */
const QUIET: AlertSnapshot = {
  takenAt: "2026-08-24T13:00:00.000Z",
  windowMinutes: 60,
  current: { visitors: 40, errors: 1 },
  baseline: {
    visitors: [38, 41, 44, 36, 39, 42, 40],
    errors: [1, 0, 2, 1, 0, 1, 1],
  },
  missingGames: [{ term: "geometry dash", people: 2 }],
};

const snapshot = (patch: Partial<AlertSnapshot>): AlertSnapshot => ({
  ...QUIET,
  ...patch,
  current: { ...QUIET.current, ...patch.current },
  baseline: { ...QUIET.baseline, ...patch.baseline },
});

const ids = (s: AlertSnapshot) => evaluateAlerts(s).map((a) => a.id);

describe("median", () => {
  it("takes the middle of an odd sample", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middles of an even sample", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("refuses a sample too short to have an opinion", () => {
    // The denominator guard: firing on a missing baseline is how alerting earns
    // itself a filter rule in somebody's inbox.
    expect(median([10, 10])).toBe(null);
    expect(median([])).toBe(null);
    expect(median([10, 10], 2)).toBe(10);
  });

  it("treats junk values as zero rather than poisoning the sample", () => {
    // A HogQL count can come back as a string, and a NaN would spread through
    // every comparison it touches.
    expect(median([1, 3, 5])).toBe(3);
    expect(median([Number.NaN, 3, 5, 5, 5])).toBe(5);
    expect(median([-4, 0, 0, 0, 0])).toBe(0);
  });
});

describe("a quiet site", () => {
  it("says nothing at all", () => {
    expect(evaluateAlerts(QUIET)).toEqual([]);
  });

  it("says nothing when a busy hour is merely busy", () => {
    // Half again the usual is a good Tuesday, not news.
    expect(ids(snapshot({ current: { visitors: 60, errors: 1 } }))).toEqual([]);
  });
});

describe("traffic_spike", () => {
  it("fires on three times the usual for this hour", () => {
    const fired = evaluateAlerts(snapshot({ current: { visitors: 160, errors: 1 } }));
    expect(fired).toEqual([
      { id: "traffic_spike", visitors: 160, baseline: 40, ratio: 4 },
    ]);
  });

  it("stays quiet below the floor, however large the ratio", () => {
    // Twelve players against a median of one is a twelvefold spike and is four
    // friends opening the site at a bus stop. This is the 4am guard.
    const s = snapshot({
      current: { visitors: SPIKE_MIN_VISITORS - 1, errors: 0 },
      baseline: { visitors: [1, 0, 1, 2, 1, 0, 1], errors: [0, 0, 0, 0, 0, 0, 0] },
    });
    expect(ids(s)).toEqual([]);
  });

  it("stays quiet with too little history to compare against", () => {
    // A brand-new deploy has nothing to be a multiple of, so its first busy hour
    // is not a spike — it is the only hour.
    const s = snapshot({
      current: { visitors: 500, errors: 0 },
      baseline: {
        visitors: new Array(MIN_BASELINE_DAYS - 1).fill(3),
        errors: [0, 0, 0, 0, 0, 0, 0],
      },
    });
    expect(ids(s)).toEqual([]);
  });

  it("stays quiet when the same hour has always been dead", () => {
    // A zero median cannot be divided by, and 30 players at 4am is a fine thing
    // to discover in the morning rather than at 4am.
    const s = snapshot({
      current: { visitors: 30, errors: 0 },
      baseline: { visitors: [0, 0, 0, 0, 0, 0, 0], errors: [0, 0, 0, 0, 0, 0, 0] },
    });
    expect(ids(s)).toEqual([]);
  });

  it("is not dragged up by one viral afternoon in the baseline", () => {
    // The reason for a median over a mean: the mean of this week is 156, so a
    // mean-based rule would need 468 players to notice the next real surge.
    const s = snapshot({
      current: { visitors: 150, errors: 0 },
      baseline: { visitors: [40, 38, 900, 42, 39, 41, 40], errors: [0, 0, 0, 0, 0, 0, 0] },
    });
    expect(ids(s)).toEqual(["traffic_spike"]);
  });
});

describe("error_spike", () => {
  it("fires on a multiple of a normal error rate", () => {
    const fired = evaluateAlerts(snapshot({ current: { visitors: 40, errors: 60 } }));
    expect(fired).toEqual([
      { id: "error_spike", errors: 60, baseline: 1, ratio: 60 },
    ]);
  });

  it("fires from a silent baseline with a null ratio, not an infinite one", () => {
    // "Unlike every other hour this week" is the strongest signal there is, but
    // there is nothing to divide by — and `Infinity×` on a lock screen is the
    // failure this branch exists to prevent.
    const s = snapshot({
      current: { visitors: 40, errors: ERROR_MIN },
      baseline: { visitors: [38, 41, 44, 36, 39, 42, 40], errors: [0, 0, 0, 0, 0, 0, 0] },
    });
    expect(evaluateAlerts(s)).toEqual([
      { id: "error_spike", errors: ERROR_MIN, baseline: 0, ratio: null },
    ]);
  });

  it("does not call a site that always throws errors an incident", () => {
    // A hundred errors where the median is two hundred is a QUIET hour. An
    // absolute-threshold rule would report it as an emergency.
    const s = snapshot({
      current: { visitors: 40, errors: 100 },
      baseline: {
        visitors: [38, 41, 44, 36, 39, 42, 40],
        errors: [200, 190, 210, 205, 195, 200, 200],
      },
    });
    expect(ids(s)).toEqual([]);
  });

  it("stays quiet on a small jump that happens to be a big multiple", () => {
    // 2 → 8 is fourfold and is nothing. ERROR_MIN is what says so.
    const s = snapshot({
      current: { visitors: 40, errors: 8 },
      baseline: { visitors: [38, 41, 44, 36, 39, 42, 40], errors: [2, 2, 2, 2, 2, 2, 2] },
    });
    expect(ids(s)).toEqual([]);
  });

  it("needs an obviously bad number when there is no baseline at all", () => {
    // The deploy-broke-everything case: the week of history is exactly what is
    // missing, so only a figure that is bad on its own terms counts.
    const thin = { visitors: [40, 40], errors: [1, 1] };
    expect(
      ids(snapshot({ current: { visitors: 40, errors: ERROR_ALWAYS - 1 }, baseline: thin })),
    ).toEqual([]);
    expect(
      evaluateAlerts(
        snapshot({ current: { visitors: 40, errors: ERROR_ALWAYS }, baseline: thin }),
      ),
    ).toEqual([{ id: "error_spike", errors: ERROR_ALWAYS, baseline: null, ratio: null }]);
  });
});

describe("content_gap", () => {
  it("fires on the most-wanted missing game", () => {
    const s = snapshot({
      missingGames: [
        { term: "geometry dash", people: 9 },
        { term: "bloxd io", people: 6 },
      ],
    });
    expect(evaluateAlerts(s)).toEqual([
      { id: "content_gap", term: "geometry dash", people: 9 },
    ]);
  });

  it("reports ONE alert however long the list is", () => {
    // A day of misses is a list, and the dashboard is where a list belongs. One
    // notification per term would turn a good week of search traffic into a bad
    // afternoon of buzzing.
    const s = snapshot({
      missingGames: Array.from({ length: 20 }, (_, i) => ({
        term: `game ${i}`,
        people: 10 + i,
      })),
    });
    expect(evaluateAlerts(s)).toEqual([
      { id: "content_gap", term: "game 19", people: 29 },
    ]);
  });

  it("takes the maximum itself rather than trusting the caller's ORDER BY", () => {
    const s = snapshot({
      missingGames: [
        { term: "bloxd io", people: 6 },
        { term: "geometry dash", people: 11 },
      ],
    });
    expect(evaluateAlerts(s)).toEqual([
      { id: "content_gap", term: "geometry dash", people: 11 },
    ]);
  });

  it("stays quiet below the threshold, and on a blank term", () => {
    expect(
      ids(snapshot({ missingGames: [{ term: "x", people: CONTENT_GAP_MIN_PEOPLE - 1 }] })),
    ).toEqual([]);
    expect(ids(snapshot({ missingGames: [{ term: "   ", people: 50 }] }))).toEqual([]);
    expect(ids(snapshot({ missingGames: [] }))).toEqual([]);
  });
});

describe("evaluateAlerts", () => {
  it("reports every alert that fired, in catalogue order", () => {
    const s = snapshot({
      current: { visitors: 200, errors: 80 },
      missingGames: [{ term: "geometry dash", people: 9 }],
    });
    expect(ids(s)).toEqual(["traffic_spike", "error_spike", "content_gap"]);
  });

  it("degrades to silence on a malformed snapshot rather than throwing", () => {
    // The only thing this path can do is wake somebody up, so every unknown
    // falls the quiet way.
    const broken = {
      takenAt: "",
      windowMinutes: 60,
      current: {},
      baseline: {},
      missingGames: undefined,
    } as unknown as AlertSnapshot;
    expect(() => evaluateAlerts(broken)).not.toThrow();
    expect(evaluateAlerts(broken)).toEqual([]);
  });
});

describe("parseFiredAlert", () => {
  it("round-trips what the rules produced", () => {
    const s = snapshot({
      current: { visitors: 200, errors: 80 },
      missingGames: [{ term: "geometry dash", people: 9 }],
    });
    for (const alert of evaluateAlerts(s)) {
      expect(parseFiredAlert(JSON.parse(JSON.stringify(alert)))).toEqual(alert);
    }
  });

  it("keeps a null ratio null instead of turning it into a number", () => {
    // The copy branches on it; a 0 here would render "0× the usual".
    expect(parseFiredAlert({ id: "error_spike", errors: 30, baseline: 0, ratio: null })).toEqual(
      { id: "error_spike", errors: 30, baseline: 0, ratio: null },
    );
  });

  it("rejects an unknown id", () => {
    // `kind` is free TEXT in the database, so an unchecked id would file a
    // notification no deploy can render.
    expect(parseFiredAlert({ id: "challenge_received", visitors: 9 })).toBe(null);
    expect(parseFiredAlert({ id: "rm -rf", visitors: 9 })).toBe(null);
  });

  it("rejects an alert with nothing to say", () => {
    expect(parseFiredAlert({ id: "traffic_spike" })).toBe(null);
    expect(parseFiredAlert({ id: "traffic_spike", visitors: 0, ratio: 4 })).toBe(null);
    expect(parseFiredAlert({ id: "content_gap", term: "", people: 9 })).toBe(null);
    expect(parseFiredAlert({ id: "content_gap", term: "x", people: 0 })).toBe(null);
  });

  it("rejects anything that is not an object", () => {
    for (const junk of [null, undefined, "traffic_spike", 42, []]) {
      expect(parseFiredAlert(junk)).toBe(null);
    }
  });

  it("coerces a numeric string, as a JSON round trip can produce", () => {
    expect(
      parseFiredAlert({ id: "traffic_spike", visitors: "160", baseline: "40", ratio: "4" }),
    ).toEqual({ id: "traffic_spike", visitors: 160, baseline: 40, ratio: 4 });
  });
});
