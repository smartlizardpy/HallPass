/**
 * Tests for the sign-up username suggestion.
 *
 * This matters more than a helper of its size usually would, because the
 * suggestion is PREFILLED into the claim box: if it produces something the
 * validator then rejects, the very first thing a new player sees is their own
 * name being refused, and the step reads as broken. So every case here is really
 * one assertion — the suggestion must always be claimable or empty, never
 * something that fails on submit.
 */

import { describe, expect, it } from "vitest";
import {
  suggestUsernameFrom,
  validateUsernameFormat,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "./username";

/** Every non-empty suggestion must survive the real validator. */
function expectClaimableOrEmpty(input: string | null | undefined) {
  const out = suggestUsernameFrom(input);
  if (out === "") return;
  const verdict = validateUsernameFormat(out);
  expect(
    verdict.ok,
    `suggestUsernameFrom(${JSON.stringify(input)}) produced "${out}", rejected as ${
      verdict.ok ? "" : verdict.reason
    }`,
  ).toBe(true);
}

describe("suggestUsernameFrom", () => {
  it("lowercases an ordinary name", () => {
    expect(suggestUsernameFrom("Ozan")).toBe("ozan");
  });

  it("strips accents rather than replacing them with underscores", () => {
    // "Ateş" must not become "ate_" — a trailing underscore is rejected, and the
    // suggestion would fail on submit for a name that is perfectly usable.
    expect(suggestUsernameFrom("Ateş")).toBe("ates");
  });

  it("collapses spaces and punctuation into single underscores", () => {
    expect(suggestUsernameFrom("Ozan   Kaygusuz")).toBe("ozan_kaygusuz");
    expect(suggestUsernameFrom("Jo$h!!")).toBe("jo_h");
  });

  it("never starts or ends with an underscore", () => {
    expect(suggestUsernameFrom("  !!Josh!!  ")).toBe("josh");
  });

  it("pads a too-short name to the minimum", () => {
    const out = suggestUsernameFrom("Jo");
    expect(out.length).toBeGreaterThanOrEqual(USERNAME_MIN_LENGTH);
    expectClaimableOrEmpty("Jo");
  });

  it("truncates a long name without leaving a trailing underscore", () => {
    const out = suggestUsernameFrom("Bartholomew Featherstonehaugh");
    expect(out.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
    expect(out.endsWith("_")).toBe(false);
    expectClaimableOrEmpty("Bartholomew Featherstonehaugh");
  });

  it("gives up rather than suggest something that would be rejected", () => {
    // All-digit names are refused by the validator, so proposing one would show
    // a new player their own name being turned down.
    expect(suggestUsernameFrom("12345")).toBe("");
    expect(suggestUsernameFrom("!!!")).toBe("");
    expect(suggestUsernameFrom("")).toBe("");
    expect(suggestUsernameFrom(null)).toBe("");
    expect(suggestUsernameFrom(undefined)).toBe("");
  });

  it("produces a claimable name for every realistic input", () => {
    for (const input of [
      "Ozan",
      "Ateş Demir",
      "Ozan Kaygusuz",
      "josh",
      "Jo",
      "X Æ A-12",
      "  spaced  out  ",
      "ALLCAPS",
      "mixed_Case_99",
      "émile",
      "Bartholomew Featherstonehaugh",
      "a",
      "user123",
    ]) {
      expectClaimableOrEmpty(input);
    }
  });
});
