import { describe, expect, it } from "vitest";
import { countryDisplayName, countryFlagEmoji } from "./countries";

describe("countryFlagEmoji", () => {
  it("builds the flag from the regional indicator pair", () => {
    expect(countryFlagEmoji("GB")).toBe("🇬🇧");
    expect(countryFlagEmoji("US")).toBe("🇺🇸");
    expect(countryFlagEmoji("TR")).toBe("🇹🇷");
  });

  it("is case-insensitive", () => {
    expect(countryFlagEmoji("gb")).toBe("🇬🇧");
  });

  it("falls back to a globe for unknown/implausible codes", () => {
    expect(countryFlagEmoji(null)).toBe("🌐");
    expect(countryFlagEmoji("XYZ")).toBe("🌐");
    expect(countryFlagEmoji("")).toBe("🌐");
  });
});

describe("countryDisplayName", () => {
  it("resolves the English country name", () => {
    expect(countryDisplayName("GB")).toBe("United Kingdom");
    expect(countryDisplayName("US")).toBe("United States");
    expect(countryDisplayName("IQ")).toBe("Iraq");
    expect(countryDisplayName("TR")).toBe("Türkiye");
  });

  it("reads null as Unknown", () => {
    expect(countryDisplayName(null)).toBe("Unknown");
  });

  it("falls back to the raw code for something Intl cannot resolve at all", () => {
    // Well-formed-but-unassigned codes like "ZZ" resolve to a CLDR label
    // ("Unknown Region"); a malformed one throws, and that's the fallback path.
    expect(countryDisplayName("ZZZ")).toBe("ZZZ");
  });
});
