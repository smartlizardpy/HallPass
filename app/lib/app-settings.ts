/**
 * HallPass — operator-controlled runtime settings, over Neon.
 *
 * See `app/lib/app-settings.sql` for the table and what belongs in it. This
 * module is the whole access layer: one cached read of the ENTIRE table, and two
 * writes. Callers never touch `sql` for a setting.
 *
 * ONE CACHE ENTRY FOR EVERY KEY, deliberately. The table holds a handful of rows
 * and the reads are scattered (the games-version poll, every blob-spending
 * action, the settings page itself), so a per-key `unstable_cache` would key on
 * a runtime argument, grow an unbounded number of entries, and need a tag each.
 * Same reasoning as `readOverrides()` and `readAllMediaCached()`.
 *
 * FAIL-SOFT AT THE CALL SITE, NOT IN THE CACHE. `unstable_cache` only stores a
 * FULFILLED result, so the cached primitive must REJECT on failure — swallowing
 * a transient Neon blip into an empty map would pin every setting to its default
 * for the full TTL. {@link readAppSettings} does the catching, one layer out.
 *
 * MISSING ROW MEANS DEFAULT. Nothing here is ever seeded: a key that has never
 * been written simply is not in the table, and each reader supplies its own
 * default. That is what makes the migration a pure `CREATE TABLE` with no
 * INSERTs, and what makes an unmigrated database behave exactly like a
 * freshly-migrated one.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

/** Cache tag for the settings read. Every writer invalidates it. */
export const APP_SETTINGS_CACHE_TAG = "app-settings";

/**
 * How long a settings read may be reused, in seconds.
 *
 * Correctness does not depend on it — both writers below `updateTag` this tag,
 * which is read-your-writes — so this is only a backstop for a value written by
 * another deployment or by hand in the Neon console. Long, because these are
 * settings: an hour of staleness on a value nobody changed is free, and the
 * games-version poll behind it runs every 30 seconds on every open tab.
 */
const SETTINGS_TTL_SECONDS = 3600;

/**
 * THROWS on failure by design — see the fail-soft note in the module docblock.
 * Returns entries rather than a Map because the data cache stores JSON.
 */
const readAppSettingsCached = unstable_cache(
  async (): Promise<[string, string][]> => {
    const rows = await sql`SELECT key, value FROM app_settings`;
    return rows.map((row) => [String(row.key), String(row.value)]);
  },
  ["app-settings"],
  { tags: [APP_SETTINGS_CACHE_TAG], revalidate: SETTINGS_TTL_SECONDS },
);

/**
 * Every stored setting, keyed by name. Fail-soft to an EMPTY map, which every
 * reader interprets as "all defaults" — the same state a database that has not
 * had migration 026 applied is in.
 */
export async function readAppSettings(): Promise<Map<string, string>> {
  try {
    return new Map(await readAppSettingsCached());
  } catch {
    return new Map();
  }
}

/** One setting, or `null` when unset. Fail-soft via {@link readAppSettings}. */
export async function readAppSetting(key: string): Promise<string | null> {
  return (await readAppSettings()).get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations — uncached. Callers `updateTag(APP_SETTINGS_CACHE_TAG)`.
// ---------------------------------------------------------------------------

/**
 * Write one setting. Upserts, so a caller never has to know whether the key
 * exists — which is what lets "missing row means default" hold without seeding.
 *
 * `actor` is stored for tracing only and is never rendered; pass `null` for a
 * write that no person made.
 *
 * THROWS on failure. A setting that silently failed to save is worse than an
 * error banner: the operator would believe a kill switch was thrown when it was
 * not.
 */
export async function writeAppSetting(
  key: string,
  value: string,
  actor: string | null,
): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES (${key}, ${value}, ${actor})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by
  `;
}

/**
 * Write several settings in one statement — the "turn everything off" button.
 *
 * One round trip rather than N: the `neon()` HTTP driver sends each tagged
 * template as its own request, so a loop would be one HTTP call per switch AND
 * would leave the switches half-applied if it failed part way through. `unnest`
 * expands bound arrays server-side; nothing is spliced into the SQL text.
 */
export async function writeAppSettings(
  entries: readonly (readonly [key: string, value: string])[],
  actor: string | null,
): Promise<void> {
  if (entries.length === 0) return;
  await sql`
    INSERT INTO app_settings (key, value, updated_by)
    SELECT * FROM unnest(
      ${entries.map(([key]) => key)}::text[],
      ${entries.map(([, value]) => value)}::text[],
      ${entries.map(() => actor)}::text[]
    )
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by
  `;
}
