/**
 * Tests for the ledger reason vocabulary.
 *
 * These strings are not labels. They are (a) half of the unique key that makes a
 * double-submitted triage form idempotent, and (b) the ONLY surviving evidence
 * of what happened to a report once an outcome deletes it. The roster's counts
 * are reconstructed from them.
 *
 * So the property that matters is a ROUND TRIP: every reason the minting
 * function can produce must be recognised by the predicate that reads it back.
 * A rename that updates one and not the other silently stops counting a
 * tester's accepted reports, and nothing else would notice.
 */

import { describe, expect, it } from "vitest";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUSES,
  BUG_SEVERITIES,
  FINISHED_ASSIGNMENT_STATUSES,
  isActiveAssignment,
  REASON_DUPLICATE,
  REASON_FIXED,
  REMOVAL_REASONS,
  acceptanceReason,
  isAcceptanceReason,
} from "./config";

describe("acceptanceReason", () => {
  it("round-trips through isAcceptanceReason for every bug severity", () => {
    for (const severity of BUG_SEVERITIES) {
      expect(isAcceptanceReason(acceptanceReason("bug", severity))).toBe(true);
    }
  });

  it("round-trips for a feature", () => {
    expect(isAcceptanceReason(acceptanceReason("feature", null))).toBe(true);
  });

  it("gives a bug with no severity a real code, never 'bug:null'", () => {
    // `xpForReport` pays such a report the lowest band rather than throwing, so
    // an award IS written and its reason has to be something readable.
    const reason = acceptanceReason("bug", null);
    expect(reason).not.toContain("null");
    expect(isAcceptanceReason(reason)).toBe(true);
  });

  it("is stable for the same input, which is what the unique index relies on", () => {
    expect(acceptanceReason("bug", "major")).toBe(acceptanceReason("bug", "major"));
  });

  it("distinguishes severities, so re-triage is not mistaken for a repeat", () => {
    const seen = new Set(BUG_SEVERITIES.map((s) => acceptanceReason("bug", s)));
    expect(seen.size).toBe(BUG_SEVERITIES.length);
  });
});

describe("removal reasons", () => {
  it("are NOT acceptance reasons", () => {
    // The roster adds both counts. If a removal reason also read as an
    // acceptance, every fixed report would inflate the accepted column.
    for (const reason of REMOVAL_REASONS) {
      expect(isAcceptanceReason(reason)).toBe(false);
    }
  });

  it("cover both outcomes that delete a report", () => {
    expect(REMOVAL_REASONS).toContain(REASON_FIXED);
    expect(REMOVAL_REASONS).toContain(REASON_DUPLICATE);
  });
});

/**
 * The assignment split, which two pages now render FROM rather than re-deriving.
 *
 * The property worth pinning is that the two halves PARTITION the vocabulary:
 * every status is on exactly one side. A fifth status added to
 * `ASSIGNMENT_STATUSES` lands in the active half automatically, and these tests
 * are what say that was a decision rather than an oversight — if it should be
 * finished instead, the failing assertion is the reminder to say so.
 */
describe("assignment status split", () => {
  it("partitions every status into exactly one half", () => {
    for (const status of ASSIGNMENT_STATUSES) {
      const active = (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
      const finished = (FINISHED_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
      expect(active).not.toBe(finished);
    }
  });

  it("counts a fresh and an in-flight playtest as active", () => {
    expect(isActiveAssignment("assigned")).toBe(true);
    expect(isActiveAssignment("in_progress")).toBe(true);
  });

  it("counts a submitted or closed playtest as finished", () => {
    expect(isActiveAssignment("submitted")).toBe(false);
    expect(isActiveAssignment("closed")).toBe(false);
  });

  it("agrees with the predicate for every status", () => {
    for (const status of ASSIGNMENT_STATUSES) {
      expect(isActiveAssignment(status)).toBe(
        (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status),
      );
    }
  });
});
