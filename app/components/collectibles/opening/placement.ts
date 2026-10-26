/**
 * Where each card sits on the table, as a pure function of the opening's state
 * and the table's size. The cards layer keeps one element per card from the
 * moment the cards leave the pack to the summary and moves it between these
 * places, so a card is never swapped for another element mid-journey.
 *
 *   row    wide screens: dealt side by side, turned over in place
 *   focus  narrow screens: one card in front, the face-down rest stacked behind
 *          it, the ones already seen in a small tray along the bottom
 *   summary  the same row (wide) or a fanned hand (narrow), above the results
 *
 * Positions are the card's centre in px from the table's top-left.
 */

export type Layout = "row" | "focus";

export interface Place {
  x: number;
  y: number;
  /** Scale of the card element (1 = its real size). */
  s: number;
  /** Rotation in degrees. */
  r: number;
  z: number;
}

export interface TableSize {
  w: number;
  h: number;
}

export interface CardSize {
  w: number;
  h: number;
}

export const ROW_GAP = 28;
/** Room under each card in the row for its caption. */
export const CAPTION = 56;
const TRAY_H = 96;

/** Row if three cards and their gaps fit across, otherwise one at a time. */
export function chooseLayout(table: TableSize, card: CardSize): Layout {
  return table.w >= card.w * 3 + ROW_GAP * 2 + 32 && table.h >= card.h + CAPTION + 40 ? "row" : "focus";
}

/** Height the table needs in the summary: the row with captions, or the fanned hand. */
export function summaryHeight(layout: Layout, card: CardSize): number {
  return layout === "row" ? card.h + CAPTION + 24 : Math.round(fanScale(card) * card.h + 48);
}

const fanScale = (card: CardSize) => Math.min(1, 132 / card.w);

export interface PlaceInput {
  layout: Layout;
  table: TableSize;
  card: CardSize;
  count: number;
  flipped: boolean[];
  current: number;
  summary: boolean;
}

export function placeCards({ layout, table, card, count, flipped, current, summary }: PlaceInput): Place[] {
  const out: Place[] = [];
  const mid = (count - 1) / 2;
  if (layout === "row") {
    const y = summary ? card.h / 2 + 12 : Math.max(card.h / 2 + 8, (table.h - CAPTION) / 2);
    for (let i = 0; i < count; i++) out.push({ x: table.w / 2 + (i - mid) * (card.w + ROW_GAP), y, s: 1, r: 0, z: 10 + i });
    return out;
  }

  if (summary) {
    const s = fanScale(card);
    const step = Math.min(card.w * s * 0.82, (table.w - card.w * s - 24) / Math.max(1, count - 1));
    for (let i = 0; i < count; i++) {
      const d = i - mid;
      out.push({ x: table.w / 2 + d * step, y: (card.h * s) / 2 + 20 + Math.abs(d) * 8, s, r: d * 7, z: 10 + (d === 0 ? 5 : i) });
    }
    return out;
  }

  // Focus: the current card in front, face-down ones behind it, seen ones in the tray.
  const focusY = Math.min(table.h - TRAY_H - card.h / 2, Math.max(card.h / 2 + 8, (table.h - TRAY_H) / 2 + 8));
  const thumb = Math.min(0.3, 64 / card.w);
  const seen: number[] = [];
  const waiting: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === current) continue;
    if (flipped[i]) seen.push(i);
    else waiting.push(i);
  }
  const places = new Array<Place>(count);
  places[current] = { x: table.w / 2, y: focusY, s: 1, r: 0, z: 30 };
  waiting.forEach((i, k) => {
    places[i] = { x: table.w / 2 + (k + 1) * 3, y: focusY + (k + 1) * 14, s: 1 - (k + 1) * 0.045, r: (k % 2 ? -1 : 1) * (1.5 + k), z: 20 - k };
  });
  // The tray keeps cards in reveal order, left to right.
  const trayMid = (count - 1) / 2;
  seen.forEach((i) => {
    places[i] = { x: table.w / 2 + (i - trayMid) * (card.w * thumb + 14), y: table.h - TRAY_H / 2, s: thumb, r: 0, z: 5 + i };
  });
  return places;
}

/** CSS transform for a place, for an element centred on the table's top-left corner. */
export const placeTransform = (p: Place) => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;
