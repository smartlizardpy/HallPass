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
 * them (`dots`, phones).
 *
 * The results: on laptops the three side by side, bottoms level, the best pull
 * in the middle and larger, under its badge; on phones the best pull alone
 * (a list under it names all of them).
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

/** Room above the best pull for its badge, and below every result for its caption. */
export const BADGE_H = 40;
export const CAPTION_H = 34;
const RESULT_GAP = 24;
/** Phones: the best pull is shown at the binder's card size. */
const PHONE_BEST_W = CARD_PX.sm.w;

/** Height the table needs in the summary on a phone: the best pull under its badge. Laptops fill their column. */
export function summaryHeight(card: CardSize): number {
  return Math.round((PHONE_BEST_W / card.w) * card.h + BADGE_H + 12);
}

/** The best pull: the rarest, and of those the last one turned over. */
export function bestPull(ranks: readonly number[]): number {
  let best = 0;
  ranks.forEach((r, i) => {
    if (r >= ranks[best]) best = i;
  });
  return best;
}

export interface PlaceInput {
  tray: Tray;
  table: TableSize;
  card: CardSize;
  count: number;
  flipped: boolean[];
  current: number;
  summary: boolean;
  /** The summary's best pull (`bestPull`). */
  best?: number;
}

/** The card in front: centred between the plate and the tag, shrunk only if the table is too short. */
export function frontPlace(table: TableSize, card: CardSize): Place {
  const band = table.h - BANNER_H - TAG_H;
  const f = Math.min(1, Math.max(0.6, band / card.h));
  return { x: table.w / 2, y: BANNER_H + Math.max((card.h * f) / 2, band / 2), s: f, r: 0, z: 30 };
}

export function placeCards({ tray, table, card, count, flipped, current, summary, best = count - 1 }: PlaceInput): Place[] {
  const mid = (count - 1) / 2;
  if (summary) return placeResults(tray, table, card, count, best);

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

function placeResults(tray: Tray, table: TableSize, card: CardSize, count: number, best: number): Place[] {
  const places = new Array<Place>(count);
  if (tray === "dots") {
    const s = PHONE_BEST_W / card.w;
    const y = BADGE_H + (card.h * s) / 2;
    for (let i = 0; i < count; i++) places[i] = i === best ? { x: table.w / 2, y, s, r: 0, z: 30 } : { x: table.w / 2, y, s: s * 0.94, r: 0, z: 4 + i, o: 0 };
    return places;
  }
  // The best pull at the large size, the others at the medium size, scaled down together if the column is narrow or short.
  const others = [...Array(count).keys()].filter((i) => i !== best);
  let sb = Math.min(CARD_PX.lg.w / card.w, (table.h - BADGE_H - CAPTION_H) / card.h);
  let so = sb * (CARD_PX.md.w / CARD_PX.lg.w);
  const width = card.w * (sb + others.length * so) + RESULT_GAP * others.length;
  const k = Math.min(1, (table.w - 16) / width);
  sb *= k;
  so *= k;
  const bottom = BADGE_H + (table.h - BADGE_H - CAPTION_H + card.h * sb) / 2;
  const cx = table.w / 2;
  places[best] = { x: cx, y: bottom - (card.h * sb) / 2, s: sb, r: 0, z: 30 };
  // The others either side, in the order they were turned over: left, right, further left, further right.
  others.forEach((i, n) => {
    const side = n % 2 === 0 ? -1 : 1;
    const step = Math.floor(n / 2);
    const x = cx + side * ((card.w * sb) / 2 + RESULT_GAP + (card.w * so) / 2 + step * (card.w * so + RESULT_GAP));
    places[i] = { x, y: bottom - (card.h * so) / 2, s: so, r: 0, z: 20 - n };
  });
  return places;
}

/** CSS transform for a place, for an element centred on the table's top-left corner. */
export const placeTransform = (p: Place) => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;
