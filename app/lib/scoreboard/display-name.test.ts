/**
 * Tests for the scoreboard's published-name rule. Pure in, pure out — no fake
 * `sql`, no DOM. The assertions that matter are the privacy one (the Google name
 * is not in the chain and cannot be) and the stability one (the same player is
 * the same placeholder everywhere, forever).
 */

import { describe, it, expect } from "vitest";
import { PLACEHOLDER_STEM, placeholderName, publicScoreName } from "./display-name";

const UUID = "11111111-2222-3333-4444-5555aaaa0417";

describe("placeholderName", () => {
  it("builds a stem-and-number name from the public id", () => {
    expect(placeholderName(UUID)).toMatch(/^SigmaAlphaMale#\d{4}$/);
  });

  it("is stable: the same id always yields the same name", () => {
    expect(placeholderName(UUID)).toBe(placeholderName(UUID));
  });

  it("does not care how the uuid is punctuated", () => {
    expect(placeholderName(UUID)).toBe(placeholderName(UUID.replace(/-/g, "")));
  });

  it("gives different ids different numbers", () => {
    const a = placeholderName("11111111-2222-3333-4444-5555aaaa0417");
    const b = placeholderName("11111111-2222-3333-4444-5555aaaa9999");
    expect(a).not.toBe(b);
  });

  it("zero-pads to a fixed width so the column does not jitter", () => {
    // Tail 0x0001 = 1 -> "0001", not "1".
    expect(placeholderName("00000000-0000-0000-0000-000000000001")).toBe(
      `${PLACEHOLDER_STEM}#0001`,
    );
  });

  it("keeps the low four decimal digits of the tail", () => {
    // 0xaaaa0417 = 2863268887 -> last four digits 8887.
    expect(placeholderName(UUID)).toBe(`${PLACEHOLDER_STEM}#8887`);
  });

  it("stays inside the 24-character cap a chosen handle is held to", () => {
    expect(placeholderName(UUID).length).toBeLessThanOrEqual(24);
  });

  it("is longer than the 12-character cap on an anonymous handle", () => {
    // So a guest submission can never be an exact copy of one of these.
    expect(placeholderName(UUID).length).toBeGreaterThan(12);
  });

  it('answers "Player" rather than inventing a number when there is no id', () => {
    expect(placeholderName(null)).toBe("Player");
    expect(placeholderName(undefined)).toBe("Player");
    expect(placeholderName("")).toBe("Player");
    expect(placeholderName("---")).toBe("Player");
    expect(placeholderName("not-hex-at-all-zzzz")).toBe("Player");
  });
});

describe("publicScoreName", () => {
  const ids = { publicId: UUID };

  it("prefers the handle the player chose", () => {
    expect(publicScoreName({ handle: "Countess", username: "ada", ...ids })).toBe(
      "Countess",
    );
  });

  it("falls back to @username when no handle is set", () => {
    expect(publicScoreName({ handle: null, username: "ada", ...ids })).toBe("@ada");
  });

  it("falls back to the placeholder when neither is set", () => {
    expect(publicScoreName({ handle: null, username: null, ...ids })).toBe(
      `${PLACEHOLDER_STEM}#8887`,
    );
  });

  it("treats a whitespace-only handle or username as absent", () => {
    expect(publicScoreName({ handle: "   ", username: "  ", ...ids })).toBe(
      `${PLACEHOLDER_STEM}#8887`,
    );
  });

  it("trims a handle rather than publishing its padding", () => {
    expect(publicScoreName({ handle: "  Countess  ", username: null, ...ids })).toBe(
      "Countess",
    );
  });

  it("has no way to publish a Google account name", () => {
    // The parameter list is the guarantee: there is no `name` to pass, so no
    // caller can route one through here by mistake.
    const published = publicScoreName({ handle: null, username: null, ...ids });
    expect(published).not.toContain(" ");
    expect(published.startsWith(PLACEHOLDER_STEM)).toBe(true);
  });
});
