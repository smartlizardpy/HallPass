/**
 * Unit tests for the invite-box parser.
 *
 * This sits in front of a PRIVILEGE GRANT, so the case that matters most is the
 * boundary between the two namespaces: whatever is typed must resolve to exactly
 * one of "an address to store" or "a username to look up", and never silently to
 * the wrong one. The leading-"@" precedence is pinned for that reason.
 *
 * The other half is what it must NOT reject. A lookup deliberately does not
 * apply `validateUsernameFormat`'s claiming policy, so names that could not be
 * claimed today — reserved words, edge underscores, all-digits — still parse,
 * because a player may already hold one.
 */

import { describe, expect, it } from "vitest";

import { parseAdminIdentifier } from "./admin-identifier";

describe("addresses", () => {
  it("takes an email and lowercases it", () => {
    expect(parseAdminIdentifier("  Teammate@Example.COM ")).toEqual({
      kind: "email",
      email: "teammate@example.com",
    });
  });

  it("rejects a malformed address", () => {
    expect(parseAdminIdentifier("teammate@example")).toBeNull();
    expect(parseAdminIdentifier("a@b@c.com")).toBeNull();
  });
});

describe("usernames", () => {
  it("takes a leading @", () => {
    expect(parseAdminIdentifier("@alice")).toEqual({
      kind: "username",
      username: "alice",
    });
  });

  it("takes a bare name with no @ at all", () => {
    expect(parseAdminIdentifier("alice")).toEqual({
      kind: "username",
      username: "alice",
    });
  });

  it("canonicalises case and fullwidth forms the way claiming did", () => {
    expect(parseAdminIdentifier("@Alice_99")).toEqual({
      kind: "username",
      username: "alice_99",
    });
    // NFKC folds fullwidth to plain ASCII, so it finds the same stored row.
    expect(parseAdminIdentifier("＠ａｌｉｃｅ")).toEqual({
      kind: "username",
      username: "alice",
    });
  });

  it("rejects a name that could not be stored", () => {
    expect(parseAdminIdentifier("@ab")).toBeNull(); // too short
    expect(parseAdminIdentifier(`@${"a".repeat(21)}`)).toBeNull(); // too long
    expect(parseAdminIdentifier("@not-a-username")).toBeNull(); // charset
    expect(parseAdminIdentifier("@spaced out")).toBeNull();
  });

  it("still parses names that claiming policy would refuse today", () => {
    // A lookup must not re-litigate claiming: a player may already hold one of
    // these — the `players_username_check` constraint permits all three — and
    // tightening the reserved-word rules must not strand them.
    for (const held of ["@admin", "@12345", "@a__b"]) {
      expect(parseAdminIdentifier(held)).toEqual({
        kind: "username",
        username: held.slice(1),
      });
    }
  });

  it("is permissive rather than exact about what the column allows", () => {
    // `_edge_` cannot be stored (players_username_check requires alphanumeric
    // ends), but the shape check deliberately does not encode that: it would be
    // a second copy of the constraint, free to drift. It simply finds no row and
    // the caller reports "no player is using @…", which is the truth either way.
    expect(parseAdminIdentifier("@_edge_")).toEqual({
      kind: "username",
      username: "_edge_",
    });
  });
});

describe("the boundary between the two", () => {
  it("lets a leading @ win over a later one", () => {
    // Otherwise `@a@b` could be read as an address and grant the wrong account.
    expect(parseAdminIdentifier("@a@b")).toBeNull();
  });

  it("rejects empty and whitespace-only input", () => {
    expect(parseAdminIdentifier("")).toBeNull();
    expect(parseAdminIdentifier("   ")).toBeNull();
    expect(parseAdminIdentifier("@")).toBeNull();
  });
});
