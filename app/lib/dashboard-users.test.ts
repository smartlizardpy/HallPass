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
 * The seat cases below pin the JS side of the same divide. The counting and the
 * refusing happen inside the statement, so what is testable without Neon is how
 * this module READS the row that comes back — and one of those readings is
 * load-bearing: a write that did not happen is ambiguous ("no seat" or "no such
 * row"), and resolving it the wrong way round turns every stale-row no-op into a
 * banner naming a role that has seats going spare.
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

/**
 * The seat limits are mocked rather than left to fall through to the same `sql`
 * mock the writes use. Two reasons, and the second is the load-bearing one:
 * a settings read sharing the mock would consume the call the assertions below
 * index into, and a test that cannot say what the limit WAS cannot tell a
 * refusal at three from a refusal at any other number.
 */
const seatLimits = vi.fn();
vi.mock("@/app/lib/role-seats", () => ({
  readSeatLimits: () => seatLimits(),
}));

import {
  addUser,
  countRoleSeats,
  getSessionRole,
  getUserRole,
  setRole,
} from "./dashboard-users";

const OUTAGE = new Error("connection refused");

beforeEach(() => {
  query.mockReset();
  seatLimits.mockReset();
  seatLimits.mockResolvedValue({ super_admin: 1, admin: 1, beta_admin: 3 });
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

describe("countRoleSeats", () => {
  it("returns a full record, zero for a role nobody holds", async () => {
    query.mockResolvedValue([{ role: "admin", held: 1 }]);
    // Zero rather than undefined: `undefined < 1` is `NaN < 1`, which is false,
    // which would refuse every grant on a nearly-empty database.
    await expect(countRoleSeats()).resolves.toEqual({
      beta_admin: 0,
      admin: 1,
      super_admin: 0,
    });
  });

  it("counts every role the ladder knows", async () => {
    query.mockResolvedValue([
      { role: "beta_admin", held: 3 },
      { role: "admin", held: 1 },
      { role: "super_admin", held: 1 },
    ]);
    await expect(countRoleSeats()).resolves.toEqual({
      beta_admin: 3,
      admin: 1,
      super_admin: 1,
    });
  });

  it("ignores a role the CHECK would not accept", async () => {
    query.mockResolvedValue([
      { role: "admin", held: 1 },
      { role: "owner", held: 2 },
    ]);
    // `getUserRole` denies such a value, so the row grants nothing. Counting it
    // would hold seats against somebody who cannot sign in at all.
    await expect(countRoleSeats()).resolves.toEqual({
      beta_admin: 0,
      admin: 1,
      super_admin: 0,
    });
  });

  it("rejects when the database is unreachable", async () => {
    // Loud, like the other management reads: the caller renders a notice rather
    // than a screen that silently claims every seat is free.
    query.mockRejectedValue(OUTAGE);
    await expect(countRoleSeats()).rejects.toThrow("connection refused");
  });
});

describe("seat-aware writes", () => {
  it("reports success when the row was written", async () => {
    query.mockResolvedValue([{ taken: 0, granted: true }]);
    await expect(addUser("New@Example.com", "admin", "boss@example.com"))
      .resolves.toEqual({ ok: true });
  });

  it("reports the refusal with the count behind it", async () => {
    query.mockResolvedValue([{ taken: 1, granted: false }]);
    // The count rides along so the banner can say "1 of 1" — the reader is
    // deciding who loses the seat, not merely being told there is none.
    await expect(addUser("new@example.com", "admin", "boss@example.com"))
      .resolves.toEqual({ ok: false, taken: 1, limit: 1 });
  });

  it("refuses only once the role is genuinely at its cap", async () => {
    query.mockResolvedValue([{ taken: 2, granted: true }]);
    await expect(addUser("third@example.com", "beta_admin", "boss@example.com"))
      .resolves.toEqual({ ok: true });

    query.mockResolvedValue([{ taken: 3, granted: false }]);
    await expect(addUser("fourth@example.com", "beta_admin", "boss@example.com"))
      .resolves.toEqual({ ok: false, taken: 3, limit: 3 });
  });

  it("reads a no-op with seats free as success, not as a full role", async () => {
    // THE ambiguous case: `setRole` writes nothing for an email with no row.
    // Read as a refusal it would put "no admin seats left" on screen while the
    // admin seat sat empty, and send somebody hunting for a user to remove.
    query.mockResolvedValue([{ taken: 0, granted: false }]);
    await expect(setRole("ghost@example.com", "admin")).resolves.toEqual({
      ok: true,
    });
  });

  it("refuses a role change that would exceed the cap", async () => {
    query.mockResolvedValue([{ taken: 1, granted: false }]);
    await expect(setRole("someone@example.com", "super_admin")).resolves.toEqual(
      { ok: false, taken: 1, limit: 1 },
    );
  });

  it("counts against the STORED limit, not the shipped default", async () => {
    // The settings page would be decorative otherwise. A raised cap has to let
    // the write through, and the refusal has to report the raised number.
    seatLimits.mockResolvedValue({ super_admin: 1, admin: 1, beta_admin: 5 });
    query.mockResolvedValue([{ taken: 3, granted: true }]);
    await expect(
      addUser("fourth@example.com", "beta_admin", "boss@example.com"),
    ).resolves.toEqual({ ok: true });

    query.mockResolvedValue([{ taken: 5, granted: false }]);
    await expect(
      addUser("sixth@example.com", "beta_admin", "boss@example.com"),
    ).resolves.toEqual({ ok: false, taken: 5, limit: 5 });
  });

  it("binds the limit into the statement that writes", async () => {
    // Bound as a value, so the comparison the database makes is the one the
    // settings say — not one baked in when the module was compiled.
    seatLimits.mockResolvedValue({ super_admin: 1, admin: 7, beta_admin: 3 });
    query.mockResolvedValue([{ taken: 0, granted: true }]);
    await addUser("new@example.com", "admin", "boss@example.com");
    expect(query.mock.calls[0]).toContain(7);
  });

  it("still rejects when the database is unreachable", async () => {
    // A refusal is a decision and a rejection is a breakage; the action renders
    // different banners for them, so they must not collapse into one another.
    query.mockRejectedValue(OUTAGE);
    await expect(
      addUser("new@example.com", "admin", "boss@example.com"),
    ).rejects.toThrow("connection refused");
    await expect(setRole("new@example.com", "admin")).rejects.toThrow(
      "connection refused",
    );
  });

  it("normalises the email before it reaches the statement", async () => {
    query.mockResolvedValue([{ taken: 0, granted: true }]);
    await addUser("  Mixed.Case@Example.COM  ", "admin", "boss@example.com");
    // The PRIMARY KEY is lowercase, so a row written under a mixed-case address
    // would be access granted to nobody.
    expect(JSON.stringify(query.mock.calls[0])).toContain(
      "mixed.case@example.com",
    );
  });
});
