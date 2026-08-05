/**
 * HallPass — the games-version sentinel: its blob path and its cache tag.
 *
 * Deliberately has NO `import "server-only"` and no Blob dependency: both the
 * `/games-version` route and the dashboard's source-mutating actions import
 * these constants, and neither should have to re-declare the literal.
 *
 * WHAT THE SENTINEL IS. `games/version.txt` is rewritten by `bumpGamesVersion()`
 * every time a game's source changes. Its `uploadedAt` is the version number
 * clients poll for; when it moves, the service worker re-fetches every cached
 * `/game-html/` document and asset so offline players do not get pinned to a
 * torn new-index/old-assets mix.
 */

export const GAMES_VERSION_BLOB_PATH = "games/version.txt";

/**
 * Cache tag for the `head()` of the sentinel.
 *
 * WHY THIS EXISTS. `/games-version` is polled by EVERY client every 30s
 * (`app/components/PWA.tsx`), and `public/sw.js` deliberately does not intercept
 * it, so every poll reached the function and spent one `head()` — a BILLED
 * Vercel Blob "simple operation". Measured over 30 days that was 5,974 of 6,100
 * simple operations, i.e. 95% of the entire monthly allowance (Hobby: 10,000),
 * for a value that changes only when an admin uploads a game.
 *
 * Cost now scales with TIME, not with traffic: at most one `head()` per TTL
 * window no matter how many players are online.
 *
 * INVALIDATION. `bumpGamesVersion()` is the ONLY writer of this blob and it
 * revalidates this tag immediately after the `put()`, so a genuine version bump
 * is visible on the next poll rather than waiting out the TTL. The TTL is
 * therefore only a backstop for out-of-band writes (someone editing the blob in
 * the Vercel dashboard), which is why it can be long.
 */
export const GAMES_VERSION_CACHE_TAG = "games-version-sentinel";
