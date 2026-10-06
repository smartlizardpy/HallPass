import { describe, expect, it } from "vitest";

import { PUSH_SYNC_INTERVAL_MS, pushSyncDue } from "./client";

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
