/**
 * HallPass — the PURE core of staged (beta-only) games.
 *
 * A STAGED game is visible and playable only to beta testers and dashboard
 * roles until an admin publishes it. This module holds the catalogue-merge and
 * visibility rules with no I/O, no `server-only` and no framework imports, so
 * they can be unit-tested directly; `games-store.ts` only feeds it the rows it
 * read and decides which view (public or including-staged) a caller gets.
 *
 * THE FLAG, AND WHO WINS. `Game.staged` in `games.ts` is the floor — the
 * `add-game` skill writes it. `game_overrides.staged` is TRI-STATE on top of it:
 * NULL inherits the static value, a non-NULL value wins. Publishing writes
 * `false`, which beats a static `staged: true` without a code change. External
 * games have no static entry; their row is the whole truth and arrives already
 * resolved on `Game.staged`.
 *
 * FAIL CLOSED. Everything here treats "not exactly `true`" as public only where
 * the data says so, and the store's reads are fail-soft — if Neon is down the
 * override layer is `[]`, the static flag applies, and a static-staged game
 * stays hidden. A staged game never leaks because a read failed.
 *
 * COVER PRECEDENCE. `override.coverUrl ?? static.coverUrl`, and only then the
 * `/games/<slug>/cover.png` convention, which the UI applies when `coverUrl` is
 * absent. Applied here so every resolver agrees.
 */

import type { Game } from "@/app/lib/games";

/**
 * The slice of a `game_overrides` row that this module reads. Structurally a
 * subset of `GameOverride` in `games-store.ts`, redeclared so this file does not
 * import a `server-only` module.
 */
export type StagingOverride = {
  slug: string;
  title: string | null;
  tagline: string | null;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  isNew: boolean | null;
  isFeatured: boolean | null;
  platform: Game["platform"] | null;
  staged: boolean | null;
  coverUrl: string | null;
};

/** Whether `game` is staged. Only an explicit `true` counts. */
export function isStaged(game: Pick<Game, "staged">): boolean {
  return game.staged === true;
}

/** Drop staged games. The public view of any list of games. */
export function withoutStaged<T extends Pick<Game, "staged">>(list: T[]): T[] {
  return list.filter((g) => !isStaged(g));
}

/**
 * Apply one override row to its static game. Each NULL column inherits; a
 * non-NULL column replaces. `platform` may stay absent when both sides are
 * (untagged = UNKNOWN, see `Game.platform`). `staged` is the tri-state described
 * in the module docblock, and `coverUrl` follows the precedence above.
 */
export function applyOverride(game: Game, o: StagingOverride): Game {
  return {
    ...game,
    title: o.title ?? game.title,
    tagline: o.tagline ?? game.tagline,
    description: o.description ?? game.description,
    category: o.category ?? game.category,
    tags: o.tags ?? game.tags,
    isNew: o.isNew ?? game.isNew,
    isFeatured: o.isFeatured ?? game.isFeatured,
    platform: o.platform ?? game.platform,
    staged: o.staged ?? game.staged,
    coverUrl: o.coverUrl ?? game.coverUrl,
  };
}

/**
 * The full resolved catalogue, staged games INCLUDED: the static games with their
 * overrides applied, then the external games appended. Callers choose the view —
 * `withoutStaged` for the public one. Games with no override row are returned as
 * the same object, untouched.
 */
export function mergeCatalogue(
  staticGames: readonly Game[],
  overrides: readonly StagingOverride[],
  external: readonly Game[],
): Game[] {
  const bySlug = new Map(overrides.map((o) => [o.slug, o]));
  const mapped = staticGames.map((game) => {
    const o = bySlug.get(game.slug);
    return o ? applyOverride(game, o) : game;
  });
  return [...mapped, ...external];
}

/** Sorted, unique category list of `list`. */
export function categoriesOf(list: readonly Game[]): string[] {
  return Array.from(new Set(list.map((g) => g.category))).sort();
}

/** Each distinct tag of `list` with its game count; `count` DESC then `tag` ASC. */
export function tagCounts(
  list: readonly Game[],
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const game of list) {
    for (const tag of game.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

/** Each distinct category of `list` with its game count; `count` DESC then `name` ASC. */
export function genreCounts(
  list: readonly Game[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const game of list) {
    counts.set(game.category, (counts.get(game.category) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}
