/**
 * Fright Fest 2026 — THE CHAMPIONSHIP DEFINITION. The one place to edit.
 *
 * TO SWITCH THE CHAMPIONSHIP OFF: `enabled: false` and ship. Every championship
 * surface then behaves as if it did not exist (the skin keeps its own
 * "upcoming" card), and nothing stored is touched. To pause it WITHOUT a deploy,
 * use Suspend on /dashboard/championship.
 *
 * TO MOVE THE DATES: `opensAt` / `closesAt` (UTC, with a `Z`). The haunted skin
 * has its own window in `app/lib/events/fright-fest.ts`; they share a date by
 * decision, not by import (docs/championship-design.md §1).
 *
 * TO ADD A GAME TO THE LINEUP: its rules are already here. When the game sends
 * what `docs/championship-integration.md` asks for, an admin opens its board on
 * the dashboard. No deploy.
 *
 * THE RULES ARE PUBLISHED. The rules page renders the metric, ranking rule and
 * points table straight from this object, so the page and the code cannot
 * disagree. Do not change a live rule; if one must change, say so on the page.
 */

import type { ChampionshipConfig } from "./types";
import { validateLastBell, validateShadowCoreCursedDash, validateSurviveTillDawnBloodMoon } from "./validators";

export const FRIGHT_FEST_2026: ChampionshipConfig = {
  id: "fright-fest-2026",
  title: "Fright Fest 2026",
  enabled: true,
  opensAt: "2026-10-28T00:00:00Z",
  closesAt: "2026-11-02T00:00:00Z",
  timeZone: "Europe/London",
  resultsBy: "2026-11-05T00:00:00Z",
  href: "/fright-fest",
  // Longer than the longest ranked run any board allows (Cursed Dash caps at
  // 60 minutes), so no legitimate run outlives its token.
  tokenTtlSec: 75 * 60,
  submitGraceSec: 10 * 60,
  points: { byRank: [100, 80, 65, 40, 40, 20, 20, 20, 20, 20], others: 5 },
  rewards: {
    participation: "ff26-participation",
    gameChampion: {
      "last-bell": "ff26-winner-last-bell",
      "shadow-core-halloween-dash": "ff26-winner-shadow-core",
      "survive-till-dawn-pixel-edition": "ff26-winner-survive-till-dawn",
    },
    overallChampion: "ff26-overall-winner",
  },
  games: [
    {
      slug: "last-bell",
      board: "last-bell-halloween-shift",
      title: "Last Bell",
      mode: "The Halloween Shift",
      modeShort: "Halloween Shift",
      rules: "verified",
      metric: {
        sort: "desc",
        label: "Time left",
        format: "clock",
        tiebreakLabel: "Escape time",
        tiebreakSort: "asc",
        tiebreakFormat: "seconds-2dp",
      },
      howToEnter:
        "Sign in, open Last Bell and choose The Halloween Shift from its menu. Everyone gets the same school, Normal difficulty and an 8:00 clock. Solo only.",
      rankingRule:
        "Escape with the most time left on the clock. Equal times are split by the faster escape to a hundredth of a second.",
      validate: validateLastBell,
    },
    {
      slug: "shadow-core-halloween-dash",
      board: "shadow-core-cursed-dash",
      title: "Shadow Core: Halloween Dash",
      mode: "Cursed Dash",
      modeShort: "Cursed Dash",
      rules: "proposed",
      metric: {
        sort: "asc",
        label: "Total time",
        format: "ms-clock",
        tiebreakLabel: "Deaths",
        tiebreakSort: "asc",
        tiebreakFormat: "integer",
      },
      howToEnter:
        "Sign in, open Shadow Core: Halloween Dash and choose Cursed Dash: all fifteen sectors in one run, against one clock.",
      rankingRule: "Fastest total time through all fifteen sectors. Equal times are split by fewer deaths.",
      validate: validateShadowCoreCursedDash,
    },
    {
      slug: "survive-till-dawn-pixel-edition",
      board: "survive-till-dawn-blood-moon",
      title: "Survive Till Dawn: Pixel Edition",
      mode: "Blood Moon",
      modeShort: "Blood Moon",
      rules: "proposed",
      metric: {
        sort: "desc",
        label: "Survived",
        format: "clock",
        tiebreakLabel: "Kills",
        tiebreakSort: "desc",
        tiebreakFormat: "integer",
      },
      howToEnter:
        "Sign in, open Survive Till Dawn: Pixel Edition and choose Blood Moon: the same realm, difficulty and 20-minute night for everyone. Solo only.",
      rankingRule: "Survive the longest, up to dawn at 20:00. Equal times are split by more kills.",
      validate: validateSurviveTillDawnBloodMoon,
    },
  ],
};
