/**
 * Candy Hunt, Fright Fest 2026 — THE CANDY DEFINITION. The one place to edit.
 *
 * Rules as the owner decided them (docs/candy-hunt.md). Every amount below is a
 * single number changed by commit; nothing here is stored per player, and a
 * changed amount never re-prices a credit already made (the ledger holds the
 * amount paid).
 *
 * THE EARNING WINDOW is the championship's own (`opensAt` to `closesAt`, UTC):
 * 28 Oct 00:00 to 2 Nov 00:00 UK. It is read from `FRIGHT_FEST_2026` rather than
 * retyped, so a moved championship moves the candy with it.
 *
 * THE SPEND-BY DATE is "30 Nov 2026, 23:59 UK". London is on GMT in November, so
 * that is 23:59Z, and the instant below (1 Dec 00:00Z) is EXCLUSIVE: a spend at
 * 23:59:30 on the 30th is still inside it. The database clock decides, never the
 * device's. Unspent candy simply stops being spendable; nothing is deleted.
 */

import { FRIGHT_FEST_2026 } from "../championship/fright-fest-2026";

export interface PlacingTier {
  /** Inclusive rank range on one counting board. */
  from: number;
  to: number;
  amount: number;
}

/** One band of the owner's rating rubric, for the dashboard's presets. */
export interface RubricTier {
  label: string;
  /** The values a super admin may pick for it with one click. */
  presets: readonly number[];
}

export interface CandyConfig {
  /** Also the championship id: the ledger's `event_id`. */
  id: string;
  title: string;
  /** Earning window, ISO UTC; `opensAt` inclusive, `closesAt` exclusive. */
  opensAt: string;
  closesAt: string;
  /** Spending opens with the event and ends here, ISO UTC, exclusive. */
  spendUntil: string;
  /** How the spend-by date is written everywhere candy appears. */
  spendUntilLabel: string;
  /** Price in candy, by pack id. A pack that is not here cannot be bought. */
  prices: Readonly<Record<string, number>>;
  /** Paid once per counting board, on a player's first accepted ranked run there. */
  rankedRun: number;
  /** Paid once, to a player with a result on every counting board (the standings' `eligible`). */
  allBoards: number;
  /** Paid per counting board once the championship is finalised, by final rank. */
  placing: readonly PlacingTier[];
  /** The ceiling for one achievement's value, enforced by the database too. */
  maxAchievementCandy: number;
  rubric: readonly RubricTier[];
}

export const CANDY_FRIGHT_FEST_2026: CandyConfig = {
  id: FRIGHT_FEST_2026.id,
  title: "Candy Hunt",
  opensAt: FRIGHT_FEST_2026.opensAt,
  closesAt: FRIGHT_FEST_2026.closesAt,
  spendUntil: "2026-12-01T00:00:00Z",
  spendUntilLabel: "30 Nov 2026, 23:59 UK",
  prices: {
    // The four everyday packs, as they are.
    "hpo-standard": 30,
    "inet-standard": 30,
    "brr-standard": 30,
    "tr-standard": 30,
    // The four Rare packs.
    "hpo-rare": 100,
    "inet-rare": 100,
    "brr-rare": 100,
    "tr-rare": 100,
  },
  rankedRun: 10,
  allBoards: 20,
  placing: [
    { from: 1, to: 1, amount: 40 },
    { from: 2, to: 3, amount: 30 },
    { from: 4, to: 10, amount: 20 },
  ],
  maxAchievementCandy: 40,
  rubric: [
    { label: "Launch a game", presets: [0] },
    { label: "Basic clicker milestone", presets: [2] },
    { label: "Easy game completion", presets: [5] },
    { label: "Normal achievement", presets: [8, 10, 12] },
    { label: "Challenging score or victory", presets: [15, 20] },
    { label: "Difficult achievement", presets: [25, 30] },
    { label: "Exceptional achievement", presets: [40] },
  ],
};

/** The candy a final rank earns on one board, or 0 outside the paid ranks. */
export function placingAmount(config: CandyConfig, rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  return config.placing.find((t) => rank >= t.from && rank <= t.to)?.amount ?? 0;
}

/** Whether `candy` is a legal achievement value: an integer from 0 to the ceiling. */
export function isAchievementCandy(config: CandyConfig, candy: number): boolean {
  return Number.isInteger(candy) && candy >= 0 && candy <= config.maxAchievementCandy;
}

/** The award key of one credit: `candy:<event>:<kind>:<player>:<ref>`. The SQL builds the same string. */
export function awardKey(config: CandyConfig, kind: string, playerId: string, ref?: string): string {
  return ["candy", config.id, kind, playerId, ...(ref ? [ref] : [])].join(":");
}
