import type { Game } from "./games";
import { playsFor } from "./plays";

/**
 * HallPass — the orders the main catalogue grid can be put in.
 *
 * PURE, and deliberately free of `"use client"` and of React, so it unit tests
 * in the plain `node` environment the way `categories.ts` does. The preference
 * itself (which order is selected, and whether the grid is drawn as cards or as
 * a list) lives in `catalog-prefs.ts`; this module only knows how to apply one.
 *
 * ── WHY THERE IS NO "NEWEST" ───────────────────────────────────────────────
 * The obvious fourth order is "newest first", and it is missing on purpose: no
 * game in this catalogue carries a date it was added on. `Game` has no such
 * field, and the array position that looks like one is not one. `resolveGames()`
 * returns the static array (appended to as games are onboarded, so oldest first)
 * and then appends the EXTERNAL games, which arrive `ORDER BY created_at DESC` —
 * newest first. So position means opposite things in the two halves of the same
 * array, and the two halves interleave in time rather than stacking: checked
 * against production, the four external games span July to September while the
 * newest static entry is newer than three of them.
 *
 * Sorting on array position would therefore print a confident ordering that is
 * simply wrong, and wrong in a way nobody would catch by looking. `isNew` is a
 * real, admin-maintained field that says what the site actually means by new, so
 * the order offered here is "New first" — which is what it does, and all it
 * claims. A true recency order wants an `addedAt` on `Game`, backfilled from
 * `external_games.created_at` for the external half and from the git history for
 * the static half; that is a data change, not a sort, and it is not this.
 */
export type CatalogSort = "featured" | "played" | "new" | "alpha";

/**
 * The order the grid is in when nobody has chosen one — and it is the order the
 * grid was in before this control existed, which is the point. A visitor who
 * never touches the toolbar, and every prerendered copy of this page, sees
 * exactly the catalogue that shipped yesterday.
 */
export const DEFAULT_CATALOG_SORT: CatalogSort = "featured";

/** The orders, in the order the toolbar offers them. */
export const CATALOG_SORTS: readonly { value: CatalogSort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "played", label: "Most played" },
  { value: "new", label: "New first" },
  { value: "alpha", label: "A–Z" },
];

/**
 * Narrow an untrusted value — a `localStorage` string written by an older build,
 * or by hand in devtools — to a {@link CatalogSort}, or `null` for anything else.
 *
 * Same contract as `toGamePlatform` in `games.ts`, and for the same reason: a
 * stored preference is user-writable input, and a cast would let `"plays"` (the
 * name this nearly shipped under) into a union that swears it cannot be there.
 */
export function toCatalogSort(value: unknown): CatalogSort | null {
  return CATALOG_SORTS.some((s) => s.value === value)
    ? (value as CatalogSort)
    : null;
}

/** One game, decorated with everything the comparators need to read. */
type Entry = {
  game: Game;
  /** Position in the incoming list — the ONE tiebreak, so ties never wobble. */
  index: number;
  /** The caller's device ranking; see {@link sortCatalog}. */
  rank: number;
  /** Resolved once here rather than per comparison. */
  plays: number;
};

/**
 * The PRIMARY key of each order, or `null` for the one that has none.
 *
 * `featured` having no key is what makes it the untouched catalogue: with
 * nothing to say, the comparator falls straight through to the device rank and
 * then to the original position, which is precisely the ordering this grid had
 * before the toolbar existed.
 */
const PRIMARY: Record<CatalogSort, ((a: Entry, b: Entry) => number) | null> = {
  featured: null,
  played: (a, b) => b.plays - a.plays,
  new: (a, b) => Number(Boolean(b.game.isNew)) - Number(Boolean(a.game.isNew)),
  // No explicit locale: this runs only in the browser (see below), so the
  // visitor's own collation is the right one — it is their alphabet being
  // promised. `numeric` keeps "Rig 2" above "Rig 10"; `base` keeps case and
  // accents from splitting the alphabet in two.
  alpha: (a, b) =>
    a.game.title.localeCompare(b.game.title, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
};

/**
 * `games`, reordered. Never filtered, never mutated — the returned array holds
 * the same games as the one passed in, which is the catalogue's standing rule:
 * a listing may reorder and it may label, but membership is identical on every
 * device and in every order, because search crawlers are mobile clients and a
 * game dropped from a listing is a game dropped from the index.
 *
 * ── THE THREE KEYS, AND WHY THEY SIT IN THAT ORDER ─────────────────────────
 * `rank` is the caller's device ranking (`Arcade` passes playable-here → not
 * checked → known not to work here). Under the default order it is the OUTER
 * key, exactly as it was before this module existed: with no chosen order, "put
 * the games this machine can actually run first" is the best thing the grid can
 * say.
 *
 * Under a CHOSEN order it drops to the tiebreak, and that inversion is the whole
 * argument. A grid labelled "A–Z" that is not alphabetical is not a nuance, it
 * is a broken control — and on this page the cost of demoting rank is close to
 * nil, because the desktop grid is the only caller: the mobile shell returns
 * before it, so "unplayable here" means a mobile-only game on a laptop, or a
 * visitor who asked for the desktop site on their phone and can be taken at
 * their word.
 *
 * `index` is last and is never skipped, so equal games keep the order they
 * arrived in. Array.prototype.sort is specified as stable, but the explicit
 * tiebreak documents that the ordering inside a group is load-bearing rather
 * than incidental — the same note `Arcade`'s device pass carries.
 */
export function sortCatalog(
  games: Game[],
  {
    sort,
    playCounts = {},
    rank = () => 0,
  }: {
    sort: CatalogSort;
    playCounts?: Record<string, number>;
    rank?: (game: Game) => number;
  },
): Game[] {
  const primary = PRIMARY[sort] ?? null;
  return games
    .map(
      (game, index): Entry => ({
        game,
        index,
        rank: rank(game),
        plays: playsFor(game, playCounts),
      }),
    )
    .sort(
      (a, b) =>
        (primary ? primary(a, b) : 0) || a.rank - b.rank || a.index - b.index,
    )
    .map((entry) => entry.game);
}
