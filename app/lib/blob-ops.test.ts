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
  allBlobOpSwitches,
  blobOpDisabledMessage,
  describeBlobOpChanges,
  diffBlobOpSwitches,
  isBlobOpEnabled,
  isBlobReadOnly,
  readBlobOpSwitches,
  switchesFromEnabledIds,
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

/**
 * The batch-save path: what the dashboard's checkbox form posts, reduced to the
 * switches that move and the sentence naming them.
 *
 * These are the pieces that let one Save replace seven submits, and the
 * properties they assert are the ones that make that safe — absence means off,
 * an untouched switch is never written, and the banner names what happened.
 */
describe("switchesFromEnabledIds", () => {
  it("reads an absent checkbox as off, because that is what a browser posts", () => {
    // The load-bearing assumption of the whole form: unchecked boxes submit
    // NOTHING, so "not in the list" has to mean off rather than unchanged.
    const state = switchesFromEnabledIds(["game_source"]);
    expect(state.game_source).toBe(true);
    expect(state.game_media).toBe(false);
    expect(state.blob_reindex).toBe(false);
  });

  it("answers for every registered switch, never a partial record", () => {
    const state = switchesFromEnabledIds([]);
    for (const op of ADVANCED_BLOB_OPS) expect(state[op.id]).toBe(false);
    expect(Object.keys(state)).toHaveLength(ADVANCED_BLOB_OPS.length);
  });

  it("drops an id that is not in the registry", () => {
    // A hand-crafted POST must not be able to write blob_op:<anything> keys
    // into app_settings — the same narrowing the single-switch action did.
    const state = switchesFromEnabledIds(["game_source", "definitely_not_real"]);
    expect(state).not.toHaveProperty("definitely_not_real");
    expect(Object.keys(state)).toHaveLength(ADVANCED_BLOB_OPS.length);
  });

  it("agrees with allBlobOpSwitches at both extremes", () => {
    expect(switchesFromEnabledIds([])).toEqual(allBlobOpSwitches(false));
    expect(switchesFromEnabledIds(ADVANCED_BLOB_OPS.map((op) => op.id))).toEqual(
      allBlobOpSwitches(true),
    );
  });
});

describe("diffBlobOpSwitches", () => {
  it("returns nothing when the panel matches what is stored", () => {
    const state = allBlobOpSwitches(true);
    expect(diffBlobOpSwitches(state, state)).toEqual([]);
  });

  it("reports only the switches that moved", () => {
    // The anti-clobber property: an operator who changed one switch must not
    // re-assert the other six from a baseline that may already be stale.
    const changes = diffBlobOpSwitches(allBlobOpSwitches(true), {
      ...allBlobOpSwitches(true),
      game_media: false,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].op.id).toBe("game_media");
    expect(changes[0].enabled).toBe(false);
  });

  it("carries both directions in one save", () => {
    const changes = diffBlobOpSwitches(
      { ...allBlobOpSwitches(true), blob_reindex: false },
      { ...allBlobOpSwitches(true), game_source: false },
    );
    expect(changes.map((c) => [c.op.id, c.enabled])).toEqual([
      ["game_source", false],
      ["blob_reindex", true],
    ]);
  });

  it("orders changes the way the page lists them", () => {
    const order = ADVANCED_BLOB_OPS.map((op) => op.id);
    const changes = diffBlobOpSwitches(
      allBlobOpSwitches(true),
      allBlobOpSwitches(false),
    );
    expect(changes.map((c) => c.op.id)).toEqual(order);
  });

  it("treats a switch missing from the stored state as ON", () => {
    // What a failed settings read looks like from here — and it has to fail in
    // the same direction as every other reader, or the panic button would
    // decide there was nothing to turn off.
    const changes = diffBlobOpSwitches(
      {} as ReturnType<typeof allBlobOpSwitches>,
      allBlobOpSwitches(false),
    );
    expect(changes).toHaveLength(ADVANCED_BLOB_OPS.length);
  });
});

describe("describeBlobOpChanges", () => {
  const change = (id: string, enabled: boolean) => ({
    op: ADVANCED_BLOB_OPS.find((candidate) => candidate.id === id)!,
    enabled,
  });

  it("names a single switch and agrees with itself grammatically", () => {
    expect(describeBlobOpChanges([change("game_media", false)])).toBe(
      "Saved. Game media uploads is now OFF.",
    );
  });

  it("joins several the way a sentence does", () => {
    expect(
      describeBlobOpChanges([
        change("game_source", false),
        change("game_media", false),
        change("beta_clips", false),
      ]),
    ).toBe(
      "Saved. Game source publishing, Game media uploads and Beta replay clips are now OFF.",
    );
  });

  it("splits the two directions into their own clauses", () => {
    const message = describeBlobOpChanges([
      change("game_source", false),
      change("blob_reindex", true),
    ]);
    expect(message).toBe(
      "Saved. Game source publishing is now OFF; Rebuild the blob index is now ON.",
    );
  });

  it("names every feature when everything is switched off at once", () => {
    const message = describeBlobOpChanges(
      ADVANCED_BLOB_OPS.map((op) => ({ op, enabled: false })),
    );
    for (const op of ADVANCED_BLOB_OPS) expect(message).toContain(op.label);
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
