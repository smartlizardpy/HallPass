import { describe, expect, it } from "vitest";

import { isStaleBuild } from "./build-id";

describe("isStaleBuild", () => {
  it("is stale only when both sides report a different real id", () => {
    expect(isStaleBuild("abc", "def")).toBe(true);
  });

  it("is current when the ids match", () => {
    expect(isStaleBuild("abc", "abc")).toBe(false);
  });

  it("treats an unknown id on either side as not stale", () => {
    expect(isStaleBuild("dev", "def")).toBe(false);
    expect(isStaleBuild("abc", "dev")).toBe(false);
    expect(isStaleBuild("abc", undefined)).toBe(false);
    expect(isStaleBuild("abc", "")).toBe(false);
  });
});
