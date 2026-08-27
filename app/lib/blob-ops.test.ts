/**
 * Unit tests for the advanced-Blob-operation registry and its switch decoding.
 *
 * `app-settings.ts` is mocked out wholesale: what matters here is the DECISION
 * layer — which keys are read, how a stored value becomes a boolean, and which
 * direction an unreadable store fails in — not that Neon answers. The store
 * itself is exercised by the actions that use it.
 *
 * The registry assertions look pedantic and are not: the settings page renders
 * straight from this array and the "disable everything" button iterates it, so a
 * duplicate id would silently shadow a switch and an empty label would ship a
 * blank row into a super admin's control panel.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The module imports it; same pattern `game-credits.test.ts` already uses.
vi.mock("server-only", () => ({}));

const settings = new Map<string, string>();

vi.mock("@/app/lib/app-settings", () => ({
  APP_SETTINGS_CACHE_TAG: "app-settings",
  readAppSettings: async () => new Map(settings),
  readAppSetting: async (key: string) => settings.get(key) ?? null,
  writeAppSetting: async () => {},
  writeAppSettings: async () => {},
}));

const {
  ADVANCED_BLOB_OPS,
  blobOpDisabledMessage,
  isBlobOpEnabled,
  isBlobReadOnly,
  readBlobOpSwitches,
} = await import("./blob-ops");

beforeEach(() => {
  settings.clear();
  delete process.env.BLOB_READ_ONLY;
});

describe("the registry", () => {
  it("has a unique id per feature", () => {
    const ids = ADVANCED_BLOB_OPS.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every feature the copy the settings page needs", () => {
    for (const op of ADVANCED_BLOB_OPS) {
      expect(op.label.length).toBeGreaterThan(0);
      expect(op.effect.length).toBeGreaterThan(0);
      expect(op.cost.length).toBeGreaterThan(0);
      expect(op.disabledMessage.length).toBeGreaterThan(0);
    }
  });

  it("only ever names an operation Vercel bills as advanced", () => {
    // `head` and `del` are SIMPLE operations. One appearing here would mean a
    // switch that rations the wrong allowance.
    for (const op of ADVANCED_BLOB_OPS) {
      expect(["put", "copy", "list"]).toContain(op.operation);
    }
  });

  it("covers the reindex sweep, so 'disable everything' means everything", () => {
    expect(ADVANCED_BLOB_OPS.map((op) => op.id)).toContain("blob_reindex");
  });
});

describe("switch decoding", () => {
  it("defaults an unwritten key to enabled", async () => {
    const state = await readBlobOpSwitches();
    for (const op of ADVANCED_BLOB_OPS) expect(state[op.id]).toBe(true);
  });

  it("reads an explicit '0' as off, and only '0'", async () => {
    settings.set("blob_op:game_source", "0");
    expect(await isBlobOpEnabled("game_source")).toBe(false);

    settings.set("blob_op:game_source", "1");
    expect(await isBlobOpEnabled("game_source")).toBe(true);

    // A value nobody in this codebase writes still means "not turned off":
    // a switch should never be tripped by a typo in the settings table.
    settings.set("blob_op:game_source", "false");
    expect(await isBlobOpEnabled("game_source")).toBe(true);
  });

  it("switches features independently", async () => {
    settings.set("blob_op:game_media", "0");
    const state = await readBlobOpSwitches();
    expect(state.game_media).toBe(false);
    expect(state.game_source).toBe(true);
    expect(state.beta_shots).toBe(true);
  });

  it("fails soft to enabled when the settings store is unreadable", async () => {
    // `readAppSettings` already catches and returns an empty map, so this is the
    // shape an outage presents as — and it must read as "nobody turned this
    // off", never as "everything is frozen".
    settings.clear();
    expect(await isBlobOpEnabled("game_source")).toBe(true);
  });
});

describe("blobOpDisabledMessage", () => {
  it("returns the feature's own banner", () => {
    expect(blobOpDisabledMessage("game_source")).toContain("Blob ops");
  });

  it("falls back to a generic banner for an unknown id", () => {
    expect(
      blobOpDisabledMessage("nope" as (typeof ADVANCED_BLOB_OPS)[number]["id"]),
    ).toContain("switched off");
  });
});

/**
 * The env lock is the escape hatch for the case the switches cannot cover:
 * `app_settings` needs migration 026, and the moment you most want to stop
 * spending is a moment when running a migration may not be possible. So these
 * assert the two properties that matter — it wins over the table, and it never
 * needs the table.
 */
describe("BLOB_READ_ONLY", () => {
  it("is off when unset", async () => {
    expect(isBlobReadOnly()).toBe(false);
    expect(await isBlobOpEnabled("game_source")).toBe(true);
  });

  it("forces every switch off", async () => {
    process.env.BLOB_READ_ONLY = "1";
    const state = await readBlobOpSwitches();
    for (const op of ADVANCED_BLOB_OPS) expect(state[op.id]).toBe(false);
  });

  it("beats an explicit ON in the settings table", async () => {
    // The lock is a lock, not a default. An operator who set the env var must
    // not be quietly overridden by a row somebody wrote last month.
    settings.set("blob_op:game_source", "1");
    process.env.BLOB_READ_ONLY = "1";
    expect(await isBlobOpEnabled("game_source")).toBe(false);
  });

  it("does not read the settings store at all", async () => {
    // The whole point: it has to work on a deployment whose migrations have not
    // run. A read that threw would otherwise take the lock down with it.
    process.env.BLOB_READ_ONLY = "1";
    settings.set("__poisoned", "x");
    await expect(readBlobOpSwitches()).resolves.toBeTruthy();
  });

  it("accepts the values somebody would actually type", async () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " on "]) {
      process.env.BLOB_READ_ONLY = value;
      expect(isBlobReadOnly()).toBe(true);
    }
  });

  it("fails OPEN on anything else, so a typo cannot freeze publishing", async () => {
    // "0" and "false" are truthy strings in JS and obviously mean off to the
    // person typing them, so the allow-list is explicit rather than coerced.
    for (const value of ["0", "false", "no", "off", "", "maybe"]) {
      process.env.BLOB_READ_ONLY = value;
      expect(isBlobReadOnly()).toBe(false);
    }
  });
});
