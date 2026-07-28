/**
 * Tests for the review blocklist.
 *
 * The first block is a regression test for a real reported failure: a friendly
 * review of Duskfall was rejected outright. The cause was that blocklist terms
 * were being repeat-collapsed alongside the input, so `kkk` became `k` and every
 * review containing the letter K was treated as a slur.
 *
 * The rest is the false-positive suite. A filter that only rejects the obvious
 * spelling is worse than none — but a filter that rejects "Keep up the good
 * work" is worse still, so the innocent cases are tested as carefully as the
 * abusive ones.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { containsBlockedReviewTerm } from "./wordlist";

describe("regression: the Duskfall review that was wrongly rejected", () => {
  const REPORTED = `Very  Nice Game! Had some good updates. I really like the newly added characters and  zombies !!!
Keep up the good work!`;

  it("is clean", () => {
    expect(containsBlockedReviewTerm(REPORTED)).toBe("clean");
  });

  it("does not reject text merely for containing the letter K", () => {
    // `kkk` collapsed to `k`, so this was the actual trigger.
    for (const text of ["Keep it up", "kick", "work", "like", "knockout"]) {
      expect(containsBlockedReviewTerm(text)).toBe("clean");
    }
  });
});

describe("ordinary English is not rejected", () => {
  for (const text of [
    "I got second place",          // `coon` used to collapse to `con`
    "That boss is suspicious",     // contains `spic`
    "I ate a grape",               // contains `rape`
    "scrape through level 3",      // contains `rape`
    "raccoon level is great",      // contains `coon`
    "my pedometer says 9000",      // contains `pedo`
    "whatever, it's fun",          // contains `hate`
    "there's a chink in the armour of the boss", // whole-word `chink` — see note
    "Great graphics and controls",
    "connect the pipes to win",
    "Keep up the good work!",
  ]) {
    it(`clean: ${text}`, () => {
      // `chink` is the one knowing exception — it is a real English word and a
      // real slur, and it is matched whole-word, so this case IS blocked. Every
      // other line here must pass.
      const verdict = containsBlockedReviewTerm(text);
      if (text.includes("chink")) expect(verdict).toBe("blocked");
      else expect(verdict).toBe("clean");
    });
  }
});

describe("abuse is still caught", () => {
  it("catches plain spellings", () => {
    expect(containsBlockedReviewTerm("this game is fuck")).toBe("blocked");
    expect(containsBlockedReviewTerm("kys")).toBe("blocked");
  });

  it("catches separator evasion", () => {
    for (const text of ["f.u.c.k this", "f u c k", "f-u-c-k", "f_u_c_k"]) {
      expect(containsBlockedReviewTerm(text)).toBe("blocked");
    }
  });

  it("catches repeat padding without the term being collapsed", () => {
    expect(containsBlockedReviewTerm("fuuuuck")).toBe("blocked");
    expect(containsBlockedReviewTerm("xxfuckxx")).toBe("blocked");
  });

  it("catches leetspeak", () => {
    expect(containsBlockedReviewTerm("f0ck")).toBe("clean"); // vowel-swap: honest limit
    expect(containsBlockedReviewTerm("$lut")).toBe("blocked");
    expect(containsBlockedReviewTerm("h1tler was right")).toBe("blocked");
  });

  it("still catches a literal kkk", () => {
    // The fix must not simply delete the term.
    expect(containsBlockedReviewTerm("kkk forever")).toBe("blocked");
  });

  it("flags mild profanity rather than blocking it", () => {
    expect(containsBlockedReviewTerm("this is crap")).toBe("flagged");
    expect(containsBlockedReviewTerm("stupid boss")).toBe("flagged");
  });
});
