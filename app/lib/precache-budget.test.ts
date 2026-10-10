/**
 * Tests for `scripts/lib/precache-budget.mjs`, which decides which of a game's
 * files every installed device downloads again on every deploy. Lives here
 * because vitest only includes `app/**`. The load-bearing claims: a game under
 * the budget is listed whole (today's catalogue changes not at all), a game over
 * it is listed by its cover alone, and the cover never counts against it.
 */

import { describe, expect, it } from "vitest";
import {
  PRECACHE_GAME_BUDGET_BYTES,
  planGamePrecache,
} from "../../scripts/lib/precache-budget.mjs";

const MB = 1024 * 1024;

describe("planGamePrecache", () => {
  it("lists every file of a game under the budget", () => {
    const plan = planGamePrecache([
      { rel: "index.html", size: 600 * 1024 },
      { rel: "cover.png", size: 400 * 1024 },
      { rel: "js/main.js", size: 300 * 1024 },
    ]);
    expect(plan.overBudget).toBe(false);
    expect(plan.precache).toEqual(["index.html", "cover.png", "js/main.js"]);
  });

  it("lists only the cover of a game over the budget", () => {
    const plan = planGamePrecache([
      { rel: "index.html", size: 1 * MB },
      { rel: "cover.png", size: 200 * 1024 },
      { rel: "audio/theme.mp3", size: 9 * MB },
    ]);
    expect(plan.overBudget).toBe(true);
    expect(plan.playBytes).toBe(10 * MB);
    expect(plan.precache).toEqual(["cover.png"]);
  });

  it("does not count the cover against the budget", () => {
    const plan = planGamePrecache([
      { rel: "index.html", size: PRECACHE_GAME_BUDGET_BYTES },
      { rel: "cover.png", size: 5 * MB },
    ]);
    expect(plan.overBudget).toBe(false);
    expect(plan.precache).toEqual(["index.html", "cover.png"]);
  });

  it("goes over only past the budget, not at it", () => {
    const at = planGamePrecache([{ rel: "index.html", size: PRECACHE_GAME_BUDGET_BYTES }]);
    const past = planGamePrecache([{ rel: "index.html", size: PRECACHE_GAME_BUDGET_BYTES + 1 }]);
    expect(at.overBudget).toBe(false);
    expect(past.overBudget).toBe(true);
    expect(past.precache).toEqual([]);
  });

  it("is 2 MB", () => {
    expect(PRECACHE_GAME_BUDGET_BYTES).toBe(2 * MB);
  });
});
