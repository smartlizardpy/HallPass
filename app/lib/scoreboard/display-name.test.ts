/**
 * Tests for the scoreboard's published-name rule. Pure in, pure out — no fake
 * `sql`, no DOM. The assertions that matter are the privacy one (the Google name
 * is not in the chain and cannot be) and the stability one (the same player is
 * the same placeholder everywhere, forever).
 */

import { describe, it, expect } from "vitest";
import { GENERATED_STEMS, isGeneratedName } from "@/sdk/src/names";
import { placeholderName, publicGuestName, publicScoreName } from "./display-name";

const UUID = "11111111-2222-3333-4444-5555aaaa0417";

describe("placeholderName", () => {
  it("builds a stem-and-number name from the public id", () => {
    // Asserted through the shared matcher rather than a hardcoded stem, so
    // editing the list does not break the test that guards the list.
    expect(isGeneratedName(placeholderName(UUID))).toBe(true);
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
      "SigmaAlphaMale#0001",
    );
  });

  it("keeps the low four decimal digits of the tail", () => {
    // 0xaaaa0417 = 2863268887 -> last four digits 8887.
    expect(placeholderName(UUID)).toBe("NPCEnergy#8887");
  });

  it("takes the stem from a different end of the id than the number", () => {
    // Two ids sharing a tail (so sharing a number) must not share a whole name.
    const a = placeholderName("11111111-1111-1111-1111-1111aaaa0417");
    const b = placeholderName("99999999-9999-9999-9999-9999aaaa0417");
    expect(a.endsWith("#8887")).toBe(true);
    expect(b.endsWith("#8887")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("only ever mints a stem from the shared list", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = `${i.toString(16).padStart(8, "0")}-2222-3333-4444-5555aaaa0417`;
      const [stem] = placeholderName(id).split("#");
      expect(GENERATED_STEMS).toContain(stem);
    }
  });

  it("stays inside the 24-character cap a chosen handle is held to", () => {
    for (const stem of GENERATED_STEMS) {
      expect(`${stem}#0000`.length).toBeLessThanOrEqual(24);
    }
  });

  it("uses only characters that survive the handle sanitisers", () => {
    // Anything else would be stripped on the way back in, leaving a minted name
    // unable to match itself — see `sdk/src/names.ts`.
    for (const stem of GENERATED_STEMS) {
      expect(stem).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("has no duplicate stems", () => {
    expect(new Set(GENERATED_STEMS).size).toBe(GENERATED_STEMS.length);
  });

  it("is longer than the 12-character cap on a typed anonymous handle", () => {
    // So a guest cannot type an exact copy of one of these.
    for (const stem of GENERATED_STEMS) {
      expect(`${stem}#0000`.length).toBeGreaterThan(12);
    }
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
      "NPCEnergy#8887",
    );
  });

  it("treats a whitespace-only handle or username as absent", () => {
    expect(publicScoreName({ handle: "   ", username: "  ", ...ids })).toBe(
      "NPCEnergy#8887",
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
    expect(isGeneratedName(published)).toBe(true);
  });
});

describe("publicGuestName", () => {
  it("re-stems a name the old generator minted, keeping its number", () => {
    // A returning guest who was #1053 last week is still #1053.
    expect(publicGuestName("Guest#1053")).toBe("DeluluDemon#1053");
    expect(publicGuestName("Guest#9999")).toMatch(/#9999$/);
    expect(isGeneratedName(publicGuestName("Guest#9999"))).toBe(true);
  });

  it("re-stems the same row to the same name on every render", () => {
    // Derived from the number, never drawn at random: this runs on every render
    // and a random pick would rename the row on every page load.
    const first = publicGuestName("Guest#1053");
    for (let i = 0; i < 20; i += 1) {
      expect(publicGuestName("Guest#1053")).toBe(first);
    }
  });

  it("leaves a name the guest actually typed alone", () => {
    expect(publicGuestName("Ates2")).toBe("Ates2");
    expect(publicGuestName("Guest")).toBe("Guest");
    expect(publicGuestName("xXGuest#1053Xx")).toBe("xXGuest#1053Xx");
    expect(publicGuestName("Guest#105")).toBe("Guest#105");
    expect(publicGuestName("Guest#10531")).toBe("Guest#10531");
  });

  it("passes a current generated name straight through", () => {
    for (const stem of GENERATED_STEMS) {
      expect(publicGuestName(`${stem}#1053`)).toBe(`${stem}#1053`);
    }
  });

  it("does not invent a name for an empty handle", () => {
    // Unreachable in practice — `sanitizeHandle` never stores one — and if it
    // ever happened, a blank row is a truer report than a fabricated number.
    expect(publicGuestName("")).toBe("");
  });
});
