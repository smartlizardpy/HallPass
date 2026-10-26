/**
 * Where each card sits on the table, as a pure function of the opening's state
 * and the table's size. The cards layer keeps one element per card from the
 * moment the cards leave the pack to the summary and moves it between these
 * places, so a card is never swapped for another element mid-journey.
 *
 * One card at a time on every screen (docs/collectibles-pack-room.md): the
 * card being revealed in front, as large as the screen allows, with room above
 * it for the rarity's plate and below it for "New for your binder"; the cards
 * still face down stacked behind it. The cards already seen go to a tray beside
 * it where there is room (`side`, laptops), or fade behind it while dots count
 * them (`dots`, phones). The summary lays them out again (`summary`).
 *
 * Positions are the card's centre in px from the table's top-left.
 */

export type Tray = "side" | "dots";

export interface Place {
  x: number;
  y: number;
  /** Scale of the card element (1 = its real size). */
  s: number;
  /** Rotation in degrees. */
  r: number;
  z: number;
  /** Opacity, when not fully shown (a seen card behind the one in front, on a phone). */
  o?: number;
}

export interface TableSize {
  w: number;
  h: number;
}

export interface CardSize {
  w: number;
  h: number;
}

/** Room above the card in front for the rarity's plate. */
export const BANNER_H = 72;
/** Room below it for the "New for your binder" tag. */
export const TAG_H = 52;
/** The tray's thumbnails: this wide, this far from the card, this far apart. */
const THUMB_W = 64;
const TRAY_GAP = 36;
const THUMB_GAP = 12;
/** The card in front may shrink this far to fit before a smaller size is used. */
const MIN_FIT = 0.9;

/** The card sizes (Card.tsx), so the pixel art stays at a whole-number scale. */
export const CARD_PX = { sm: { w: 140, h: 196 }, md: { w: 200, h: 280 }, lg: { w: 260, h: 364 }, xl: { w: 300, h: 420 } } as const;
export type CardKey = keyof typeof CARD_PX;

/** The tray goes beside the card when there is room for it on both sides (the card stays centred). */
const sideFits = (table: TableSize, card: CardSize) => table.w >= card.w + 2 * (TRAY_GAP + THUMB_W + 8);

/**
 * The card size and where the seen cards go, for a table: the largest card
 * whose height fits between the plate and the tag (shrinking a little if need
 * be), the extra-large one only where there is width to spare.
 */
export function chooseFit(table: TableSize): { tray: Tray; size: CardKey } {
  const band = table.h - BANNER_H - TAG_H;
  const order: CardKey[] = table.w >= 600 ? ["xl", "lg", "md", "sm"] : ["lg", "md", "sm"];
  const size = order.find((k) => CARD_PX[k].h * MIN_FIT <= band && CARD_PX[k].w + 32 <= table.w) ?? "sm";
  return { tray: sideFits(table, CARD_PX[size]) ? "side" : "dots", size };
}

/** Height the table needs in the summary: the fanned hand. */
export function summaryHeight(card: CardSize): number {
  return Math.round(fanScale(card) * card.h + 48);
}

const fanScale = (card: CardSize) => Math.min(1, 132 / card.w);

export interface PlaceInput {
  tray: Tray;
  table: TableSize;
  card: CardSize;
  count: number;
  flipped: boolean[];
  current: number;
  summary: boolean;
}

/** The card in front: centred between the plate and the tag, shrunk only if the table is too short. */
export function frontPlace(table: TableSize, card: CardSize): Place {
  const band = table.h - BANNER_H - TAG_H;
  const f = Math.min(1, Math.max(0.6, band / card.h));
  return { x: table.w / 2, y: BANNER_H + Math.max((card.h * f) / 2, band / 2), s: f, r: 0, z: 30 };
}

export function placeCards({ tray, table, card, count, flipped, current, summary }: PlaceInput): Place[] {
  const out: Place[] = [];
  const mid = (count - 1) / 2;

  if (summary) {
    const s = fanScale(card);
    const step = Math.min(card.w * s * 0.82, (table.w - card.w * s - 24) / Math.max(1, count - 1));
    for (let i = 0; i < count; i++) {
      const d = i - mid;
      out.push({ x: table.w / 2 + d * step, y: (card.h * s) / 2 + 20 + Math.abs(d) * 8, s, r: d * 7, z: 10 + (d === 0 ? 5 : i) });
    }
    return out;
  }

  const front = frontPlace(table, card);
  const f = front.s;
  const seen: number[] = [];
  const waiting: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === current) continue;
    if (flipped[i]) seen.push(i);
    else waiting.push(i);
  }
  const places = new Array<Place>(count);
  places[current] = front;
  // Face down behind the card in front, just showing.
  waiting.forEach((i, k) => {
    places[i] = { x: front.x + (k + 1) * 3, y: front.y + (k + 1) * 8 * f, s: f * (1 - (k + 1) * 0.03), r: (k % 2 ? -1 : 1) * (1.2 + k), z: 20 - k };
  });
  // Seen: into the tray in reveal order, or quietly behind the card in front.
  const thumb = THUMB_W / card.w;
  const thumbH = card.h * thumb;
  seen.forEach((i) => {
    places[i] =
      tray === "side"
        ? { x: front.x + (card.w * f) / 2 + TRAY_GAP + THUMB_W / 2, y: front.y + (i - mid) * (thumbH + THUMB_GAP), s: thumb, r: 0, z: 5 + i }
        : { x: front.x, y: front.y, s: f * 0.94, r: 0, z: 4 + i, o: 0 };
  });
  return places;
}

/** CSS transform for a place, for an element centred on the table's top-left corner. */
export const placeTransform = (p: Place) => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;
