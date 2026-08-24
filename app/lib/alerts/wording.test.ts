/**
 * Tests for the alert → wording join.
 *
 * The property that matters is coverage: every alert the rules can produce has
 * to come out as something an admin can read. A kind with no branch here would
 * be a notification filed with an empty body, which nothing else in the stack
 * would catch.
 */

import { describe, expect, it } from "vitest";
import { ALERT_IDS } from "./config";
import { alertCopy } from "./wording";
import type { FiredAlert } from "./rules";

/** One example of every alert the union allows. */
const EVERY_ALERT: FiredAlert[] = [
  { id: "traffic_spike", visitors: 312, baseline: 74, ratio: 4.2 },
  { id: "error_spike", errors: 84, baseline: 14, ratio: 6 },
  { id: "content_gap", term: "geometry dash", people: 9 },
];

describe("alertCopy", () => {
  it("covers every alert in the catalogue", () => {
    expect(EVERY_ALERT.map((a) => a.id).sort()).toEqual([...ALERT_IDS].sort());
  });

  it("gives each one a title, a body and somewhere to land", () => {
    for (const alert of EVERY_ALERT) {
      const copy = alertCopy(alert);
      expect(copy.title.length, alert.id).toBeGreaterThan(0);
      expect(copy.body.length, alert.id).toBeGreaterThan(0);
      expect(copy.url.startsWith("/"), alert.id).toBe(true);
    }
  });

  it("carries the measurement into the wording", () => {
    // The join is where a mis-wired field would show up as a confident wrong
    // number — an error count rendered as the visitor count, say.
    expect(alertCopy(EVERY_ALERT[0]).body).toContain("312");
    expect(alertCopy(EVERY_ALERT[1]).body).toContain("84");
    expect(alertCopy(EVERY_ALERT[2]).body).toContain("geometry dash");
  });

  it("renders a null ratio as words rather than as NaN", () => {
    const copy = alertCopy({ id: "error_spike", errors: 30, baseline: 0, ratio: null });
    expect(copy.body).not.toMatch(/NaN|Infinity/);
    expect(copy.body).toContain("30");
  });
});
