import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createStreakStore } from "./server-store";

interface Call {
  text: string;
  values: unknown[];
}

function fakeSql(responder: (call: Call) => Record<string, unknown>[]) {
  const calls: Call[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { text: strings.join("?"), values };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("recordDay", () => {
  it("reports an advance with the new lengths (BIGINT-safe)", async () => {
    const { sql, calls } = fakeSql(() => [{ current_streak: "3", longest_streak: "7" }]);
    const result = await createStreakStore(sql).recordDay("p1", "2026-10-02", 60);
    expect(result).toEqual({ advanced: true, current: 3, longest: 7 });
    expect(calls).toHaveLength(1); // one statement
    expect(calls[0].values).toContain("p1");
    expect(calls[0].values).toContain("2026-10-02");
    expect(calls[0].values).toContain(60);
  });

  it("reports no advance when the upsert touched nothing", async () => {
    const { sql } = fakeSql(() => []);
    expect(await createStreakStore(sql).recordDay("p1", "2026-10-02", 0)).toEqual({
      advanced: false,
    });
  });

  it("only updates a row when the reported day is later", async () => {
    const { sql, calls } = fakeSql(() => []);
    await createStreakStore(sql).recordDay("p1", "2026-10-02", 0);
    expect(calls[0].text).toMatch(/WHERE \?::date > player_streaks\.last_day/);
  });
});

describe("dueForReminder", () => {
  it("decodes rows and requires a push subscription", async () => {
    const { sql, calls } = fakeSql(() => [
      { player_id: "p1", current_streak: "5", local_day: "2026-10-02" },
    ]);
    const due = await createStreakStore(sql).dueForReminder(
      new Date("2026-10-02T16:30:00Z"),
      50,
    );
    expect(due).toEqual([{ playerId: "p1", current: 5, localDay: "2026-10-02" }]);
    expect(calls[0].text).toMatch(/push_subscriptions/);
    expect(calls[0].values).toContain(17); // the reminder hour
    expect(calls[0].values).toContain(50); // the cap
  });
});

describe("claimNudge", () => {
  it("is true only when the update claimed a row", async () => {
    const claimed = fakeSql(() => [{ claimed: 1 }]);
    expect(await createStreakStore(claimed.sql).claimNudge("p1", "2026-10-02")).toBe(true);
    const lost = fakeSql(() => []);
    expect(await createStreakStore(lost.sql).claimNudge("p1", "2026-10-02")).toBe(false);
  });
});
