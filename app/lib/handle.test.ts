/**
 * Tests for display-handle validation.
 *
 * The suggestion tests matter most: the whole reason this step exists is that a
 * player's FULL Google name was becoming their public leaderboard name by
 * default, so a suggestion that hands the full name back would defeat it.
 */

import { describe, expect, it } from "vitest";
import {
  HANDLE_MAX_LENGTH,
  cleanHandle,
  suggestHandleFromName,
  validateHandle,
} from "./handle";

describe("cleanHandle", () => {
  it("collapses whitespace and trims", () => {
    expect(cleanHandle("  Neon   Runner  ")).toBe("Neon Runner");
  });

  it("strips zero-width characters, which render as a blank name", () => {
    expect(cleanHandle("Ne​on")).toBe("Neon");
  });

  it("strips bidi overrides, which can reorder a leaderboard row", () => {
    expect(cleanHandle("safe‮name")).toBe("safename");
  });

  it("caps the length", () => {
    expect(cleanHandle("x".repeat(80))).toHaveLength(HANDLE_MAX_LENGTH);
  });
});

describe("validateHandle", () => {
  it("accepts ordinary names, spaces and emoji", () => {
    for (const name of ["Ozan", "Neon Runner", "player_1", "Ozan 🔥"]) {
      expect(validateHandle(name)).toEqual({ ok: true, handle: name });
    }
  });

  it("rejects empty and whitespace-only", () => {
    expect(validateHandle("")).toEqual({ ok: false, reason: "empty" });
    expect(validateHandle("   ")).toEqual({ ok: false, reason: "empty" });
    // Invisible-only input must not read as a valid name.
    expect(validateHandle("​​​")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a single character", () => {
    expect(validateHandle("x")).toEqual({ ok: false, reason: "too-short" });
  });

  it("counts emoji as one character, not two", () => {
    expect(validateHandle("🔥")).toEqual({ ok: false, reason: "too-short" });
    expect(validateHandle("🔥🔥").ok).toBe(true);
  });

  it("rejects impersonation of the site or staff", () => {
    for (const name of ["HallPass", "hall pass", "Moderator", "ADMIN", "Staff"]) {
      expect(validateHandle(name)).toEqual({ ok: false, reason: "reserved" });
    }
  });

  it("rejects non-strings", () => {
    expect(validateHandle(null)).toEqual({ ok: false, reason: "empty" });
    expect(validateHandle(42)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("suggestHandleFromName", () => {
  it("suggests the FIRST name only — never the surname", () => {
    // Suggesting the full name would reproduce the exact problem this step
    // exists to fix, just with a click in between.
    expect(suggestHandleFromName("Emma Fitzgerald")).toBe("Emma");
    expect(suggestHandleFromName("Ozan Kaygusuz")).toBe("Ozan");
  });

  it("returns empty when there is nothing usable", () => {
    expect(suggestHandleFromName(null)).toBe("");
    expect(suggestHandleFromName("")).toBe("");
    expect(suggestHandleFromName("A B")).toBe(""); // first name too short
  });
});
