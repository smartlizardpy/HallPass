/**
 * Tests for the tracker vocabulary.
 *
 * Everything here is pure, so these are cheap. They exist to pin the invariants
 * that a database CHECK enforces but TypeScript cannot: the lane list, the
 * terminal set, and the tag pattern all have a counterpart in
 * `scoreboard/migrations/021_tracker.sql`, and a change to one without the other
 * fails at runtime on a screen nobody re-tested.
 */

import { describe, expect, it } from "vitest";
import {
  BRIEF_MAX,
  DEFAULT_STATUS,
  MAX_TAGS_PER_ITEM,
  STATUS_CHIP_CLASS,
  STATUS_HINT,
  STATUS_LABEL,
  TAG_PATTERN,
  TERMINAL_STATUSES,
  TRACKER_STATUSES,
  isTerminalStatus,
  normalizeTag,
  parseTags,
  toStatus,
} from "./config";

describe("statuses", () => {
  it("gives every lane a label, a hint and a chip class", () => {
    // A missing entry renders as `undefined` — an unlabelled column on the board
    // rather than a type error, which is exactly the failure a test should catch.
    for (const status of TRACKER_STATUSES) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(STATUS_HINT[status]).toBeTruthy();
      expect(STATUS_CHIP_CLASS[status]).toBeTruthy();
    }
  });

  it("lists each status exactly once", () => {
    expect(new Set(TRACKER_STATUSES).size).toBe(TRACKER_STATUSES.length);
  });

  it("keeps parked and declined as distinct statuses", () => {
    // The board's whole reason for existing over a chat message: a reader has to
    // be able to tell "we still want it" from "we already said no". If a future
    // tidy-up collapses these, this is the test that should stop it.
    expect(TRACKER_STATUSES).toContain("parked");
    expect(TRACKER_STATUSES).toContain("declined");
  });

  it("treats exactly shipped and declined as terminal", () => {
    // MUST match `tracker_items_done_at_matches_status`, which enforces
    // `status IN ('shipped','declined') = (done_at IS NOT NULL)`. Adding a
    // terminal status here without editing that CHECK produces a write that the
    // database rejects.
    expect([...TERMINAL_STATUSES].sort()).toEqual(["declined", "shipped"]);
    for (const status of TRACKER_STATUSES) {
      expect(isTerminalStatus(status)).toBe(
        status === "shipped" || status === "declined",
      );
    }
  });

  it("defaults to a real status, and to the first lane", () => {
    expect(TRACKER_STATUSES).toContain(DEFAULT_STATUS);
    // The column DEFAULT is 'new'; the board draws lanes in array order, so a
    // freshly pasted item must land in the lane the reader looks at first.
    expect(TRACKER_STATUSES[0]).toBe(DEFAULT_STATUS);
  });
});

describe("toStatus", () => {
  it("accepts every known status", () => {
    for (const status of TRACKER_STATUSES) {
      expect(toStatus(status)).toBe(status);
    }
  });

  it("rejects anything else", () => {
    // The input is a `<select>` value posted as FormData, i.e. attacker-editable
    // even on an admin-only page. Rejecting to null is what stops it reaching a
    // CHECK constraint as a 500.
    for (const bad of ["", "NEW", "done", "shipped ", null, undefined, 3, {}]) {
      expect(toStatus(bad)).toBeNull();
    }
  });
});

describe("normalizeTag", () => {
  it("lowercases and hyphenates what a person would actually type", () => {
    expect(normalizeTag("Needs Art")).toBe("needs-art");
    expect(normalizeTag("  PWA  ")).toBe("pwa");
    expect(normalizeTag("service_worker")).toBe("service-worker");
  });

  it("squeezes and trims hyphens", () => {
    expect(normalizeTag("a---b")).toBe("a-b");
    expect(normalizeTag("-mobile-")).toBe("mobile");
  });

  it("drops characters the CHECK would reject", () => {
    expect(normalizeTag("perf!!")).toBe("perf");
    expect(normalizeTag("c#")).toBe("c");
  });

  it("returns null when nothing usable is left", () => {
    for (const bad of ["", "   ", "!!!", "---"]) {
      expect(normalizeTag(bad)).toBeNull();
    }
  });

  it("never emits a tag the database would refuse", () => {
    // The property that matters: whatever comes out of here is insertable. A
    // 24-char slice can leave a trailing hyphen, which is why normalizeTag
    // re-trims after slicing.
    const inputs = [
      "a".repeat(50),
      `${"b".repeat(23)}-cccc`,
      "Mixed Case With Spaces And More Words Than Fit",
      "-".repeat(30),
      "9lives",
    ];
    for (const input of inputs) {
      const tag = normalizeTag(input);
      if (tag !== null) {
        expect(tag).toMatch(TAG_PATTERN);
        expect(tag.length).toBeLessThanOrEqual(24);
      }
    }
  });
});

describe("parseTags", () => {
  it("splits on commas and newlines, not spaces", () => {
    // Splitting on spaces would turn "needs art" into `needs` and `art`.
    expect(parseTags("needs art, mobile")).toEqual(["needs-art", "mobile"]);
    expect(parseTags("pwa\nperf")).toEqual(["pwa", "perf"]);
  });

  it("deduplicates after normalising", () => {
    expect(parseTags("PWA, pwa,  Pwa ")).toEqual(["pwa"]);
  });

  it("drops unusable fragments instead of failing the whole submit", () => {
    // Losing a stray "!!!" must not cost someone the spec they just pasted.
    expect(parseTags("pwa, !!!, mobile")).toEqual(["pwa", "mobile"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag${i}`).join(",");
    expect(parseTags(many)).toHaveLength(MAX_TAGS_PER_ITEM);
  });

  it("returns an empty list for an empty field", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("  ,  , ")).toEqual([]);
  });
});

describe("lengths", () => {
  it("keeps the brief cap generous enough to paste a spec into", () => {
    // The number itself is a judgement call; what this pins is the intent. A
    // future "tidy" down to a tweet-sized limit breaks the core use case.
    expect(BRIEF_MAX).toBeGreaterThanOrEqual(10000);
  });
});
