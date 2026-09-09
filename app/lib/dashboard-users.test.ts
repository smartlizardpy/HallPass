/**
 * Unit tests for role resolution — specifically the difference between the two
 * reads, which is the whole point of there being two.
 *
 * `getUserRole` is the store read and MUST keep rejecting: the callers that
 * manage users want a database failure to be loud. `getSessionRole` is the one
 * on the request path of every signed-in visitor, and must never reject, because
 * Auth.js answers a rejection out of the `jwt` callback by resolving the whole
 * session to `null` — which signed players out of the arcade over a role lookup
 * that has nothing to do with them.
 *
 * The env allow-list case is pinned deliberately: it short-circuits before the
 * query, so a `SUPER_ADMIN_EMAILS` address keeps dashboard access straight
 * through an outage, which is when somebody needs to get in and look.
 *
 * Only the pure/failure contract is covered. The SQL itself needs a live Neon
 * connection and is not exercised here; the driver is mocked as a tagged
 * template so the branches around it can be.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  sql: (...args: unknown[]) => query(...args),
  isDbConfigured: () => true,
  isUnconfiguredDbError: () => false,
}));

import { getSessionRole, getUserRole } from "./dashboard-users";

const OUTAGE = new Error("connection refused");

beforeEach(() => {
  query.mockReset();
  delete process.env.SUPER_ADMIN_EMAILS;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getUserRole", () => {
  it("returns the stored role", async () => {
    query.mockResolvedValue([{ role: "admin" }]);
    await expect(getUserRole("Someone@Example.com")).resolves.toBe("admin");
  });

  it("returns null for an unknown user", async () => {
    query.mockResolvedValue([]);
    await expect(getUserRole("nobody@example.com")).resolves.toBeNull();
  });

  it("still rejects when the database is unreachable", async () => {
    // Load-bearing: the management callers want this loud. `getSessionRole` is
    // the one that must not throw, and it would be pointless if this softened.
    query.mockRejectedValue(OUTAGE);
    await expect(getUserRole("someone@example.com")).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("getSessionRole", () => {
  it("returns the stored role when the database answers", async () => {
    query.mockResolvedValue([{ role: "super_admin" }]);
    await expect(getSessionRole("someone@example.com")).resolves.toBe(
      "super_admin",
    );
  });

  it("returns null for a signed-in player with no role", async () => {
    query.mockResolvedValue([]);
    await expect(getSessionRole("player@example.com")).resolves.toBeNull();
  });

  it("resolves to null instead of rejecting when the database is down", async () => {
    query.mockRejectedValue(OUTAGE);
    // The bug: this rejection reached the Auth.js jwt callback, which answered
    // by dropping the entire session rather than just the role.
    await expect(getSessionRole("someone@example.com")).resolves.toBeNull();
  });

  it("fails closed rather than reusing a role", async () => {
    query.mockResolvedValue([{ role: "super_admin" }]);
    await expect(getSessionRole("someone@example.com")).resolves.toBe(
      "super_admin",
    );

    // Same address, database now failing: access is withdrawn, not remembered.
    query.mockRejectedValue(OUTAGE);
    await expect(getSessionRole("someone@example.com")).resolves.toBeNull();
  });

  it("logs the failure without the address", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValue(OUTAGE);

    await getSessionRole("private.person@example.com");

    expect(logged).toHaveBeenCalledTimes(1);
    // This runs on every request of every signed-in visitor; a role lookup
    // failing is systemic, not something about one person.
    expect(JSON.stringify(logged.mock.calls[0])).not.toContain(
      "private.person",
    );
  });

  it("honours the env allow-list without touching the database", async () => {
    process.env.SUPER_ADMIN_EMAILS = "boss@example.com";
    query.mockRejectedValue(OUTAGE);

    // Works straight through an outage, which is when somebody needs to get in.
    await expect(getSessionRole("Boss@Example.com")).resolves.toBe(
      "super_admin",
    );
    expect(query).not.toHaveBeenCalled();
  });
});
