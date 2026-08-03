/**
 * HallPass — the EXTERNAL (off-site) games layer.
 *
 * Unlike `game_overrides` (which patches descriptive fields of the hand-authored
 * static catalogue in `@/app/lib/games`), every row here is a WHOLE game that is
 * NOT in the static array: a game hosted off-site whose play surface is a
 * third-party URL (`external_url`) embedded in an iframe. These games are
 * APPENDED to the resolved catalogue after the static entries, so they surface in
 * the same home/category/tag listings as native games. Each row is fully
 * self-describing (there is no static entry to inherit from), so every column is
 * present; only `cover_url` may be null (the app falls back to its generated
 * placeholder).
 *
 * FAIL-SOFT, the load-bearing rule of this module:
 *   The public site MUST render even when Neon is unconfigured or briefly
 *   unreachable. So the cached read ({@link readExternalGames}) is wrapped in a
 *   try/catch that returns `[]` on ANY failure — an outage simply means no
 *   external games are appended and the static catalogue renders untouched. Never
 *   throw to a page.
 *
 * Caching: the read is memoised with `unstable_cache` under the
 * {@link EXTERNAL_CACHE_TAG} tag (1h soft TTL). MUTATIONS below are deliberately
 * UNCACHED; after any of them a server action MUST call
 * `revalidateTag(EXTERNAL_CACHE_TAG)` and `revalidatePath(...)` for the affected
 * public routes so the next render rebuilds the cache — that wiring lives in the
 * action, NOT here.
 *
 * SQL safety — carried over from the override store: the `neon()` tagged template
 * parameterises interpolated VALUES; it does NOT reliably splice raw SQL
 * fragments. We therefore only ever interpolate BOUND values (`slug` and the
 * column values), never a fragment.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import { toGamePlatform, type Game, type GamePlatform } from "@/app/lib/games";

/**
 * The cache tag under which {@link readExternalGames} is stored. Re-exported so
 * the server actions that perform the mutations below can
 * `revalidateTag(EXTERNAL_CACHE_TAG)` without re-declaring the literal.
 */
export const EXTERNAL_CACHE_TAG = "external-games";

/**
 * A single row of `external_games` (column names as keys). Every descriptive
 * column is NOT NULL in the schema; `cover_url` and `platform` are the two
 * nullable ones — a NULL `platform` means UNKNOWN (nobody has checked which
 * devices the game works on), not "works on everything".
 */
export type ExternalGameRow = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  external_url: string;
  cover_url: string | null;
  accent: string;
  gradient_from: string;
  gradient_to: string;
  is_new: boolean;
  is_featured: boolean;
  platform: GamePlatform | null;
  plays: number;
};

/** A row as returned by the driver (column names as keys). */
type Row = Record<string, unknown>;

/** Coerce a driver `tags` value to `string[]`. Non-arrays (incl. NULL) map to `[]`. */
function toTags(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Map an `external_games` row to a {@link Game}. External games do not use the
 * generated `art` renderer (their play surface is the iframe), but the `Game`
 * type requires an `ArtStyle`, so we set a valid constant (`"void"`). The
 * off-site marker is `externalUrl`; `coverUrl` is `undefined` when the row has no
 * bespoke cover so the app uses its placeholder.
 */
function mapRow(row: Row): Game {
  const coverUrl = row.cover_url == null ? undefined : String(row.cover_url);
  return {
    slug: String(row.slug),
    title: String(row.title),
    tagline: String(row.tagline),
    description: String(row.description),
    category: String(row.category),
    tags: toTags(row.tags),
    gradient: [String(row.gradient_from), String(row.gradient_to)],
    accent: String(row.accent),
    art: "void",
    isNew: Boolean(row.is_new),
    isFeatured: Boolean(row.is_featured),
    plays: Number(row.plays) || 0,
    externalUrl: String(row.external_url),
    coverUrl,
    // Unlike `art` above, this is NOT a placeholder to satisfy the type — it is a
    // real fact about the game and comes from the column. `undefined` (not
    // `null`) so an untagged external game is indistinguishable from an untagged
    // static one to everything downstream.
    platform: toGamePlatform(row.platform) ?? undefined,
  };
}

/**
 * The cached primitive behind {@link readExternalGames}. It THROWS on any failure
 * on purpose: `unstable_cache` only stores a fulfilled result, so a transient DB
 * blip must reject here rather than resolve to `[]` — otherwise the empty list
 * would be cached under {@link EXTERNAL_CACHE_TAG} for the full 1h TTL and hide
 * every external game site-wide. Memoised with a 1h soft revalidate; explicit
 * `revalidateTag` after a mutation makes edits appear immediately.
 */
const readExternalGamesCached = unstable_cache(
  async (): Promise<Game[]> => {
    const rows = await sql`
      SELECT slug, title, tagline, description, category, tags, external_url,
             cover_url, accent, gradient_from, gradient_to, is_new, is_featured, platform, plays
      FROM external_games
      ORDER BY created_at DESC
    `;
    return rows.map(mapRow);
  },
  ["external-games"],
  { tags: [EXTERNAL_CACHE_TAG], revalidate: 3600 },
);

/**
 * Read EVERY external game, FAIL-SOFT. The try/catch lives at the CALL SITE (not
 * inside {@link readExternalGamesCached}) so only SUCCESSFUL reads are cached: a
 * missing/unreachable database (or an unconfigured `DATABASE_URL`) returns `[]`
 * WITHOUT poisoning the cache, the public site simply appends no external games,
 * and the next render retries the read.
 */
export async function readExternalGames(): Promise<Game[]> {
  try {
    return await readExternalGamesCached();
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- *
 * MUTATIONS — called from server actions. Deliberately UNCACHED. After any of
 * these the caller MUST `revalidateTag(EXTERNAL_CACHE_TAG)` and
 * `revalidatePath(...)` the affected public routes (home/games/play) so the next
 * render rebuilds the external-games cache.
 * -------------------------------------------------------------------------- */

/** Every external game, UNCACHED (dashboard list view). Direct SELECT + {@link mapRow}. */
export async function listExternalGames(): Promise<Game[]> {
  const rows = await sql`
    SELECT slug, title, tagline, description, category, tags, external_url,
           cover_url, accent, gradient_from, gradient_to, is_new, is_featured, platform, plays
    FROM external_games
    ORDER BY created_at DESC
  `;
  return rows.map(mapRow);
}

/** The single external game for `slug`, or `null` when none exists. */
export async function getExternalGame(slug: string): Promise<Game | null> {
  const rows = await sql`
    SELECT slug, title, tagline, description, category, tags, external_url,
           cover_url, accent, gradient_from, gradient_to, is_new, is_featured, platform, plays
    FROM external_games
    WHERE slug = ${slug}
  `;
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/**
 * The typed input for {@link createExternalGame}. Mirrors the writable columns of
 * `external_games`; `coverUrl` may be `null` ("no bespoke cover") and `platform`
 * may be `null` ("nobody has checked which devices this works on"). `plays`,
 * `created_at`, `updated_at` are left to their column defaults.
 */
export type CreateExternalGameInput = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  externalUrl: string;
  coverUrl: string | null;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
  isNew: boolean;
  isFeatured: boolean;
  platform: GamePlatform | null;
};

/**
 * Insert a new external game. Every column is written from `input`; `cover_url`
 * may be null. `plays` and the timestamps use their schema defaults. Only bound
 * values are interpolated. Caller must `revalidateTag(EXTERNAL_CACHE_TAG)` +
 * `revalidatePath(...)` after.
 */
export async function createExternalGame(
  input: CreateExternalGameInput,
): Promise<void> {
  await sql`
    INSERT INTO external_games (
      slug, title, tagline, description, category, tags, external_url,
      cover_url, accent, gradient_from, gradient_to, is_new, is_featured, platform
    )
    VALUES (
      ${input.slug}, ${input.title}, ${input.tagline}, ${input.description},
      ${input.category}, ${input.tags}, ${input.externalUrl}, ${input.coverUrl},
      ${input.accent}, ${input.gradientFrom}, ${input.gradientTo},
      ${input.isNew}, ${input.isFeatured}, ${input.platform}
    )
  `;
}

/**
 * The typed input for {@link updateExternalGameDetails}. Mirrors the DESCRIPTIVE
 * columns an admin edits from the per-game control center — every field the
 * create form collects EXCEPT the cover, which has its own write
 * ({@link updateExternalGameCover}) so a details save never disturbs a
 * separately re-cached cover.
 */
export type UpdateExternalGameInput = {
  title: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  externalUrl: string;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
};

/**
 * Overwrite the descriptive columns of an existing external game in one write.
 * Unlike `game_overrides` (which is sparse — an external game has no static
 * entry to inherit from, so every column is authoritative), this sets each
 * editable column outright from `input`; `cover_url`, `plays`, and the curation
 * flags are left untouched. Only bound values are interpolated. Caller must
 * `revalidateTag(EXTERNAL_CACHE_TAG)` + `revalidatePath(...)` after.
 */
export async function updateExternalGameDetails(
  slug: string,
  input: UpdateExternalGameInput,
): Promise<void> {
  await sql`
    UPDATE external_games
    SET title = ${input.title},
        tagline = ${input.tagline},
        description = ${input.description},
        category = ${input.category},
        tags = ${input.tags},
        external_url = ${input.externalUrl},
        accent = ${input.accent},
        gradient_from = ${input.gradientFrom},
        gradient_to = ${input.gradientTo},
        updated_at = now()
    WHERE slug = ${slug}
  `;
}

/**
 * Overwrite ONLY the `cover_url` of an existing external game (a `null` clears
 * it, falling the app back to its gradient placeholder). Used by the "re-cache
 * cover" action to point a row at a freshly blob-hosted copy of its cover. Only
 * bound values are interpolated. Caller must revalidate after.
 */
export async function updateExternalGameCover(
  slug: string,
  coverUrl: string | null,
): Promise<void> {
  await sql`
    UPDATE external_games
    SET cover_url = ${coverUrl}, updated_at = now()
    WHERE slug = ${slug}
  `;
}

/**
 * Overwrite ONLY the `platform` tag of an existing external game. `null` is a
 * real argument — it stores SQL NULL and returns the game to UNKNOWN, so an admin
 * who tagged it wrong can stop the public site asserting anything about it.
 *
 * A single-column write for the same reason {@link updateExternalGameCover} is
 * one: `updateExternalGameDetails` full-replaces every descriptive column, so
 * routing the tag through it would mean a platform save had to carry the title,
 * tagline, URL and gradients along for the ride. It is also the external mirror
 * of `setGamePlatform` in `games-store.ts` — the two halves of the catalogue
 * should not disagree about how a tag gets written. Caller must revalidate after.
 */
export async function setExternalGamePlatform(
  slug: string,
  platform: GamePlatform | null,
): Promise<void> {
  await sql`
    UPDATE external_games
    SET platform = ${platform}, updated_at = now()
    WHERE slug = ${slug}
  `;
}

/** Delete the external game for `slug` entirely. Caller must revalidate after. */
export async function deleteExternalGame(slug: string): Promise<void> {
  await sql`DELETE FROM external_games WHERE slug = ${slug}`;
}
