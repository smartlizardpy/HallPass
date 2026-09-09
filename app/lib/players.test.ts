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

import { getPlayerByUsername } from "./players";

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
