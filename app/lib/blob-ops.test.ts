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
  readBlobOpSwitches,
} = await import("./blob-ops");

beforeEach(() => {
  settings.clear();
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
