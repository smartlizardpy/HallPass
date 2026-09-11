/**
 * Tests for the stored seat limits.
 *
 * The parsing and the bounds are pinned in `permissions.test.ts`, where they
 * live. What is pinned HERE is the storage contract around them, and every case
 * is one whose violation is silent:
 *
 *   * A limit that reads back as "uncapped" when the settings read fails would
 *     hand out access at exactly the moment nothing can be verified.
 *   * A key built differently at the reader and the writer is a setting that
 *     saves, reports success, and never loads.
 *   * A write that half-applies leaves one cap somebody chose and two they did
 *     not.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppSettings = vi.fn();
const writeAppSettings = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/app-settings", () => ({
  readAppSettings: () => readAppSettings(),
  writeAppSettings: (...args: unknown[]) => writeAppSettings(...args),
  APP_SETTINGS_CACHE_TAG: "app-settings",
}));

import { DEFAULT_ROLE_SEATS, ROLES, roleSeatsKey } from "./permissions";
import { readSeatLimits, writeSeatLimits } from "./role-seats";

beforeEach(() => {
  readAppSettings.mockReset();
  writeAppSettings.mockReset();
  readAppSettings.mockResolvedValue(new Map());
});

describe("readSeatLimits", () => {
  it("returns the shipped defaults when nothing is stored", async () => {
    // A database nobody has ever touched the settings on behaves exactly like a
    // fresh one — the `app_settings` contract, which is why nothing is seeded.
    await expect(readSeatLimits()).resolves.toEqual(DEFAULT_ROLE_SEATS);
  });

  it("returns a stored limit, defaulting the rest", async () => {
    readAppSettings.mockResolvedValue(
      new Map([[roleSeatsKey("beta_admin"), "6"]]),
    );
    await expect(readSeatLimits()).resolves.toEqual({
      ...DEFAULT_ROLE_SEATS,
      beta_admin: 6,
    });
  });

  it("reads back exactly what the writer stored", async () => {
    // The round trip, against the real key builder rather than a literal: a key
    // that disagrees between the two ends saves and never loads.
    await writeSeatLimits({ super_admin: 2, admin: 3, beta_admin: 4 }, "me");
    readAppSettings.mockResolvedValue(new Map(writeAppSettings.mock.calls[0][0]));
    await expect(readSeatLimits()).resolves.toEqual({
      super_admin: 2,
      admin: 3,
      beta_admin: 4,
    });
  });

  it("falls back to the defaults when the read fails", async () => {
    // `readAppSettings` is already fail-soft to an empty map; this pins that the
    // resulting limits are the TIGHTEST known ones and never "no cap".
    readAppSettings.mockResolvedValue(new Map());
    await expect(readSeatLimits()).resolves.toEqual(DEFAULT_ROLE_SEATS);
  });

  it("ignores a value the bounds will not accept", async () => {
    // A row edited by hand in the Neon console is held to the same bounds the
    // settings form is — an out-of-range one must not read as uncapped.
    readAppSettings.mockResolvedValue(
      new Map([
        [roleSeatsKey("admin"), "999999"],
        [roleSeatsKey("super_admin"), "nonsense"],
      ]),
    );
    await expect(readSeatLimits()).resolves.toEqual(DEFAULT_ROLE_SEATS);
  });
});

describe("writeSeatLimits", () => {
  it("writes every role in ONE call", async () => {
    // One statement, not one per key: over the HTTP driver a loop is three round
    // trips that can half-apply, leaving caps nobody chose.
    await writeSeatLimits({ super_admin: 1, admin: 2, beta_admin: 3 }, "me");
    expect(writeAppSettings).toHaveBeenCalledTimes(1);

    const [entries, actor] = writeAppSettings.mock.calls[0];
    expect(actor).toBe("me");
    expect(entries).toHaveLength(ROLES.length);
    expect(new Map(entries).get(roleSeatsKey("admin"))).toBe("2");
  });

  it("stores decimal text, which is what the reader parses", async () => {
    await writeSeatLimits({ super_admin: 1, admin: 1, beta_admin: 10 }, null);
    const [entries] = writeAppSettings.mock.calls[0];
    for (const [, value] of entries) expect(value).toMatch(/^\d+$/);
  });

  it("lets the failure through", async () => {
    // A limit that silently failed to save is worse than an error banner: the
    // operator believes they raised a cap and finds out at the next refusal.
    writeAppSettings.mockRejectedValue(new Error("connection refused"));
    await expect(
      writeSeatLimits(DEFAULT_ROLE_SEATS, "me"),
    ).rejects.toThrow("connection refused");
  });
});
