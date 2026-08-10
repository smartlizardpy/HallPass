/**
 * Tests for the push subscriptions store.
 *
 * Same fake-`sql` seam as the other stores. The property worth pinning hardest
 * is that subscribing and capping are ONE statement: two round trips would leave
 * a window over the cap, and a failure between them would leave a player there
 * permanently, because nothing ever revisits it.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { PUSH_DEVICE_CAP } from "./config";
import { createPushStore } from "./store";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(rows: Record<string, unknown>[] = []) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

const DEVICE = {
  playerId: "p1",
  endpoint: "https://push.example/abc",
  p256dh: "key",
  auth: "secret",
};

describe("subscribe", () => {
  it("upserts and caps in ONE statement", async () => {
    const { sql, calls } = makeFakeSql();
    await createPushStore(sql).subscribe(DEVICE);

    expect(calls).toHaveLength(1);
    const { text } = calls[0];
    expect(text).toContain("INSERT INTO push_subscriptions");
    expect(text).toContain("ON CONFLICT (endpoint) DO UPDATE");
    expect(text).toContain("DELETE FROM push_subscriptions");
  });

  it("reserves a slot for this device by offsetting CAP - 1", async () => {
    // A data-modifying CTE is invisible to its siblings, so `excess` cannot see
    // the row being written. Excluding this endpoint and offsetting CAP-1 is
    // exact whether the device is new or being refreshed.
    const { sql, calls } = makeFakeSql();
    await createPushStore(sql).subscribe(DEVICE);

    expect(calls[0].text).toContain("endpoint <> ?");
    expect(calls[0].values).toContain(PUSH_DEVICE_CAP - 1);
  });

  it("evicts the least recently seen, not the oldest", async () => {
    // A phone used daily for two years must outlive a Chromebook borrowed once.
    const { sql, calls } = makeFakeSql();
    await createPushStore(sql).subscribe(DEVICE);

    expect(calls[0].text).toContain("ORDER BY last_seen_at DESC");
    expect(calls[0].text).not.toContain("ORDER BY created_at");
  });

  it("refreshes last_seen_at on a re-subscribe", async () => {
    const { sql, calls } = makeFakeSql();
    await createPushStore(sql).subscribe(DEVICE);
    expect(calls[0].text).toContain("last_seen_at = now()");
  });

  it("never offsets below zero", async () => {
    // Guards a future CAP of 0 or 1 from emitting `OFFSET -1`, which is a
    // syntax error rather than a smaller cap.
    const { sql, calls } = makeFakeSql();
    await createPushStore(sql).subscribe(DEVICE);
    const offset = calls[0].values.find((v) => typeof v === "number");
    expect(offset as number).toBeGreaterThanOrEqual(0);
  });
});

describe("unsubscribe", () => {
  it("requires the player as well as the endpoint", async () => {
    // Otherwise a leaked endpoint would be enough to silence somebody else's
    // device.
    const { sql, calls } = makeFakeSql([{ endpoint: "x" }]);
    expect(await createPushStore(sql).unsubscribe("p1", "e1")).toBe(true);

    const { text } = calls[0];
    expect(text).toContain("endpoint = ?");
    expect(text).toContain("player_id = ?");
  });

  it("reports false when it removed nothing", async () => {
    const { sql } = makeFakeSql([]);
    expect(await createPushStore(sql).unsubscribe("p1", "e1")).toBe(false);
  });
});

describe("removeDead", () => {
  it("deletes by endpoint alone", async () => {
    // The push service has said this endpoint no longer exists anywhere, which
    // is the same fact whoever's row it is. This is the whole of the repo's
    // subscription hygiene — there is no cron to sweep with.
    const { sql, calls } = makeFakeSql();
    await createPushStore(sql).removeDead("https://push.example/gone");

    expect(calls[0].text).toContain("DELETE FROM push_subscriptions");
    expect(calls[0].text).not.toContain("player_id");
  });
});

describe("devicesFor", () => {
  it("returns every device, most recently seen first", async () => {
    const { sql, calls } = makeFakeSql([
      { endpoint: "e1", p256dh: "k1", auth: "a1" },
      { endpoint: "e2", p256dh: "k2", auth: "a2" },
    ]);
    const devices = await createPushStore(sql).devicesFor("p1");

    expect(devices).toEqual([
      { endpoint: "e1", p256dh: "k1", auth: "a1" },
      { endpoint: "e2", p256dh: "k2", auth: "a2" },
    ]);
    expect(calls[0].text).toContain("ORDER BY last_seen_at DESC");
  });

  it("returns an empty list for a player with no devices", async () => {
    const { sql } = makeFakeSql([]);
    expect(await createPushStore(sql).devicesFor("p1")).toEqual([]);
  });
});
