/**
 * HallPass — the editable-override layer over the STATIC games catalogue.
 *
 * The source of truth for what games exist (and their immutable presentation:
 * `slug`, `gradient`, `accent`, `art`, plus the seed `plays`) remains the
 * hand-authored `games` array in `@/app/lib/games`. This module adds a thin,
 * server-only override layer on top of it: a dashboard editor may rewrite only
 * the DESCRIPTIVE fields — `title`, `tagline`, `description`, `category`,
 * `tags`, `isNew`, `isFeatured` — and those edits live in the `game_overrides`
 * Neon table (one row per slug, every overridable column NULLABLE). A NULL
 * column means "no override; fall back to the static value", so an override row
 * can touch one field and leave the rest inherited.
 *
 * FAIL-SOFT, the load-bearing rule of this module:
 *   The public site MUST render even when Neon is unconfigured or briefly
 *   unreachable. So the cached read ({@link readOverrides}) is wrapped in a
 *   try/catch that returns `[]` on ANY failure, and the resolve* helpers below
 *   simply map the static catalogue with no overrides applied. Mirrors the
 *   sentinel-return pattern in `app/lib/overview.ts` — never throw to a page.
 *
 * Caching: the override read is memoised with `unstable_cache` under the
 * {@link CACHE_TAG} tag (1h soft TTL). The catalogue is small and read on every
 * public render, so we serve it from the data cache and invalidate explicitly
 * on edit. MUTATIONS below are deliberately UNCACHED; after any of them a server
 * action MUST call `revalidateTag(CACHE_TAG)` and `revalidatePath(...)` for the
 * affected public routes (home/games/play) so the next render rebuilds the
 * cache — that wiring lives in the action, NOT here.
 *
 * SQL safety — carried over from the scoreboard store: the `neon()` tagged
 * template parameterises interpolated VALUES; it does NOT reliably splice raw
 * SQL fragments. We therefore only ever interpolate BOUND values (`slug` and the
 * column values), never a fragment.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import { games, type Game } from "@/app/lib/games";
import { readExternalGames } from "@/app/lib/external-games-store";

/**
 * The cache tag under which {@link readOverrides} is stored. Re-exported so the
 * server actions that perform the mutations below can `revalidateTag(CACHE_TAG)`
 * without re-declaring the literal.
 */
export const CACHE_TAG = "game-overrides";

/**
 * A single row of `game_overrides`. Every overridable field is NULLABLE: `null`
 * means "inherit the static catalogue value", a non-null value means "replace
 * it". `slug` is the primary key and is never null. This shape is also the patch
 * surface for {@link getOverride}/{@link upsertOverride}.
 */
export type GameOverride = {
  slug: string;
  title: string | null;
  tagline: string | null;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  isNew: boolean | null;
  isFeatured: boolean | null;
};

/** A row as returned by the driver (column names as keys). */
type Row = Record<string, unknown>;

/** Coerce a free-form driver value to `string | null`. */
function toStringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

/** Coerce a free-form driver value to `boolean | null`. */
function toBoolOrNull(value: unknown): boolean | null {
  return value == null ? null : Boolean(value);
}

/**
 * Coerce a driver `tags` value to `string[] | null`. Postgres array columns come
 * back from the HTTP driver as JS arrays; anything non-array (incl. NULL) maps to
 * `null` ("inherit"), and array elements are stringified defensively.
 */
function toTagsOrNull(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map(String) : null;
}

/** Map a `game_overrides` row to the {@link GameOverride} egress shape. */
function mapOverride(row: Row): GameOverride {
  return {
    slug: String(row.slug),
    title: toStringOrNull(row.title),
    tagline: toStringOrNull(row.tagline),
    description: toStringOrNull(row.description),
    category: toStringOrNull(row.category),
    tags: toTagsOrNull(row.tags),
    isNew: toBoolOrNull(row.is_new),
    isFeatured: toBoolOrNull(row.is_featured),
  };
}

/**
 * The cached primitive behind {@link readOverrides}. It THROWS on any failure on
 * purpose: `unstable_cache` only stores a fulfilled result, so a transient DB
 * blip must reject here rather than resolve to `[]` — otherwise the empty list
 * would be cached under {@link CACHE_TAG} for the full 1h TTL and wipe every
 * override site-wide. Memoised with a 1h soft revalidate; explicit
 * `revalidateTag` after a mutation makes edits appear immediately.
 */
const readOverridesCached = unstable_cache(
  async (): Promise<GameOverride[]> => {
    const rows = await sql`
      SELECT slug, title, tagline, description, category, tags, is_new, is_featured
      FROM game_overrides
    `;
    return rows.map(mapOverride);
  },
  ["game-overrides"],
  { tags: [CACHE_TAG], revalidate: 3600 },
);

/**
 * Read EVERY override row, FAIL-SOFT. The try/catch lives at the CALL SITE (not
 * inside {@link readOverridesCached}) so only SUCCESSFUL reads are cached: a
 * missing/unreachable database (or an unconfigured `DATABASE_URL`) returns `[]`
 * WITHOUT poisoning the cache, the public site falls back to the static
 * catalogue, and the next render retries the read.
 */
async function readOverrides(): Promise<GameOverride[]> {
  try {
    return await readOverridesCached();
  } catch {
    return [];
  }
}

/**
 * The public catalogue with overrides applied: the static `games` array, each
 * game's DESCRIPTIVE fields replaced by its override's non-null values. The
 * immutable presentation (`slug`, `gradient`, `accent`, `art`, `plays`) is kept
 * from the static entry via spread. EXTERNAL games (off-site, iframe-embedded;
 * see `@/app/lib/external-games-store`) are APPENDED after the static catalogue so
 * they surface in the same listings/filters as native games. Never throws — both
 * {@link readOverrides} and {@link readExternalGames} fail soft (returning `[]`),
 * so an outage yields the unmodified static catalogue with nothing appended.
 */
export async function resolveGames(): Promise<Game[]> {
  const [overrides, external] = await Promise.all([
    readOverrides(),
    readExternalGames(),
  ]);
  const bySlug = new Map(overrides.map((o) => [o.slug, o]));
  const mapped = games.map((game) => {
    const o = bySlug.get(game.slug);
    if (!o) return game;
    return {
      ...game,
      title: o.title ?? game.title,
      tagline: o.tagline ?? game.tagline,
      description: o.description ?? game.description,
      category: o.category ?? game.category,
      tags: o.tags ?? game.tags,
      isNew: o.isNew ?? game.isNew,
      isFeatured: o.isFeatured ?? game.isFeatured,
    };
  });
  // External games are appended after the static catalogue (which may itself be
  // override-edited); the resolve* helpers below derive from this combined list.
  return [...mapped, ...external];
}

/** The resolved (override-applied) game for `slug`, or `undefined` if unknown. */
export async function resolveGame(slug: string): Promise<Game | undefined> {
  return (await resolveGames()).find((g) => g.slug === slug);
}

/**
 * Whether `slug` names a game in the RESOLVED catalogue — static entries AND
 * dashboard-created external games.
 *
 * Use this, not a check against the static `games` array, whenever a write is
 * being gated on "is this a real game". `app/lib/favorites.ts` builds its
 * `KNOWN_SLUGS` set from the static array at module load, which is why a
 * signed-in player favouriting an EXTERNAL game has it silently dropped
 * server-side while localStorage happily keeps it. Do not reproduce that.
 *
 * Cheap: `resolveGames()` is `unstable_cache`d, so this is a cache hit rather
 * than a query. It inherits that read's fail-soft behaviour, which has a
 * consequence worth knowing — during a Neon outage the external half resolves to
 * `[]`, so a legitimate external slug reads as unknown. Callers should prefer a
 * retryable "try again" over writing an unverified slug; the column's own
 * `CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$')` is the structural backstop.
 */
export async function isResolvedSlug(slug: string): Promise<boolean> {
  return (await resolveGames()).some((g) => g.slug === slug);
}

/**
 * Sorted, unique category list derived from the RESOLVED catalogue — NOT the
 * static `categories`, because `category` is itself override-editable (a renamed
 * or re-bucketed game must show up under its new category in filters/nav).
 */
export async function resolveCategories(): Promise<string[]> {
  const all = await resolveGames();
  return Array.from(new Set(all.map((g) => g.category))).sort();
}

/**
 * Every distinct tag across the RESOLVED catalogue, each with the number of games
 * carrying it. Derived from {@link resolveGames} (NOT the static `games`) so that
 * override-edited tags are counted under their current value. Sorted by `count`
 * DESC then `tag` ASC — the order the dashboard's tag-curation list renders in.
 */
export async function resolveTags(): Promise<{ tag: string; count: number }[]> {
  const all = await resolveGames();
  const counts = new Map<string, number>();
  for (const game of all) {
    for (const tag of game.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

/**
 * Every distinct category (genre) across the RESOLVED catalogue with its game
 * count — the homepage category rows in list form. Like {@link resolveTags},
 * derived from {@link resolveGames} so override-rebucketed games count under their
 * current category. Sorted by `count` DESC then `name` ASC.
 */
export async function resolveGenres(): Promise<{ name: string; count: number }[]> {
  const all = await resolveGames();
  const counts = new Map<string, number>();
  for (const game of all) {
    counts.set(game.category, (counts.get(game.category) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

/* -------------------------------------------------------------------------- *
 * MUTATIONS — called from server actions. Deliberately UNCACHED. After any of
 * these the caller MUST `revalidateTag(CACHE_TAG)` and `revalidatePath(...)` the
 * affected public routes so the next render rebuilds the override cache.
 * -------------------------------------------------------------------------- */

/** The single override row for `slug`, or `null` when none exists. */
export async function getOverride(slug: string): Promise<GameOverride | null> {
  const rows = await sql`
    SELECT slug, title, tagline, description, category, tags, is_new, is_featured
    FROM game_overrides
    WHERE slug = ${slug}
  `;
  return rows.length > 0 ? mapOverride(rows[0]) : null;
}

/**
 * Insert or replace the override row for `slug`. Every overridable column is
 * written from `patch`, defaulting a MISSING (or explicitly-undefined) key to
 * `null` — i.e. "inherit the static value" — so a partial patch fully defines
 * the row rather than merging into a prior one. `ON CONFLICT (slug)` upserts and
 * stamps `updated_at = now()`. Only bound values are interpolated.
 */
export async function upsertOverride(
  slug: string,
  patch: Partial<Omit<GameOverride, "slug">>,
): Promise<void> {
  const title = patch.title ?? null;
  const tagline = patch.tagline ?? null;
  const description = patch.description ?? null;
  const category = patch.category ?? null;
  const tags = patch.tags ?? null;
  const isNew = patch.isNew ?? null;
  const isFeatured = patch.isFeatured ?? null;
  await sql`
    INSERT INTO game_overrides (slug, title, tagline, description, category, tags, is_new, is_featured)
    VALUES (${slug}, ${title}, ${tagline}, ${description}, ${category}, ${tags}, ${isNew}, ${isFeatured})
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      tagline = EXCLUDED.tagline,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      tags = EXCLUDED.tags,
      is_new = EXCLUDED.is_new,
      is_featured = EXCLUDED.is_featured,
      updated_at = now()
  `;
}

/** Remove the override row for `slug` entirely (game reverts to static values). */
export async function clearOverride(slug: string): Promise<void> {
  await sql`DELETE FROM game_overrides WHERE slug = ${slug}`;
}

/* -------------------------------------------------------------------------- *
 * CURATION — single-column flag writes. These NEVER go through
 * {@link upsertOverride}: that helper full-replaces the row and would null every
 * other overridable field. Each helper instead touches ONLY its one flag column,
 * leaving the rest of the override (title/tagline/…) untouched. As with all
 * mutations, the CALLER must `revalidateTag(CACHE_TAG)` + `revalidatePath(...)`.
 * -------------------------------------------------------------------------- */

/**
 * Set ONLY the `is_featured` flag for `slug`, inserting a sparse override row if
 * none exists. The `ON CONFLICT (slug)` updates `is_featured` alone (plus
 * `updated_at`), so any existing title/tagline/etc. override survives untouched.
 * Internal: callers use {@link setFeaturedGame} to enforce the single-featured
 * invariant. Only bound values are interpolated.
 */
async function setIsFeatured(slug: string, value: boolean): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, is_featured)
    VALUES (${slug}, ${value})
    ON CONFLICT (slug) DO UPDATE SET
      is_featured = EXCLUDED.is_featured,
      updated_at = now()
  `;
}

/**
 * Set ONLY the `is_new` flag for `slug` (sparse-insert + single-column upsert),
 * leaving every other overridable field intact. Caller must revalidate after.
 */
export async function setGameNew(slug: string, value: boolean): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, is_new)
    VALUES (${slug}, ${value})
    ON CONFLICT (slug) DO UPDATE SET
      is_new = EXCLUDED.is_new,
      updated_at = now()
  `;
}

/**
 * Make `slug` the ONE featured game. Features `slug`, then un-features every
 * OTHER game currently resolving as featured — which clears both the
 * static-`isFeatured` default and any stray override-featured row, since we read
 * the RESOLVED catalogue ({@link resolveGames}) rather than just the overrides.
 * Caller must revalidate after.
 */
export async function setFeaturedGame(slug: string): Promise<void> {
  const all = await resolveGames();
  await setIsFeatured(slug, true);
  for (const g of all) {
    if (g.slug !== slug && g.isFeatured) {
      await setIsFeatured(g.slug, false);
    }
  }
}

/**
 * Set ONLY the descriptive columns (`title`, `tagline`, `description`,
 * `category`) for `slug`, sparse-inserting a row if none exists. Each `null` in
 * `patch` means "inherit the static value" for that column. Crucially this does
 * NOT touch `tags`/`is_new`/`is_featured` — the details editor saves through here
 * (instead of {@link upsertOverride}, which full-replaces the row) so a details
 * save never clobbers a curated tag list or a flag. Only bound values are
 * interpolated. Caller must `revalidateTag(CACHE_TAG)` + `revalidatePath(...)`.
 */
export async function setDetailsOverride(
  slug: string,
  patch: {
    title: string | null;
    tagline: string | null;
    description: string | null;
    category: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, title, tagline, description, category)
    VALUES (${slug}, ${patch.title}, ${patch.tagline}, ${patch.description}, ${patch.category})
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      tagline = EXCLUDED.tagline,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      updated_at = now()
  `;
}

/**
 * Set ONLY the `tags` column for `slug` (sparse-insert + single-column upsert),
 * leaving title/category/flags intact. `null` inherits the static tag list; an
 * empty array is a real override meaning "no tags". The array is sent as a bound
 * value (the driver maps it to the `text[]` column). Caller must revalidate after.
 */
export async function setGameTags(
  slug: string,
  tags: string[] | null,
): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, tags)
    VALUES (${slug}, ${tags})
    ON CONFLICT (slug) DO UPDATE SET
      tags = EXCLUDED.tags,
      updated_at = now()
  `;
}

/**
 * Set ONLY the `category` column for `slug` (sparse-insert + single-column
 * upsert), leaving every other overridable field intact. `null` inherits the
 * static category. Only bound values are interpolated. Caller must revalidate.
 */
export async function setGameCategory(
  slug: string,
  category: string | null,
): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, category)
    VALUES (${slug}, ${category})
    ON CONFLICT (slug) DO UPDATE SET
      category = EXCLUDED.category,
      updated_at = now()
  `;
}

/* -------------------------------------------------------------------------- *
 * GLOBAL CURATION — fix a tag/genre across the WHOLE catalogue in one call.
 * These iterate the RESOLVED catalogue and write per-game through the targeted
 * helpers above (so only `tags`/`category` are touched). As with all mutations
 * the CALLER must `revalidateTag(CACHE_TAG)` + `revalidatePath(...)` afterwards.
 * -------------------------------------------------------------------------- */

/**
 * Rename (or merge, or delete) a tag across every game. `to` is trimmed; an EMPTY
 * `to` DELETES `from` from every game that has it. For each game whose RESOLVED
 * tags include `from`, the new list is the resolved tags with every `from`
 * replaced by `to` (or dropped when `to` is empty), then de-duplicated with order
 * preserved — so renaming `from` onto an EXISTING tag merges them. Writes via
 * {@link setGameTags}. Returns the number of games changed.
 */
export async function renameTag(from: string, to: string): Promise<number> {
  const target = to.trim();
  const all = await resolveGames();
  let changed = 0;
  for (const game of all) {
    // EXTERNAL games carry their tags in the `external_games` table, NOT the
    // `game_overrides` table that {@link setGameTags} writes to — resolveGames()
    // appends them straight from readExternalGames() and never merges overrides
    // for them. Writing an override row keyed by an external slug would be an
    // orphan the resolver ignores, so the rename would silently no-op yet still
    // be counted. Skip them: global tag curation only touches the static catalogue.
    if (game.externalUrl) continue;
    if (!game.tags.includes(from)) continue;
    const seen = new Set<string>();
    const newTags: string[] = [];
    for (const tag of game.tags) {
      const next = tag === from ? target : tag;
      if (next === "") continue; // empty target => `from` is removed
      if (seen.has(next)) continue; // dedup, order preserved
      seen.add(next);
      newTags.push(next);
    }
    await setGameTags(game.slug, newTags);
    changed += 1;
  }
  return changed;
}

/**
 * Rename (or merge) a category across every game. `to` is trimmed and MUST be
 * non-empty — a category, unlike a tag, cannot be cleared (returns 0 if blank).
 * For each game whose RESOLVED category === `from`, writes the new category via
 * {@link setGameCategory}. Returns the number of games changed.
 */
export async function renameCategory(from: string, to: string): Promise<number> {
  const target = to.trim();
  if (target === "") return 0;
  const all = await resolveGames();
  let changed = 0;
  for (const game of all) {
    // Skip EXTERNAL games for the same reason as {@link renameTag}: their
    // category lives in `external_games`, so a `game_overrides` write keyed by an
    // external slug is an orphan the resolver never applies (silent no-op).
    if (game.externalUrl) continue;
    if (game.category !== from) continue;
    await setGameCategory(game.slug, target);
    changed += 1;
  }
  return changed;
}
