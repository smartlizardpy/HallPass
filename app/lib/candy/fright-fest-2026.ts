/**
 * Candy Hunt, Fright Fest 2026 — THE CANDY DEFINITION. The one place to edit.
 *
 * Rules as the owner decided them (docs/candy-hunt.md). Every amount below is a
 * single number changed by commit; nothing here is stored per player, and a
 * changed amount never re-prices a credit already made (the ledger holds the
 * amount paid).
 *
 * THE EARNING WINDOW is the championship's own (`opensAt` to `closesAt`, UTC):
 * 28 Oct 00:00 to 3 Nov 00:00 UK. It is read from `FRIGHT_FEST_2026` rather than
 * retyped, so a moved championship moves the candy with it.
 *
 * DAILY BEST. Once per UK day per board, a signed-in player's best score that day
 * earns candy by where it ranked on that game's leaderboard when it was set. The
 * board's own value (0 to 40, set on the Candy desk) is the rank-1 payout and the
 * tiers below scale it. Achievements pay nothing: they are self-reported.
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

/** One rank band of the daily-best payout, as a percentage of the board's value. */
export interface DailyBestTier {
  label: string;
  pct: number;
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
  /** The ceiling for one board's value, enforced by the database too. */
  maxGameCandy: number;
  /** The daily-best shares: 1st, 2nd-3rd, 4th-10th, top half, anywhere else. For display; `dailyBestPct` is the rule. */
  dailyBest: readonly DailyBestTier[];
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
    // The four everyday packs of the curated collections, same price as before the catalogue import.
    "legends-standard": 30,
    "brainrot-standard": 30,
    "turkish-standard": 30,
    "gaming-standard": 30,
    // The four Rare packs.
    "legends-rare": 100,
    "brainrot-rare": 100,
    "turkish-rare": 100,
    "gaming-rare": 100,
  },
  rankedRun: 10,
  allBoards: 20,
  placing: [
    { from: 1, to: 1, amount: 40 },
    { from: 2, to: 3, amount: 30 },
    { from: 4, to: 10, amount: 20 },
  ],
  maxGameCandy: 40,
  dailyBest: [
    { label: "1st", pct: 100 },
    { label: "2nd–3rd", pct: 75 },
    { label: "4th–10th", pct: 50 },
    { label: "Top half", pct: 25 },
    { label: "On the board", pct: 5 },
  ],
  rubric: [
    { label: "Doesn't pay", presets: [0] },
    { label: "Clicker or idle game", presets: [2] },
    { label: "Easy game", presets: [5] },
    { label: "Normal game", presets: [8, 10, 12] },
    { label: "Challenging game", presets: [15, 20] },
    { label: "Difficult game", presets: [25, 30] },
    { label: "Exceptional game", presets: [40] },
  ],
};

/** The candy a final rank earns on one board, or 0 outside the paid ranks. */
export function placingAmount(config: CandyConfig, rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  return config.placing.find((t) => rank >= t.from && rank <= t.to)?.amount ?? 0;
}

/** Whether `candy` is a legal board value: an integer from 0 to the ceiling. */
export function isGameCandy(config: CandyConfig, candy: number): boolean {
  return Number.isInteger(candy) && candy >= 0 && candy <= config.maxGameCandy;
}

/**
 * The share (percent of the board's value) a daily best at `rank` earns on a board
 * that had `n` rows when it was set: 1st 100, 2nd-3rd 75, 4th-10th 50, the top
 * half (rank <= ceil(n/2)) 25, anywhere else on the board 5. The SQL in the store
 * encodes the same bands; the DB test checks the two agree.
 */
export function dailyBestPct(rank: number, n: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  if (rank === 1) return 100;
  if (rank <= 3) return 75;
  if (rank <= 10) return 50;
  if (Number.isInteger(n) && rank <= Math.ceil(n / 2)) return 25;
  return 5;
}

/** What a daily best earns: `max(1, (value * pct + 50) / 100)` in integer maths, or 0 when the board pays nothing. */
export function dailyBestAmount(value: number, rank: number, n: number): number {
  if (!Number.isInteger(value) || value <= 0) return 0;
  const pct = dailyBestPct(rank, n);
  if (pct === 0) return 0;
  return Math.max(1, Math.floor((value * pct + 50) / 100));
}

/** The award key of one credit: `candy:<event>:<kind>:<player>:<ref>`. The SQL builds the same string. */
export function awardKey(config: CandyConfig, kind: string, playerId: string, ref?: string): string {
  return ["candy", config.id, kind, playerId, ...(ref ? [ref] : [])].join(":");
}
