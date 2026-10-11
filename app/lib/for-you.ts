/**
 * HallPass — the "for you" order of the main game grid.
 *
 * PURE and DOM-free, like `catalog-order.ts`, so the ranking is unit-tested with
 * made-up players instead of reasoned about inside a component. It runs in the
 * browser, over data that never leaves the device (see `taste-store.ts`); this
 * module does not know where any of its inputs came from.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 * It turns what a player has done on THIS device — favourites, the recently
 * played list, and a rolling per-game play count — into a taste: how much they
 * lean towards each tag and category. Every game is then scored by how well it
 * fits that taste, with a little for newness, for being playable on this device,
 * for being popular and for the quality a super admin has rated it, and the result is re-ranked so that ten near-identical
 * games do not sit in a row.
 *
 * ── WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────────────
 *   * NOT A FILTER. It returns an ORDER of every game it was given, never fewer.
 *     The catalogue's standing rule is that a listing may reorder but membership
 *     is identical for everyone (`sortCatalog`): search crawlers are mobile
 *     clients, and a game dropped from a listing is a game dropped from the index.
 *   * NOT A GUESS ON THIN EVIDENCE. With fewer than {@link MIN_SIGNALS} games the
 *     player has shown any interest in, it returns `null` and the caller keeps
 *     the normal Featured order. An order built from one play reads as random, and
 *     "random" is worse than "the usual".
 *   * NOT UNSTABLE. The caller passes `now` rounded to the day, and the one
 *     pseudo-random term is a hash of the slug and that day, so the grid does not
 *     reshuffle on every render or every visit within a day.
 *
 * Staged games never reach this: it ranks the list it is handed, and the public
 * catalogue (`resolveGames`) has already left them out.
 */

import type { Game } from "./games";
import type { DevicePlatform } from "./use-device-platform";
import { playsFor } from "./plays";
import { qualityBoost } from "./quality";

/** One game's play history on this device. */
export type TasteEntry = {
  /** How many plays this device has recorded for it. */
  n: number;
  /** When it was last played, in ms since the epoch. */
  t: number;
};

export type ForYouInput = {
  /** The PUBLIC catalogue, in its normal (Featured) order. */
  games: Game[];
  /** Per-game history from the device's taste store, keyed by slug. */
  taste: Record<string, TasteEntry>;
  /** Favourited slugs. */
  favorites: string[];
  /** Recently played slugs, most recent first. */
  recent: string[];
  /** `null` until the device is known (the server render, the first paint). */
  device: DevicePlatform | null;
  /** The site-wide play counts, for the small popularity prior. */
  playCounts: Record<string, number>;
  /** The start of today in ms — see the note on stability above. */
  today: number;
};

export type ForYouResult = {
  /** EVERY input game's slug, best fit first. */
  order: string[];
  /** The one or two things this player leans towards, for the grid's one-line note. */
  topInterests: string[];
};

/** Games a player must have shown interest in before an order is worth printing. */
export const MIN_SIGNALS = 3;

/** After this long, a play counts for half what it did when it happened. */
const HALF_LIFE_DAYS = 21;
const DAY_MS = 86_400_000;

const W_FAVORITE = 3;
/** Weight of the first recently-played slot; each later slot is worth 0.85x the last. */
const W_RECENT = 2;
const RECENT_DECAY = 0.85;
const W_PLAYS = 1.5;

/** How much a category counts against a tag in the taste: a category is broader. */
const CATEGORY_BOOST = 1.2;

/** What the player's own favourites and plays add back to those games' scores. */
const OWN_INTEREST = 0.6;
const W_NEW = 0.35;
const W_FEATURED = 0.2;
const W_POPULAR = 0.25;
const PLAYABLE_HERE = 0.3;
/**
 * Larger than the most a perfect taste match, the newness nudge and the popularity
 * prior can add together, so a game KNOWN not to work on this device sinks below
 * every game that does — the same promise the Featured order makes with its
 * device ranking, and for the same reason: "tapped it, it did not respond" is the
 * failure the platform tag exists to prevent. It stays IN the list (see the note
 * on membership above); it just goes last.
 */
const NOT_PLAYABLE_HERE = -5;
const JITTER = 0.15;

/** The diversity pass looks at this many candidates and this many previous picks. */
const WINDOW = 6;
const LOOKBACK = 3;
const SAME_CATEGORY_PENALTY = 0.3;

/** A small deterministic number in [0, 1) from a string. FNV-1a. */
function hash01(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Everything a game contributes to the taste. */
function interestIn(
  slug: string,
  input: ForYouInput,
  recentIndex: Map<string, number>,
  favorites: Set<string>,
): number {
  let score = 0;
  if (favorites.has(slug)) score += W_FAVORITE;
  const r = recentIndex.get(slug);
  if (r !== undefined) score += W_RECENT * RECENT_DECAY ** r;
  const entry = input.taste[slug];
  if (entry && entry.n > 0) {
    const ageDays = Math.max(0, (input.today - entry.t) / DAY_MS);
    score += W_PLAYS * Math.log2(1 + entry.n) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
  }
  return score;
}

/**
 * The order, or `null` when there is not enough to go on.
 *
 * An unknown `device` (the server render, the first paint) just skips the
 * device term; everything else is the same.
 */
export function rankForYou(input: ForYouInput): ForYouResult | null {
  const { games } = input;
  if (games.length === 0) return null;

  const favorites = new Set(input.favorites);
  const recentIndex = new Map(input.recent.map((slug, i) => [slug, i] as const));
  const bySlug = new Map(games.map((g) => [g.slug, g] as const));

  // 1. What has this player shown interest in, and how much?
  const interest = new Map<string, number>();
  const considered = new Set<string>([
    ...favorites,
    ...input.recent,
    ...Object.keys(input.taste),
  ]);
  for (const slug of considered) {
    if (!bySlug.has(slug)) continue; // left the catalogue, or staged: ignore it
    const value = interestIn(slug, input, recentIndex, favorites);
    if (value > 0) interest.set(slug, value);
  }
  if (interest.size < MIN_SIGNALS) return null;

  // 2. Turn it into a taste: how much each tag and category is liked.
  const tagTaste = new Map<string, number>();
  const categoryTaste = new Map<string, number>();
  for (const [slug, value] of interest) {
    const game = bySlug.get(slug)!;
    const tags = game.tags.map(norm).filter(Boolean);
    for (const tag of tags) {
      // Split a game's weight across its tags, so a game with ten tags does not
      // count ten times as much as one with two.
      tagTaste.set(tag, (tagTaste.get(tag) ?? 0) + value / Math.sqrt(Math.max(1, tags.length)));
    }
    const category = norm(game.category);
    if (category) categoryTaste.set(category, (categoryTaste.get(category) ?? 0) + value);
  }
  const maxOf = (m: Map<string, number>) => Math.max(1e-9, ...m.values());
  const maxTag = maxOf(tagTaste);
  const maxCategory = maxOf(categoryTaste);

  // 3. Score every game.
  const maxInterest = Math.max(1e-9, ...interest.values());
  const scored = games.map((game, index) => {
    const tags = game.tags.map(norm).filter(Boolean);
    const tagFit =
      tags.reduce((sum, tag) => sum + (tagTaste.get(tag) ?? 0) / maxTag, 0) /
      Math.sqrt(Math.max(1, tags.length));
    const categoryFit = (categoryTaste.get(norm(game.category)) ?? 0) / maxCategory;
    const own = (interest.get(game.slug) ?? 0) / maxInterest;

    let score = tagFit + CATEGORY_BOOST * categoryFit + OWN_INTEREST * own;
    if (game.isNew) score += W_NEW;
    if (game.isFeatured) score += W_FEATURED;
    score += W_POPULAR * Math.min(1, Math.log10(1 + playsFor(game, input.playCounts)) / 3);
    // A super admin's quality rating, bounded and small beside the taste terms:
    // it breaks ties between similarly relevant games, it never outranks a match.
    // An unrated game adds nothing (see `quality.ts`).
    score += qualityBoost(game.quality);
    if (input.device) {
      const fits =
        !game.platform ? null : game.platform === "both" || game.platform === input.device;
      if (fits === true) score += PLAYABLE_HERE;
      else if (fits === false) score += NOT_PLAYABLE_HERE;
    }
    score += JITTER * hash01(`${game.slug}:${Math.floor(input.today / DAY_MS)}`);
    return { game, score, index };
  });
  // Best first; the incoming position breaks ties, so equal games keep their order.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  // 4. Diversity: from the best few remaining, take the one that does not repeat
  // the category of the last few picks (a gentle penalty, not a ban).
  const order: string[] = [];
  const lastCategories: string[] = [];
  const pool = [...scored];
  while (pool.length > 0) {
    let bestAt = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < Math.min(WINDOW, pool.length); i++) {
      const repeats = lastCategories.filter((c) => c === norm(pool[i].game.category)).length;
      const value = pool[i].score - SAME_CATEGORY_PENALTY * repeats;
      if (value > bestValue) {
        bestValue = value;
        bestAt = i;
      }
    }
    const [picked] = pool.splice(bestAt, 1);
    order.push(picked.game.slug);
    lastCategories.push(norm(picked.game.category));
    if (lastCategories.length > LOOKBACK) lastCategories.shift();
  }

  // 5. The line the grid prints: the most-liked tag, then the most-liked category.
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topInterests = [top(tagTaste), top(categoryTaste)]
    .filter((x): x is string => Boolean(x))
    .filter((x, i, all) => all.indexOf(x) === i);

  return { order, topInterests };
}
