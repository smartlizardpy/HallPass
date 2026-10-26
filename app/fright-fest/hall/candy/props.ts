/**
 * The plain props the Candy Hunt section and the noticeboard receive.
 * SERVER-SIDE ONLY (page.tsx builds them at build time): it reads the candy
 * definition and the pack catalogue, and the islands import only the TYPES.
 * Every date, price and amount is read from `lib/candy/fright-fest-2026.ts`;
 * nothing is typed here.
 */

import { PACK_PRINT_PX, packPrintSrc } from "@/app/lib/collectibles/catalogue";
import { shopItems } from "@/app/lib/candy/present";
import { dailyBestAmount, type CandyConfig } from "@/app/lib/candy/fright-fest-2026";
import { ordinal } from "@/app/lib/championship/format";

export interface CandyDates {
  opensAt: string;
  closesAt: string;
  spendUntil: string;
}

export interface CandyLabels {
  /** "28 Oct" */
  opens: string;
  /** "1 Nov": the last day of earning. */
  earnEnds: string;
  /** "30 Nov": the last day of spending. */
  spendEnds: string;
  /** "30 Nov 2026, 23:59 UK" */
  spendUntil: string;
  /** "Wed 4 Nov": results are final by this day. */
  resultsBy: string;
}

export interface ShelfItemProps {
  packId: string;
  name: string;
  price: number;
  print: string;
}

export interface CandyProps {
  dates: CandyDates;
  labels: CandyLabels;
  /** What the most valuable game pays at each daily-best band, in candy (computed from the config). */
  dailyBest: { label: string; amount: number }[];
  /** The most a game can pay: the value the `dailyBest` amounts are for. */
  maxGameCandy: number;
  /** A pack print's native size: the shelf draws prints at exactly 1x. */
  printPx: { w: number; h: number };
  rankedRun: number;
  allBoards: number;
  placing: { label: string; amount: number }[];
  shelves: { price: number; items: ShelfItemProps[] }[];
}

const day = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(ms);

/**
 * One (rank, board size) inside each of `config.dailyBest`'s five bands, in order:
 * 1st; 2nd-3rd; 4th-10th; the top half (11th on a board of 100); anywhere else (51st).
 * The amounts come from `dailyBestAmount`, so the rule itself lives only in the config.
 */
const DAILY_BEST_PROBE: readonly [rank: number, n: number][] = [
  [1, 100],
  [2, 100],
  [4, 100],
  [11, 100],
  [51, 100],
];

/** (2, 3) -> "2nd–3rd"; (1, 1) -> "1st". */
export function rankRange(from: number, to: number): string {
  return from === to ? ordinal(from) : `${ordinal(from)}–${ordinal(to)}`;
}

/** `resultsByLabel` is the championship summary's own ("Wed 4 Nov, 23:59"); the time of day is dropped, as the hall does. */
export function buildCandy(config: CandyConfig, resultsByLabel: string): CandyProps {
  const items = shopItems(0, config);
  const prices = Array.from(new Set(items.map((i) => i.price))).sort((a, b) => a - b);
  return {
    dates: { opensAt: config.opensAt, closesAt: config.closesAt, spendUntil: config.spendUntil },
    labels: {
      opens: day(Date.parse(config.opensAt)),
      earnEnds: day(Date.parse(config.closesAt) - 1),
      spendEnds: day(Date.parse(config.spendUntil) - 1),
      spendUntil: config.spendUntilLabel,
      resultsBy: resultsByLabel.replace(/, .*$/, ""),
    },
    dailyBest: config.dailyBest.map((t, i) => ({ label: t.label, amount: dailyBestAmount(config.maxGameCandy, ...DAILY_BEST_PROBE[i]) })),
    maxGameCandy: config.maxGameCandy,
    printPx: { w: PACK_PRINT_PX.w, h: PACK_PRINT_PX.h },
    rankedRun: config.rankedRun,
    allBoards: config.allBoards,
    placing: config.placing.map((t) => ({ label: rankRange(t.from, t.to), amount: t.amount })),
    shelves: prices.map((price) => ({
      price,
      items: items.filter((i) => i.price === price).map((i) => ({ packId: i.packId, name: i.name, price, print: packPrintSrc(i.packId) })),
    })),
  };
}
