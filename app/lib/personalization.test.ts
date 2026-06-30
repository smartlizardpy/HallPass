/**
 * Unit tests for the PURE personalization helpers (`personalization.ts`). These
 * helpers are window-free and side-effect-free, so they run in the default `node`
 * env with no DOM or localStorage needed — the SSR-safety case is exercised
 * directly via `readSlugs(null)` (the same guarded return path the store hits when
 * `window`/storage is unavailable). The React hooks and the live store wiring are
 * intentionally NOT covered here (no DOM, no live DB), per the brief.
 */

import { describe, expect, it } from "vitest";
import {
  mergeSlugs,
  prependCapped,
  readSlugs,
  toggleSlug,
  writeSlugs,
} from "./personalization";

describe("readSlugs", () => {
  it("parses a stored JSON string array", () => {
    expect(readSlugs('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  it("returns [] for null (SSR / missing key — no window)", () => {
    expect(readSlugs(null)).toEqual([]);
  });

  it("returns [] for corrupt JSON instead of throwing", () => {
    expect(readSlugs("{not json")).toEqual([]);
    expect(readSlugs("")).toEqual([]);
  });

  it("returns [] when the payload is valid JSON but not an array", () => {
    expect(readSlugs('{"a":1}')).toEqual([]);
    expect(readSlugs('"a"')).toEqual([]);
    expect(readSlugs("42")).toEqual([]);
  });

  it("keeps only string elements (drops numbers/objects/null)", () => {
    expect(readSlugs('["a",1,null,{"x":1},"b"]')).toEqual(["a", "b"]);
  });

  it("round-trips with writeSlugs", () => {
    const list = ["snake", "tetris", "pong"];
    expect(readSlugs(writeSlugs(list))).toEqual(list);
  });
});

describe("toggleSlug (favorites)", () => {
  it("prepends a new slug (most-recent-first)", () => {
    expect(toggleSlug(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("adds to the front of an empty list", () => {
    expect(toggleSlug([], "a")).toEqual(["a"]);
  });

  it("removes an already-present slug", () => {
    expect(toggleSlug(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b"];
    toggleSlug(input, "c");
    toggleSlug(input, "a");
    expect(input).toEqual(["a", "b"]);
  });

  it("toggling the same slug twice returns it to the front and back to absent", () => {
    const added = toggleSlug(["x", "y"], "z");
    expect(added).toEqual(["z", "x", "y"]);
    expect(toggleSlug(added, "z")).toEqual(["x", "y"]);
  });
});

describe("prependCapped (recently played)", () => {
  it("prepends a new slug", () => {
    expect(prependCapped(["a", "b"], "c", 12)).toEqual(["c", "a", "b"]);
  });

  it("de-dupes by moving an existing slug to the front", () => {
    expect(prependCapped(["a", "b", "c"], "c", 12)).toEqual(["c", "a", "b"]);
    expect(prependCapped(["a", "b", "c"], "b", 12)).toEqual(["b", "a", "c"]);
  });

  it("caps the list length, dropping the oldest entries", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `g${i}`);
    const result = prependCapped(twelve, "new", 12);
    expect(result).toHaveLength(12);
    expect(result[0]).toBe("new");
    // The oldest ("g11") falls off the end.
    expect(result).not.toContain("g11");
    expect(result[11]).toBe("g10");
  });

  it("moving an existing slug to the front does not grow the list past the cap", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `g${i}`);
    const result = prependCapped(twelve, "g5", 12);
    expect(result).toHaveLength(12);
    expect(result[0]).toBe("g5");
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b"];
    prependCapped(input, "c", 12);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("mergeSlugs (login union)", () => {
  it("keeps local first, then appends server-only slugs", () => {
    expect(mergeSlugs(["a", "b"], ["b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("de-dupes across and within sources, preserving order", () => {
    expect(mergeSlugs(["a"], ["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("returns local unchanged when the server list is empty", () => {
    expect(mergeSlugs(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("returns server list when local is empty", () => {
    expect(mergeSlugs([], ["x", "y"])).toEqual(["x", "y"]);
  });
});
