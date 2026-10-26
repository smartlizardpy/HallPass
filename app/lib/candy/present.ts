/**
 * HallPass — how a ledger row reads to the player. Pure.
 *
 * The ledger stores a machine `ref`; the player sees a sentence. Another
 * player's name never appears here: a row is always the caller's own.
 */

import { FRIGHT_FEST_2026 } from "../championship/fright-fest-2026";
import { getPack } from "../collectibles/catalogue";
import { CANDY_FRIGHT_FEST_2026, type CandyConfig } from "./fright-fest-2026";
import type { LedgerEntry } from "./store";

export interface ShopItem {
  packId: string;
  name: string;
  /** The collection the pack draws from. */
  collection: string;
  price: number;
  /** The balance covers the price right now. */
  affordable: boolean;
}

export interface RecentEntry {
  kind: LedgerEntry["kind"];
  label: string;
  /** The game's title, for a daily-best credit; otherwise `null`. */
  game: string | null;
  amount: number;
  at: string;
  /** A revoked credit stays on the list, struck through, and does not count. */
  revoked: boolean;
}

export const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
};

const boardTitle = (slug: string) => FRIGHT_FEST_2026.games.find((g) => g.slug === slug)?.title ?? slug;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-29` as `29 Oct`; anything else comes back unchanged. */
export function shortDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : iso;
}

/** Pulls `{ boardId, day, rank }` out of a daily-best ref (`<boardId>#<YYYY-MM-DD>#<rank>`), or null. */
export function parseDailyBestRef(ref: string | null): { boardId: string; day: string; rank: number } | null {
  const [boardId, day, rank] = (ref ?? "").split("#");
  return boardId && day && Number(rank) > 0 ? { boardId, day, rank: Number(rank) } : null;
}

/** "29 Oct · 3rd" for a daily-best ref, else the raw ref. */
export function dailyBestWhen(ref: string | null): string {
  const p = parseDailyBestRef(ref);
  return p ? `${shortDate(p.day)} · ${ordinal(p.rank)}` : (ref ?? "");
}

export function describeEntry(e: LedgerEntry, gameTitles: ReadonlyMap<string, string>): RecentEntry {
  let label: string;
  let game: string | null = null;
  switch (e.kind) {
    case "daily_best": {
      const p = parseDailyBestRef(e.ref);
      game = e.gameSlug ? (gameTitles.get(e.gameSlug) ?? e.gameSlug) : null;
      label = p ? `Best score on ${shortDate(p.day)} · ${ordinal(p.rank)}` : "Best score of the day";
      break;
    }
    case "ranked_run":
      label = `First ranked run: ${boardTitle(e.ref ?? "")}`;
      break;
    case "all_boards":
      label = "A result on every board";
      break;
    case "placing": {
      const [slug, rank] = (e.ref ?? "").split("#");
      label = Number(rank) > 0 ? `Placed ${ordinal(Number(rank))} on ${boardTitle(slug)}` : `Placed on ${boardTitle(slug)}`;
      break;
    }
    default:
      label = `Bought ${getPack(e.ref ?? "")?.name ?? "a pack"}`;
  }
  return { kind: e.kind, label, game, amount: e.amount, at: e.createdAt, revoked: e.revoked };
}

/** The shelf, cheapest first (catalogue order within a price). */
export function shopItems(balance: number, config: CandyConfig = CANDY_FRIGHT_FEST_2026): ShopItem[] {
  return Object.entries(config.prices)
    .flatMap(([packId, price]) => {
      const pack = getPack(packId);
      return pack ? [{ packId, name: pack.name, collection: pack.collection, price, affordable: balance >= price }] : [];
    })
    .sort((a, b) => a.price - b.price);
}

/** A game's payout as the API lists it: the rank-1 value of one of its boards. */
export interface GamePayout {
  boardId: string;
  slug: string;
  title: string;
  boardTitle: string;
  candy: number;
}

/** The boards that pay, best payers first, then by game title. `titles` maps game slug to title; a slug without one reads as itself. */
export function gamePayouts(
  boards: readonly { id: string; gameSlug: string; title: string; candy: number }[],
  titles: ReadonlyMap<string, string>,
): GamePayout[] {
  return boards
    .filter((b) => b.candy > 0)
    .map((b) => ({ boardId: b.id, slug: b.gameSlug, title: titles.get(b.gameSlug) ?? b.gameSlug, boardTitle: b.title, candy: b.candy }))
    .sort((a, b) => b.candy - a.candy || a.title.localeCompare(b.title) || a.boardTitle.localeCompare(b.boardTitle) || a.boardId.localeCompare(b.boardId));
}

/** The parts of the definition every surface shows, with `open` flags for `nowMs` (display only; the database clock decides a spend). */
export function candyInfo(config: CandyConfig, nowMs: number) {
  const at = (iso: string) => Date.parse(iso);
  return {
    event: config.id,
    title: config.title,
    earn: { opensAt: config.opensAt, closesAt: config.closesAt, open: nowMs >= at(config.opensAt) && nowMs < at(config.closesAt) },
    spend: {
      opensAt: config.opensAt,
      until: config.spendUntil,
      untilLabel: config.spendUntilLabel,
      open: nowMs >= at(config.opensAt) && nowMs < at(config.spendUntil),
    },
    rules: {
      rankedRun: config.rankedRun,
      allBoards: config.allBoards,
      placing: config.placing.map((t) => ({ ...t })),
      maxGameCandy: config.maxGameCandy,
      dailyBest: config.dailyBest.map((t) => ({ ...t })),
    },
  };
}
