/**
 * Unit tests for `getPlayerByUsername`.
 *
 * The lookup exists to serve the super-admin invite box, so what is pinned here
 * is the part that would be dangerous to get wrong: the username reaches the
 * driver as a BOUND PARAMETER and never as spliced SQL, and a name nobody holds
 * comes back as `null` rather than as some other player's row. The mapped shape
 * carries `email`, which is the whole reason the invite action can use it — and
 * the reason it must stay server-side.
 *
 * The driver is mocked; the real SQL is exercised against a live Neon branch,
 * not from here (see the note in `favorites.test.ts` for the same split).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  sql: (...args: unknown[]) => query(...args),
  isDbConfigured: () => true,
  isUnconfiguredDbError: () => false,
}));

import {
  backfillCountryIfMissing,
  getPlayerByUsername,
  upsertPlayerOnLogin,
} from "./players";

const ROW = {
  id: "sub-alice",
  email: "alice@example.com",
  name: "Alice A",
  image: null,
  handle: "AliceHandle",
  created_at: "2024-01-01T00:00:00.000Z",
  last_login: "2024-06-01T00:00:00.000Z",
};

beforeEach(() => {
  query.mockReset();
});

describe("getPlayerByUsername", () => {
  it("maps the row, email included", async () => {
    query.mockResolvedValue([ROW]);

    const player = await getPlayerByUsername("alice");

    expect(player?.id).toBe("sub-alice");
    // The invite action needs this; it is also why the function is server-only.
    expect(player?.email).toBe("alice@example.com");
    expect(player?.handle).toBe("AliceHandle");
  });

  it("returns null when nobody holds the name", async () => {
    query.mockResolvedValue([]);
    await expect(getPlayerByUsername("nobody_here")).resolves.toBeNull();
  });

  it("binds the username instead of splicing it", async () => {
    query.mockResolvedValue([]);

    await getPlayerByUsername("alice' OR '1'='1");

    // The tagged template hands the driver its static strings plus the value as
    // a separate argument. The value must never appear inside the SQL text.
    const [strings, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(values).toEqual(["alice' OR '1'='1"]);
    expect(strings.join("?")).toContain("WHERE username =");
    expect(strings.join("?")).not.toContain("OR '1'='1");
  });
});

describe("upsertPlayerOnLogin", () => {
  it("binds the detected country as a VALUE on insert", async () => {
    query.mockResolvedValue([]);

    await upsertPlayerOnLogin({
      id: "sub-alice",
      email: "Alice@Example.com",
      country: "gb",
    });

    const [strings, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join("?")).toContain("INSERT INTO players");
    expect(values).toContain("gb");
  });

  it("only backfills country when the existing row has none", async () => {
    // The load-bearing privacy behaviour: a login must record where the
    // account was FIRST detected, not where it is signing in from now. Unlike
    // `handle` (absent from the SET list entirely — a NULL handle is a
    // deliberate choice), `country` DOES appear here, guarded by COALESCE, so
    // a pre-existing row with no country yet (every player who signed up
    // before this column existed) gets one on its next login — but a row that
    // already has a country is never touched again, real driver semantics
    // this mock can't itself exercise (see the module docblock on that split).
    query.mockResolvedValue([]);

    await upsertPlayerOnLogin({
      id: "sub-alice",
      email: "alice@example.com",
      country: "US",
    });

    const [strings] = query.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join("?");
    const conflictClause = sql.slice(sql.indexOf("ON CONFLICT"));
    expect(conflictClause).toContain("COALESCE(players.country, EXCLUDED.country)");
    expect(conflictClause).not.toContain("handle");
  });

  it("defaults to null when no country was detected", async () => {
    query.mockResolvedValue([]);

    await upsertPlayerOnLogin({ id: "sub-bob", email: "bob@example.com" });

    // VALUES order is (id, email, name, image, country) — country is last.
    const [, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(values[4]).toBeNull();
  });
});

describe("backfillCountryIfMissing", () => {
  it("does nothing when no country was detected — never queries the driver", async () => {
    await backfillCountryIfMissing("sub-alice", null);
    expect(query).not.toHaveBeenCalled();
  });

  it("writes the country, guarded by WHERE country IS NULL", async () => {
    query.mockResolvedValue([]);

    await backfillCountryIfMissing("sub-alice", "gb");

    const [strings, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toContain("UPDATE players SET country =");
    expect(sql).toContain("WHERE id =");
    expect(sql).toContain("AND country IS NULL");
    expect(values).toEqual(["gb", "sub-alice"]);
  });
});
