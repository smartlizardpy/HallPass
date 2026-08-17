import { describe, expect, it } from "vitest";
import { namedRows, toCount, toText } from "./hogql-rows";

/**
 * The shape PostHog actually returns for
 * `SELECT count() AS devices, ... FROM events` — values positionally, names in
 * a sibling array. Every test below is written against a real response body
 * rather than a convenient one.
 */
const response = {
  columns: ["bucket", "devices"],
  results: [
    ["tiktok", 42],
    ["", 7],
  ],
};

describe("namedRows", () => {
  it("zips columns onto values so a row can be read by name", () => {
    expect(namedRows(response)).toEqual([
      { bucket: "tiktok", devices: 42 },
      { bucket: "", devices: 7 },
    ]);
  });

  /**
   * The regression this module exists for. Reading the positional response as
   * objects yields `undefined` everywhere, which renders as a confident `0`
   * behind a `??` and as `NaN` in a number formatter — a growth page reporting
   * no visitors at all against a project that was receiving events fine.
   */
  it("never leaves a named field undefined for a column that was selected", () => {
    const rows = namedRows<{ bucket: string; devices: number }>(response);
    expect(rows.every((r) => r.devices !== undefined)).toBe(true);
    expect(rows[0].devices).toBe(42);
  });

  it("keeps positional order rather than matching on value type", () => {
    const rows = namedRows<{ date: string; first: number; returning: number }>({
      columns: ["date", "first", "returning"],
      results: [["2026-08-17", 0, 9]],
    });
    expect(rows[0]).toEqual({ date: "2026-08-17", first: 0, returning: 9 });
  });

  it("passes an already-named row through untouched", () => {
    expect(namedRows({ results: [{ devices: 3 }] })).toEqual([{ devices: 3 }]);
  });

  it("degrades to no rows rather than throwing on a response it cannot read", () => {
    expect(namedRows(null)).toEqual([]);
    expect(namedRows(undefined)).toEqual([]);
    expect(namedRows({})).toEqual([]);
    expect(namedRows({ results: [] })).toEqual([]);
    expect(namedRows({ results: "nope" })).toEqual([]);
    // Values with no names to hang them on are dropped, not guessed at.
    expect(namedRows({ results: [[1, 2]] })).toEqual([]);
  });

  it("names the columns it has and leaves the rest absent", () => {
    expect(namedRows({ columns: ["a", "b"], results: [[1]] })).toEqual([
      { a: 1, b: undefined },
    ]);
  });
});

describe("toCount", () => {
  it("passes a number through", () => {
    expect(toCount(42)).toBe(42);
    expect(toCount(0)).toBe(0);
  });

  /** ClickHouse serialises a big enough integer as a JSON string. */
  it("accepts a numeric string", () => {
    expect(toCount("1284")).toBe(1284);
  });

  /**
   * A NaN does not stay where it is put: it spreads through every sum, share and
   * bar width computed from it, so the boundary is where it has to stop.
   */
  it("turns anything unusable into zero rather than NaN", () => {
    expect(toCount(undefined)).toBe(0);
    expect(toCount(null)).toBe(0);
    expect(toCount("")).toBe(0);
    expect(toCount("not a number")).toBe(0);
    expect(toCount(Number.NaN)).toBe(0);
    expect(toCount(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("toText", () => {
  it("passes a string through, empty string included", () => {
    expect(toText("/game/chroma")).toBe("/game/chroma");
    expect(toText("")).toBe("");
  });

  it("renders an absent value as the empty string PostHog would have sent", () => {
    expect(toText(null)).toBe("");
    expect(toText(undefined)).toBe("");
  });

  it("stringifies a non-string value", () => {
    expect(toText(7)).toBe("7");
  });
});
