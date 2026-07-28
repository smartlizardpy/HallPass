/**
 * HallPass — per-player favorites store over Neon (SERVER-ONLY).
 *
 * The signed-in mirror of the browser `personalization.ts` favorites list: when
 * a verified player favorites a game, that slug is persisted here (keyed by the
 * player's Google subject id) so it follows them across devices. Anonymous/guest
 * favorites never reach this layer — they live in localStorage only. See
 * `migrations/004_player_favorites.sql` for the `player_favorites` table.
 *
 * Like `players.ts`, this module talks to the shared, server-only `sql` from
 * `@/app/lib/db` directly (no `createStore` factory).
 *
 * SQL safety — the load-bearing rule, carried over from `players.ts`/the
 * scoreboard store:
 *   The `neon()` tagged template parameterises interpolated VALUES; it does NOT
 *   reliably splice raw SQL fragments. So we NEVER interpolate a fragment — only
 *   ever BOUND values (`playerId`, `slug`, and the bound `text[]` array).
 *
 * Slug-trust invariant — the load-bearing rule of THIS module:
 *   A `slug` must name a REAL game in the static catalogue before it is written.
 *   {@link isKnownSlug} rejects junk up front, so the table can never accumulate
 *   slugs that don't resolve to a game (and a malicious client can't use it as
 *   arbitrary key/value storage). Reads also drop now-unknown slugs defensively.
 *
 * FAIL-SOFT: every read is wrapped try/catch → `[]`, and writes swallow errors
 * (logged, never re-thrown) so a transient DB blip degrades a favorite toggle to
 * "didn't sync" rather than 500-ing the caller. Mirrors `players.ts`.
 */

import "server-only";
import { sql } from "@/app/lib/db";
import { resolveGames } from "@/app/lib/games-store";

/**
 * The set of slugs a favorite may name, from the RESOLVED catalogue.
 *
 * This used to be built at module load from the STATIC `games` array, which
 * silently dropped every external (dashboard-created) game: a signed-in player
 * could favorite one, see the heart fill from localStorage, and have the write
 * discarded server-side with no error anywhere — so the favorite vanished on
 * their next device. `resolveGames()` merges static + overrides + external and is
 * `unstable_cache`d, so this is a cache hit rather than a query.
 *
 * Fail-soft consequence worth knowing: during a Neon outage the external half
 * resolves to `[]`, so an external slug reads as unknown and its write is
 * skipped. The alternative — writing unverified slugs — would let this table be
 * used as arbitrary key/value storage, which is the invariant this guard exists
 * to protect.
 */
async function knownSlugs(): Promise<ReadonlySet<string>> {
  return new Set((await resolveGames()).map((g) => g.slug));
}

/**
 * Validate + de-duplicate a batch of slugs for a bulk write: drop non-strings,
 * unknown slugs, and duplicates while PRESERVING order.
 *
 * Takes the known-slug set as an ARGUMENT rather than reaching for it, so this
 * stays pure and unit-testable while the set itself became async.
 */
export function normalizeFavoriteSlugs(
  slugs: string[],
  known: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of slugs) {
    if (typeof slug !== "string") continue;
    if (!known.has(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/**
 * A player's favorited slugs, newest-first (`ORDER BY created_at DESC`). FAIL-SOFT
 * → `[]` on any failure. Unknown slugs (a game later removed from the catalogue)
 * are filtered out so the surface only ever returns resolvable slugs.
 */
export async function listFavorites(playerId: string): Promise<string[]> {
  try {
    const rows = await sql`
      SELECT slug FROM player_favorites
      WHERE player_id = ${playerId}
      ORDER BY created_at DESC
    `;
    const known = await knownSlugs();
    return rows.map((row) => String(row.slug)).filter((slug) => known.has(slug));
  } catch (error) {
    console.error("listFavorites failed:", error);
    return [];
  }
}

/**
 * Add a single favorite for `playerId`. Junk slugs are rejected before any write.
 * `ON CONFLICT DO NOTHING` makes a repeat add idempotent (the existing
 * `created_at` is kept). Both values are bound. Fail-soft: a DB error is logged,
 * not thrown.
 */
export async function addFavorite(playerId: string, slug: string): Promise<void> {
  if (!(await knownSlugs()).has(slug)) return;
  try {
    await sql`
      INSERT INTO player_favorites (player_id, slug)
      VALUES (${playerId}, ${slug})
      ON CONFLICT DO NOTHING
    `;
  } catch (error) {
    console.error("addFavorite failed:", error);
  }
}

/**
 * Remove a single favorite for `playerId`. A no-op if the row doesn't exist. Both
 * values are bound. Fail-soft: a DB error is logged, not thrown.
 */
export async function removeFavorite(playerId: string, slug: string): Promise<void> {
  try {
    await sql`
      DELETE FROM player_favorites
      WHERE player_id = ${playerId} AND slug = ${slug}
    `;
  } catch (error) {
    console.error("removeFavorite failed:", error);
  }
}

/**
 * Bulk-merge a batch of slugs into `playerId`'s favorites (the login-time union
 * of a device's guest favorites with the server's), then return the resulting
 * full, newest-first list. Slugs are validated + de-duped via
 * {@link normalizeFavoriteSlugs}; the surviving set is inserted in ONE statement
 * (`unnest` over a BOUND `text[]`) with `ON CONFLICT DO NOTHING` so existing
 * favorites keep their original `created_at`. Fail-soft → `[]`.
 */
export async function mergeFavorites(playerId: string, slugs: string[]): Promise<string[]> {
  const valid = normalizeFavoriteSlugs(slugs, await knownSlugs());
  try {
    if (valid.length > 0) {
      await sql`
        INSERT INTO player_favorites (player_id, slug)
        SELECT ${playerId}, s FROM unnest(${valid}::text[]) AS s
        ON CONFLICT DO NOTHING
      `;
    }
    return await listFavorites(playerId);
  } catch (error) {
    console.error("mergeFavorites failed:", error);
    return [];
  }
}
