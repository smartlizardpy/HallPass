import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_ACTOR,
  DEFAULT_REPORT_LIMIT,
  MAX_REPORT_LIMIT,
  REVALIDATE_PATHS,
  clampLimit,
  mcpActor,
} from "./config";

describe("clampLimit", () => {
  it("uses the default when the caller says nothing", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_REPORT_LIMIT);
  });

  /**
   * The distinction worth pinning: an absent limit must not mean "as many as
   * possible". A client that omits the argument is not asking for the whole
   * queue, and answering with the ceiling is how an agent's context fills up
   * without anybody choosing it.
   */
  it("does not treat an absent limit as the maximum", () => {
    expect(clampLimit(undefined)).toBeLessThan(MAX_REPORT_LIMIT);
  });

  it("passes a sensible request through unchanged", () => {
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(MAX_REPORT_LIMIT)).toBe(MAX_REPORT_LIMIT);
  });

  it("caps an oversized request rather than refusing it", () => {
    expect(clampLimit(1000)).toBe(MAX_REPORT_LIMIT);
  });

  it("floors to at least one row", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-40)).toBe(1);
  });

  it("floors a fraction instead of emitting one into a SQL LIMIT", () => {
    expect(clampLimit(7.9)).toBe(7);
  });

  it("falls back to the default on non-finite input", () => {
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_REPORT_LIMIT);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_REPORT_LIMIT);
  });
});

describe("mcpActor", () => {
  const original = process.env.MCP_ACTOR;

  beforeEach(() => {
    delete process.env.MCP_ACTOR;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MCP_ACTOR;
    else process.env.MCP_ACTOR = original;
  });

  it("falls back to a value that is obviously not a person", () => {
    expect(mcpActor()).toBe(DEFAULT_MCP_ACTOR);
    // `.invalid` is reserved by RFC 2606 and can never be a real mailbox, so an
    // audit of the XP ledger cannot mistake this row for an admin's decision.
    expect(DEFAULT_MCP_ACTOR).toMatch(/\.invalid$/);
  });

  it("prefers the configured actor", () => {
    process.env.MCP_ACTOR = "bugbot@example.com";
    expect(mcpActor()).toBe("bugbot@example.com");
  });

  /**
   * Read at CALL time, not at import: Vercel and the tests both set the value
   * after this module has already been loaded.
   */
  it("sees a value set after import", () => {
    expect(mcpActor()).toBe(DEFAULT_MCP_ACTOR);
    process.env.MCP_ACTOR = "later@example.com";
    expect(mcpActor()).toBe("later@example.com");
  });

  it("treats a blank actor as unset rather than writing an empty column", () => {
    process.env.MCP_ACTOR = "   ";
    expect(mcpActor()).toBe(DEFAULT_MCP_ACTOR);
  });
});

describe("REVALIDATE_PATHS", () => {
  /**
   * Both halves are load-bearing — the admin queue AND the tester's own page,
   * where a resolved report vanishing and an XP total moving are what the
   * decision looks like from the outside.
   */
  it("covers the admin queue and the tester page", () => {
    expect(REVALIDATE_PATHS).toContain("/dashboard/beta");
    expect(REVALIDATE_PATHS).toContain("/beta");
  });
});
