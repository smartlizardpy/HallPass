/**
 * The plain props the Candy Hunt section and the noticeboard receive.
 * SERVER-SIDE ONLY (page.tsx builds them at build time): it reads the candy
 * definition and the pack catalogue, and the islands import only the TYPES.
 * Every date, price and amount is read from `lib/candy/fright-fest-2026.ts`;
 * nothing is typed here.
 */

import { packPrintSrc } from "@/app/lib/collectibles/catalogue";
import { shopItems } from "@/app/lib/candy/present";
import type { CandyConfig } from "@/app/lib/candy/fright-fest-2026";
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
  rubric: { label: string; value: string }[];
  rankedRun: number;
  allBoards: number;
  placing: { label: string; amount: number }[];
  shelves: { price: number; items: ShelfItemProps[] }[];
}

const day = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(ms);

/** [8, 10, 12] -> "8–12"; [2] -> "2". */
export function valueRange(presets: readonly number[]): string {
  const lo = Math.min(...presets);
  const hi = Math.max(...presets);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

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
    rubric: config.rubric.map((t) => ({ label: t.label, value: valueRange(t.presets) })),
    rankedRun: config.rankedRun,
    allBoards: config.allBoards,
    placing: config.placing.map((t) => ({ label: rankRange(t.from, t.to), amount: t.amount })),
    shelves: prices.map((price) => ({
      price,
      items: items.filter((i) => i.price === price).map((i) => ({ packId: i.packId, name: i.name, price, print: packPrintSrc(i.packId) })),
    })),
  };
}
