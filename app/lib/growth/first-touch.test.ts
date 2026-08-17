import { describe, expect, it } from "vitest";
import { readRef } from "./first-touch";

describe("readRef", () => {
  it("pulls a normalised ref out of a query string", () => {
    expect(readRef("?ref=tiktok")).toBe("tiktok");
    expect(readRef("?ref=TikTok")).toBe("tiktok");
    expect(readRef("?q=terraria&ref=discord")).toBe("discord");
  });

  it("returns null when there is no ref — the organic case", () => {
    expect(readRef("")).toBeNull();
    expect(readRef("?q=terraria")).toBeNull();
  });

  it("returns null for a ref that normalises to nothing", () => {
    expect(readRef("?ref=")).toBeNull();
    expect(readRef("?ref=!!!")).toBeNull();
  });

  /**
   * `URLSearchParams` does not throw on a bad percent-escape — it substitutes
   * replacement characters, which the normaliser then strips. So a mangled ref
   * degrades to a harmless value (bucketed as `unknown` in the readout) rather
   * than taking analytics startup down. The try/catch in `readRef` is belt to
   * that braces, for whatever a future runtime decides to reject.
   */
  it("degrades a malformed query instead of breaking analytics startup", () => {
    expect(readRef("%%%")).toBeNull();
    expect(readRef("?ref=%E0%A4%A")).toBe("a");
  });

  it("keeps an unrecognised ref, because capture records what arrived", () => {
    // Bucketing into `unknown` is the READOUT's job — throwing the raw value
    // away here would destroy the evidence that a typo is in circulation.
    expect(readRef("?ref=tik-tok")).toBe("tik-tok");
  });
});
