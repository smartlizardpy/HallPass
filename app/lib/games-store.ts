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
 * action MUST call `updateTag(CACHE_TAG)` and `revalidatePath(...)` for the
 * affected public routes (home/games/play) so the next render rebuilds the
 * cache — that wiring lives in the action, NOT here.
 *
 * STAGED GAMES. A staged game is visible only to beta testers and dashboard
 * roles until published (`app/lib/game-staging.ts` holds the pure rules). The
 * resolvers are therefore SPLIT, and the split is the safety property:
 *   - {@link resolveGames}/{@link resolveGame}/{@link isResolvedSlug} and the
 *     category/tag/genre lists are PUBLIC-ONLY. Every pre-existing caller is safe
 *     by default — none of them can leak a staged game.
 *   - {@link resolveGamesIncludingStaged}/{@link resolveGameIncludingStaged}/
 *     {@link isKnownSlug}/{@link isStagedSlug} see everything. Reach for them only
 *     behind a `canViewStaged()` check or for dashboard/write-gating use; a test
 *     holds an allowlist of the files that may import them.
 * Reads stay fail-soft: if Neon is down the override layer is `[]`, the static
 * `staged` flag applies, and staged games stay hidden (fail closed).
 *
 * SQL safety — carried over from the scoreboard store: the `neon()` tagged
 * template parameterises interpolated VALUES; it does NOT reliably splice raw
 * SQL fragments. We therefore only ever interpolate BOUND values (`slug` and the
 * column values), never a fragment.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import {
  games,
  toGamePlatform,
  type Game,
  type GamePlatform,
} from "@/app/lib/games";
import { readExternalGames } from "@/app/lib/external-games-store";
import {
  categoriesOf,
  genreCounts,
  isStaged,
  mergeCatalogue,
  tagCounts,
  withoutStaged,
} from "@/app/lib/game-staging";

/**
 * The cache tag under which {@link readOverrides} is stored. Re-exported so the
 * server actions that perform the mutations below can `updateTag(CACHE_TAG)`
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
  platform: GamePlatform | null;
  /**
   * Tri-state like every other column: `null` inherits the static `Game.staged`,
   * `true` stages the game, `false` publishes it (beating a static `true`).
   */
  staged: boolean | null;
  /** The catalogue cover (a promoted tester shot). `null` inherits. */
  coverUrl: string | null;
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
    // NOT `toStringOrNull`: this one is VALIDATED, not stringified. The column is
    // TEXT with a CHECK, but it still arrives here as `unknown`, and a row written
    // before that constraint existed (or by hand in a psql session) must not be
    // able to enter the `GamePlatform` union. Anything unrecognised reads as
    // `null` — unknown — which the whole app already handles.
    platform: toGamePlatform(row.platform),
    staged: toBoolOrNull(row.staged),
    coverUrl: toStringOrNull(row.cover_url),
  };
}

/**
 * The cached primitive behind {@link readOverrides}. It THROWS on any failure on
 * purpose: `unstable_cache` only stores a fulfilled result, so a transient DB
 * blip must reject here rather than resolve to `[]` — otherwise the empty list
 * would be cached under {@link CACHE_TAG} for the full 1h TTL and wipe every
 * override site-wide. Memoised with a 1h soft revalidate; explicit
 * `updateTag` after a mutation makes edits appear immediately.
 */
const readOverridesCached = unstable_cache(
  async (): Promise<GameOverride[]> => {
    const rows = await sql`
      SELECT slug, title, tagline, description, category, tags, is_new, is_featured, platform,
             staged, cover_url
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
 * The FULL catalogue with overrides applied, staged games INCLUDED: the static
 * `games` array, each game's DESCRIPTIVE fields (and `staged`/`coverUrl`)
 * replaced by its override's non-null values. The immutable presentation
 * (`slug`, `gradient`, `accent`, `art`, `plays`) is kept from the static entry.
 * EXTERNAL games (off-site, iframe-embedded; see
 * `@/app/lib/external-games-store`) are APPENDED after the static catalogue so
 * they surface in the same listings/filters as native games. Never throws — both
 * {@link readOverrides} and {@link readExternalGames} fail soft (returning `[]`),
 * so an outage yields the unmodified static catalogue with nothing appended.
 *
 * NOT for public surfaces. This is the including-staged view: use it behind a
 * `canViewStaged()` check, in the dashboard, or where a write is being gated on
 * "is this a real game". Everything else wants {@link resolveGames}.
 */
export async function resolveGamesIncludingStaged(): Promise<Game[]> {
  const [overrides, external] = await Promise.all([
    readOverrides(),
    readExternalGames(),
  ]);
  return mergeCatalogue(games, overrides, external);
}

/**
 * The PUBLIC catalogue: {@link resolveGamesIncludingStaged} minus staged games.
 * Public-only by default so every caller that predates staging is safe without
 * being touched. Never throws, and fails closed — see the module docblock.
 */
export async function resolveGames(): Promise<Game[]> {
  return withoutStaged(await resolveGamesIncludingStaged());
}

/** The resolved PUBLIC game for `slug`, or `undefined` if unknown or staged. */
export async function resolveGame(slug: string): Promise<Game | undefined> {
  return (await resolveGames()).find((g) => g.slug === slug);
}

/**
 * The resolved game for `slug` INCLUDING staged ones, or `undefined` if unknown.
 * Only behind `canViewStaged()` or a dashboard role check.
 */
export async function resolveGameIncludingStaged(
  slug: string,
): Promise<Game | undefined> {
  return (await resolveGamesIncludingStaged()).find((g) => g.slug === slug);
}

/**
 * Whether `slug` names a PUBLIC game in the RESOLVED catalogue — static entries
 * AND dashboard-created external games, staged games excluded. To ask "is this a
 * real game at all", staged included, use {@link isKnownSlug}.
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
 * Whether `slug` names a game at all, STAGED INCLUDED. For existence checks that
 * a tester-visible write needs (an achievement, a review on a staged game); it
 * says nothing about whether the caller may SEE the game — pair it with
 * `canViewStaged()`.
 */
export async function isKnownSlug(slug: string): Promise<boolean> {
  return (await resolveGamesIncludingStaged()).some((g) => g.slug === slug);
}

/**
 * Whether `slug` is a known game that is currently staged. `false` for an
 * unknown slug, so "staged" never doubles as "exists". Cache-backed like the
 * resolvers, and fail-closed: with Neon down a static `staged: true` still
 * reads as staged.
 */
export async function isStagedSlug(slug: string): Promise<boolean> {
  const game = await resolveGameIncludingStaged(slug);
  return game !== undefined && isStaged(game);
}

/**
 * Sorted, unique category list derived from the PUBLIC resolved catalogue — NOT the
 * static `categories`, because `category` is itself override-editable (a renamed
 * or re-bucketed game must show up under its new category in filters/nav).
 */
export async function resolveCategories(): Promise<string[]> {
  return categoriesOf(await resolveGames());
}

/**
 * Every distinct tag across the RESOLVED catalogue, each with the number of games
 * carrying it. Derived from {@link resolveGames} (NOT the static `games`) so that
 * override-edited tags are counted under their current value. Sorted by `count`
 * DESC then `tag` ASC — the order the dashboard's tag-curation list renders in.
 */
export async function resolveTags(): Promise<{ tag: string; count: number }[]> {
  return tagCounts(await resolveGames());
}

/**
 * Every distinct category (genre) across the RESOLVED catalogue with its game
 * count — the homepage category rows in list form. Like {@link resolveTags},
 * derived from {@link resolveGames} so override-rebucketed games count under their
 * current category. Sorted by `count` DESC then `name` ASC.
 */
export async function resolveGenres(): Promise<{ name: string; count: number }[]> {
  return genreCounts(await resolveGames());
}

/* -------------------------------------------------------------------------- *
 * MUTATIONS — called from server actions. Deliberately UNCACHED. After any of
 * these the caller MUST `updateTag(CACHE_TAG)` and `revalidatePath(...)` the
 * affected public routes so the next render rebuilds the override cache.
 * -------------------------------------------------------------------------- */

/** The single override row for `slug`, or `null` when none exists. */
export async function getOverride(slug: string): Promise<GameOverride | null> {
  const rows = await sql`
    SELECT slug, title, tagline, description, category, tags, is_new, is_featured, platform,
             staged, cover_url
    FROM game_overrides
    WHERE slug = ${slug}
  `;
  return rows.length > 0 ? mapOverride(rows[0]) : null;
}

/**
 * The copy fields {@link upsertOverride} writes. `staged` and `coverUrl` are
 * EXCLUDED at the type level: the statement never touches those columns, so
 * accepting them would make passing one a silent no-op. They move only through
 * {@link setGameStaged} and {@link setGameCover}.
 */
export type UpsertOverridePatch = Partial<Omit<GameOverride, "slug" | "staged" | "coverUrl">>;

/**
 * Insert or replace the override row for `slug`. Every overridable column is
 * written from `patch`, defaulting a MISSING (or explicitly-undefined) key to
 * `null` — i.e. "inherit the static value" — so a partial patch fully defines
 * the row rather than merging into a prior one. `ON CONFLICT (slug)` upserts and
 * stamps `updated_at = now()`. Only bound values are interpolated.
 *
 * `staged` and `cover_url` are deliberately NOT in this statement: neither in
 * the INSERT column list nor the `DO UPDATE SET`. A full-replace of the copy
 * fields must not un-stage a staged game or re-stage a published one, and must
 * not drop a chosen cover; those columns move only through
 * {@link setGameStaged} and {@link setGameCover}. A new row gets NULL (inherit).
 */
export async function upsertOverride(
  slug: string,
  patch: UpsertOverridePatch,
): Promise<void> {
  const title = patch.title ?? null;
  const tagline = patch.tagline ?? null;
  const description = patch.description ?? null;
  const category = patch.category ?? null;
  const tags = patch.tags ?? null;
  const isNew = patch.isNew ?? null;
  const isFeatured = patch.isFeatured ?? null;
  // `platform` is listed here for the same reason as every other column: this
  // helper's contract is that the patch FULLY defines the row. Omitting it would
  // quietly make that false — a platform tag would survive an upsert that wiped
  // the title — and a half-replacing "replace" is worse than either behaviour on
  // its own. Callers that want to touch the tag alone use {@link setGamePlatform}.
  const platform = patch.platform ?? null;
  await sql`
    INSERT INTO game_overrides (slug, title, tagline, description, category, tags, is_new, is_featured, platform)
    VALUES (${slug}, ${title}, ${tagline}, ${description}, ${category}, ${tags}, ${isNew}, ${isFeatured}, ${platform})
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      tagline = EXCLUDED.tagline,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      tags = EXCLUDED.tags,
      is_new = EXCLUDED.is_new,
      is_featured = EXCLUDED.is_featured,
      platform = EXCLUDED.platform,
      updated_at = now()
  `;
}

/**
 * Revert `slug` to its static values: every copy/flag column goes back to NULL
 * (inherit). The row is then deleted only if nothing else is pinned on it.
 *
 * `staged` and `cover_url` SURVIVE. A plain DELETE would wipe `staged = false`,
 * and a game published from a static `staged: true` would silently become staged
 * again — hidden from the public by a "reset copy" click. The same goes for the
 * promoted cover. So the descriptive columns are nulled in place and the row is
 * removed only when `staged` and `cover_url` are both NULL too, leaving no empty
 * husk behind for the common case.
 */
export async function clearOverride(slug: string): Promise<void> {
  await sql`
    UPDATE game_overrides
    SET title = NULL, tagline = NULL, description = NULL, category = NULL,
        tags = NULL, is_new = NULL, is_featured = NULL, platform = NULL,
        updated_at = now()
    WHERE slug = ${slug}
  `;
  await sql`
    DELETE FROM game_overrides
    WHERE slug = ${slug} AND staged IS NULL AND cover_url IS NULL
  `;
}

/* -------------------------------------------------------------------------- *
 * CURATION — single-column flag writes. These NEVER go through
 * {@link upsertOverride}: that helper full-replaces the row and would null every
 * other overridable field. Each helper instead touches ONLY its one flag column,
 * leaving the rest of the override (title/tagline/…) untouched. As with all
 * mutations, the CALLER must `updateTag(CACHE_TAG)` + `revalidatePath(...)`.
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
 * Set ONLY the `platform` tag for `slug` (sparse-insert + single-column upsert),
 * leaving every other overridable field intact. Caller must revalidate after.
 *
 * `null` is a first-class argument, not an absence: it stores SQL NULL, which
 * resolves the game back to UNKNOWN. An admin who tagged a game wrong needs to be
 * able to say "actually I do not know" and have the badge and the sort stop
 * asserting anything — clearing the tag is not the same as clearing the whole
 * override row ({@link clearOverride}), which would also discard their copy edits.
 *
 * Unlike `is_new`/`is_featured` this is a CAPABILITY rather than a curation flag —
 * it describes the game, not our editorial opinion of it — which is why the
 * dashboard puts it on the game's own page instead of the Curation screen. The
 * write mechanics are identical, hence its home here.
 */
export async function setGamePlatform(
  slug: string,
  value: GamePlatform | null,
): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, platform)
    VALUES (${slug}, ${value})
    ON CONFLICT (slug) DO UPDATE SET
      platform = EXCLUDED.platform,
      updated_at = now()
  `;
}

/**
 * Set ONLY the `staged` flag for `slug` (sparse-insert + single-column upsert),
 * leaving every other overridable field intact. `true` stages, `false` publishes
 * (and beats a static `staged: true`), `null` inherits the static flag.
 *
 * Publishing goes through here with `false`. Callers must never pass `true` for a
 * game whose files have already been mirrored into `public/games` — that copy is
 * served statically and would leak (see the plan's "stage again" exclusion).
 * Caller must `updateTag(CACHE_TAG)` + revalidate after.
 */
export async function setGameStaged(
  slug: string,
  value: boolean | null,
): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, staged)
    VALUES (${slug}, ${value})
    ON CONFLICT (slug) DO UPDATE SET
      staged = EXCLUDED.staged,
      updated_at = now()
  `;
}

/**
 * Set ONLY the `cover_url` for `slug` (sparse-insert + single-column upsert).
 * `null` inherits the static `coverUrl` and then the `/games/<slug>/cover.png`
 * convention. Caller must `updateTag(CACHE_TAG)` + revalidate after.
 */
export async function setGameCover(
  slug: string,
  coverUrl: string | null,
): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, cover_url)
    VALUES (${slug}, ${coverUrl})
    ON CONFLICT (slug) DO UPDATE SET
      cover_url = EXCLUDED.cover_url,
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
  // Including-staged on purpose: a staged game resolving as featured must still
  // be un-featured, or it would pop back as the featured game the moment it is
  // published.
  const all = await resolveGamesIncludingStaged();
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
 * interpolated. Caller must `updateTag(CACHE_TAG)` + `revalidatePath(...)`.
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
 * the CALLER must `updateTag(CACHE_TAG)` + `revalidatePath(...)` afterwards.
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
  // Including-staged so a rename reaches games that are not public yet; the
  // public-only view would leave a staged game on the old tag, and it would
  // surface un-renamed at publish.
  const all = await resolveGamesIncludingStaged();
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
  // Including-staged for the same reason as {@link renameTag}.
  const all = await resolveGamesIncludingStaged();
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
