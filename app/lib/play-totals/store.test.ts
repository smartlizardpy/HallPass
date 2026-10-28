import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createPlayTotalsStore } from "./store";

function makeFakeSql(rows: Record<string, unknown>[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("play totals store", () => {
  it("records a play as a single upsert that increments, never overwrites", async () => {
    const { sql, calls } = makeFakeSql();
    await createPlayTotalsStore(sql).recordPlay("last-bell");
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual(["last-bell"]);
    expect(calls[0].text).toContain("ON CONFLICT (slug)");
    expect(calls[0].text).toContain("plays      = game_play_totals.plays + 1");
  });

  it("reads baseline + plays as a number, from BIGINT strings", async () => {
    const { sql } = makeFakeSql([
      { slug: "last-bell", total: "12034" },
      { slug: "neon-run", total: "7" },
    ]);
    expect(await createPlayTotalsStore(sql).totals()).toEqual({
      "last-bell": 12034,
      "neon-run": 7,
    });
  });

  it("skips rows it cannot read as a number", async () => {
    const { sql } = makeFakeSql([{ slug: "a", total: "nope" }, { slug: "b", total: "3" }]);
    expect(await createPlayTotalsStore(sql).totals()).toEqual({ b: 3 });
  });
});
