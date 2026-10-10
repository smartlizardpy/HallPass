import { describe, expect, it } from "vitest";
import {
  MOMENT_DATA_MAX,
  MOMENT_NAME_MAX,
  normaliseMomentName,
  parseMoment,
  sanitiseMomentData,
} from "./moment";

describe("normaliseMomentName", () => {
  it("lowercases and trims", () => {
    expect(normaliseMomentName("  Boss-Phase.2 ")).toBe("boss-phase.2");
  });
  it("rejects non-strings, empties, bad characters and over-long names", () => {
    for (const bad of [undefined, null, 4, {}, "", "  ", "-x", "a b", "a/b", "é"]) {
      expect(normaliseMomentName(bad)).toBeNull();
    }
    expect(normaliseMomentName("a".repeat(MOMENT_NAME_MAX))).not.toBeNull();
    expect(normaliseMomentName("a".repeat(MOMENT_NAME_MAX + 1))).toBeNull();
  });
});

describe("sanitiseMomentData", () => {
  it("treats absent data as none", () => {
    expect(sanitiseMomentData(undefined)).toBeNull();
    expect(sanitiseMomentData(null)).toBeNull();
  });
  it("keeps plain JSON and drops what JSON drops", () => {
    expect(sanitiseMomentData({ x: 1, f() {}, u: undefined, s: "a" })).toEqual({ x: 1, s: "a" });
  });
  it("rejects arrays, primitives, cycles and oversize data", () => {
    expect(sanitiseMomentData([1])).toBeUndefined();
    expect(sanitiseMomentData(5)).toBeUndefined();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(sanitiseMomentData(cyc)).toBeUndefined();
    expect(sanitiseMomentData({ s: "x".repeat(MOMENT_DATA_MAX) })).toBeUndefined();
  });
});

describe("parseMoment", () => {
  it("defaults to taking a picture", () => {
    const r = parseMoment("Dead", { lvl: 3 });
    expect(r).toEqual({ ok: true, moment: { name: "dead", data: { lvl: 3 }, shot: true } });
  });
  it("shot:false is respected, anything else keeps the picture", () => {
    expect(parseMoment("a", undefined, { shot: false })).toMatchObject({ moment: { shot: false } });
    expect(parseMoment("a", undefined, { shot: 0 })).toMatchObject({ moment: { shot: true } });
    expect(parseMoment("a", undefined, "x")).toMatchObject({ moment: { shot: true } });
  });
  it("names the first problem", () => {
    expect(parseMoment("", {})).toEqual({ ok: false, reason: "bad-name" });
    expect(parseMoment("ok", [])).toEqual({ ok: false, reason: "bad-data" });
  });
});
