/**
 * HallPass — the games-version counter: the number installed clients poll to
 * learn that a game's source changed.
 *
 * WHAT IT IS FOR. `app/components/PWA.tsx` polls `/games-version` every 30s and
 * forwards the value to the service worker, which re-fetches every cached
 * `/game-html/` document and asset when it moves — so offline players are never
 * pinned to a torn new-index/old-assets mix. It changes only when an admin
 * publishes; between publishes it is a constant.
 *
 * ── IT USED TO BE A BLOB, AND THAT WAS EXPENSIVE IN BOTH CURRENCIES ─────────
 * The counter was the `uploadedAt` of a `games/version.txt` sentinel object,
 * which cost:
 *
 *   - one `put()` — a BILLED ADVANCED operation, allowance 2,000/month — every
 *     time any admin published anything, on top of the publish's own writes;
 *   - one `head()` — a billed SIMPLE operation — per poll. Uncached that was
 *     5,974 of 6,100 simple operations over 30 days (95% of a 10,000 allowance)
 *     for a value that changes a few times a week; caching it capped that at 24
 *     a day, but not at zero.
 *
 * A monotonic integer that only an admin action changes is exactly what a
 * database row is for, and `app_settings` already exists to hold operational
 * values a deploy should not be needed to change. Storing it there costs no Blob
 * operation in either class, and it retires the last object that lived directly
 * under `games/` rather than under a game.
 *
 * ── THE CONTRACT IS UNCHANGED ───────────────────────────────────────────────
 * Still epoch milliseconds as a decimal string, still monotonic, still "0" when
 * nothing has ever been published or the store cannot be read. The service
 * worker treats an unchanged value as "nothing to do", so a failed read degrades
 * to no refresh rather than to a spurious full-corpus re-download.
 */

import "server-only";
import {
  APP_SETTINGS_CACHE_TAG,
  readAppSetting,
  writeAppSetting,
} from "@/app/lib/app-settings";

/** The `app_settings` key holding the counter. */
export const GAMES_VERSION_SETTING_KEY = "games_version";

/**
 * Cache tag for the counter.
 *
 * It is `app_settings`' own tag, not a tag of its own: the counter lives in that
 * table, one cached read covers the whole table, and a second tag over the same
 * entry could only ever go stale against the first. Kept under this name because
 * `bumpGamesVersion()` and the poll route both read as documentation, and
 * "invalidate the games version" is what the call site means.
 */
export const GAMES_VERSION_CACHE_TAG = APP_SETTINGS_CACHE_TAG;

/**
 * The current version, or `"0"` when nothing has been published yet — which is
 * also what an unreadable store degrades to, via `readAppSetting`'s fail-soft.
 *
 * A string, not a number: it is echoed straight into the poll response and
 * compared for INEQUALITY by the client, so parsing it here would buy nothing
 * and risk a precision surprise.
 */
export async function readGamesVersion(): Promise<string> {
  return (await readAppSetting(GAMES_VERSION_SETTING_KEY)) ?? "0";
}

/**
 * Stamp a new version. THROWS on failure; every caller treats the bump as
 * best-effort and catches, because a missed bump only makes installed clients
 * lag until the next publish and must never undo a successful upload.
 *
 * `Date.now()` rather than an incrementing column: two admins publishing in the
 * same second must not need a read-modify-write, and the value only ever has to
 * DIFFER from the last one the client saw. Callers `updateTag`
 * {@link GAMES_VERSION_CACHE_TAG} afterwards so the next poll sees it rather
 * than waiting out the settings TTL.
 */
export async function writeGamesVersion(actor: string | null): Promise<void> {
  await writeAppSetting(GAMES_VERSION_SETTING_KEY, String(Date.now()), actor);
}
