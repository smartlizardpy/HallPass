import { describe, expect, it } from "vitest";

import {
  PUSH_ROTATE_INTERVAL_MS,
  PUSH_SYNC_INTERVAL_MS,
  pushRotateDue,
  pushSyncDue,
} from "./client";

describe("pushSyncDue", () => {
  it("is due when it has never run or the record is unusable", () => {
    expect(pushSyncDue(null, 1_000)).toBe(true);
    expect(pushSyncDue(Number.NaN, 1_000)).toBe(true);
  });

  it("waits out the interval", () => {
    expect(pushSyncDue(1_000, 1_000 + PUSH_SYNC_INTERVAL_MS - 1)).toBe(false);
  });

  it("is due once the interval has passed", () => {
    expect(pushSyncDue(1_000, 1_000 + PUSH_SYNC_INTERVAL_MS)).toBe(true);
  });
});

describe("pushRotateDue", () => {
  it("is due when never rotated or unreadable", () => {
    expect(pushRotateDue(null, 5)).toBe(true);
    expect(pushRotateDue(Number.NaN, 5)).toBe(true);
  });

  it("rotates on a longer cycle than the daily sync", () => {
    expect(PUSH_ROTATE_INTERVAL_MS).toBeGreaterThan(PUSH_SYNC_INTERVAL_MS);
    expect(pushRotateDue(1_000, 1_000 + PUSH_ROTATE_INTERVAL_MS - 1)).toBe(false);
    expect(pushRotateDue(1_000, 1_000 + PUSH_ROTATE_INTERVAL_MS)).toBe(true);
  });
});
