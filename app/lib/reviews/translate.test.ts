/**
 * Tests for the translation helpers that carry the only easy-to-break logic:
 * parsing the untyped `gtx` reply and reducing a browser locale to a target code.
 * `translateReviewBody` itself is a thin `fetch` wrapper and is left to the route.
 */

import { describe, expect, it } from "vitest";
import { normalizeTargetLang, parseGtxResponse } from "./translate";

describe("parseGtxResponse", () => {
  it("joins every translated segment, in order", () => {
    // A long body comes back split; dropping any tuple silently truncates.
    const reply = [
      [
        ["Hello ", "Hola ", null, null],
        ["world", "mundo", null, null],
      ],
      null,
      "es",
    ];
    expect(parseGtxResponse(reply)).toEqual({ text: "Hello world", source: "es" });
  });

  it("reads the detected source language from index 2", () => {
    const reply = [[["Bonjour", "Bonjour", null, null]], null, "fr"];
    expect(parseGtxResponse(reply)?.source).toBe("fr");
  });

  it("falls back to 'auto' when no source is reported", () => {
    const reply = [[["hi", "hi", null, null]], null, null];
    expect(parseGtxResponse(reply)?.source).toBe("auto");
  });

  it("skips a malformed segment rather than aborting the join", () => {
    const reply = [
      [["Good ", "Bon ", null], [null], ["day", "jour", null]],
      null,
      "fr",
    ];
    expect(parseGtxResponse(reply)?.text).toBe("Good day");
  });

  it("returns null for a non-array, a wrong shape, or an empty translation", () => {
    expect(parseGtxResponse(null)).toBeNull();
    expect(parseGtxResponse("nope")).toBeNull();
    expect(parseGtxResponse([null, null, "es"])).toBeNull();
    expect(parseGtxResponse([[["   ", "x", null]], null, "es"])).toBeNull();
  });
});

describe("normalizeTargetLang", () => {
  it("reduces a regional locale to its two-letter base", () => {
    expect(normalizeTargetLang("en-GB")).toBe("en");
    expect(normalizeTargetLang("pt-BR")).toBe("pt");
    expect(normalizeTargetLang("ES")).toBe("es");
  });

  it("keeps Chinese script variants distinct", () => {
    // Script genuinely changes the output, and the endpoint wants the regioned tag.
    expect(normalizeTargetLang("zh")).toBe("zh-CN");
    expect(normalizeTargetLang("zh-CN")).toBe("zh-CN");
    expect(normalizeTargetLang("zh-Hans")).toBe("zh-CN");
    expect(normalizeTargetLang("zh-TW")).toBe("zh-TW");
    expect(normalizeTargetLang("zh-HK")).toBe("zh-TW");
    expect(normalizeTargetLang("zh-Hant")).toBe("zh-TW");
  });

  it("rejects junk, so nothing but letters can reach the request URL", () => {
    expect(normalizeTargetLang("")).toBeNull();
    expect(normalizeTargetLang("english")).toBeNull();
    expect(normalizeTargetLang("e")).toBeNull();
    expect(normalizeTargetLang("../etc")).toBeNull();
    expect(normalizeTargetLang("en&q=x")).toBeNull();
    expect(normalizeTargetLang(42)).toBeNull();
    expect(normalizeTargetLang(null)).toBeNull();
  });
});
