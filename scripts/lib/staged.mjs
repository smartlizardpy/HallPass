// Which games are STAGED (beta-testers-only), as the deploy scripts need to
// know it — a plain-Node twin of the resolution in `app/lib/game-staging.ts`.
//
// WHY THIS IS A SEPARATE, TESTABLE MODULE. `scripts/sync-games.mjs` runs in CI
// BEFORE the build and mirrors Blob into `public/games/`, which Vercel serves as
// free, PUBLIC static files at predictable URLs. A staged game must never reach
// that directory: the whole point of staging is that only beta testers can see
// the game, and a file under `public/games/<slug>/` answers to anyone who guesses
// the path, bypassing every gate the serving route applies. So the decision "is
// this slug staged?" has to be made correctly here, and it has to be made
// without the TypeScript app — an .mjs script cannot import `games.ts`, which is
// why the static flag is read with a regex, the same trade `sync-games` already
// makes for `isSafeSegment` ("duplicated, keep in sync"). The test in
// `app/lib/staged-sync.test.ts` parses the REAL games.ts, so the regex cannot
// drift from the file's format unnoticed. (It lives under `app/` because
// vitest's `include` only covers `app/**` and `sdk/**`.)
//
// THE RULE, matching the app: effective staged = override ?? static ?? false.
//   - static   `staged: true` on the entry in `games.ts` (the floor; the
//              add-game skill writes it)
//   - override `game_overrides.staged`, tri-state: NULL inherits the static
//              flag, false means "published", true means "staged"
//   - external `external_games.staged`, NOT NULL, there is no static entry
// A dashboard "Publish" sets the override to false, which is how a game that is
// still `staged: true` in games.ts goes live with no code change — and why the
// deploy after it has to mirror a game whose directory does not exist yet.
//
// FAIL-CLOSED, NOT FAIL-OPEN. If the database cannot be read, the static flag
// still applies, so a game the repo says is staged is never mirrored. What the
// script cannot know without the database is whether an override PUBLISHED one,
// so in that state it falls back to today's behaviour (mirror only directories
// that already exist) and never creates a new one. The cost of that fallback is
// a published-later game waiting for the next healthy deploy to be mirrored;
// the route keeps serving it from Blob in the meantime, so nothing 404s.

/**
 * One entry of the `games` array in `app/lib/games.ts`, as far as a deploy
 * script cares: its slug and whether the entry carries `staged: true`.
 *
 * @typedef {{ slug: string, staged: boolean }} StaticGame
 */

/**
 * The static catalogue entries in `games.ts` source text.
 *
 * Reads the array between `export const games: Game[] = [` and the closing
 * `];`, then each top-level object in it. The 4-space anchors matter: they tie
 * both matches to the entry's own keys, so a `staged: true` that appears in a
 * nested object or inside a description string is not mistaken for the flag.
 * The entries are Prettier-formatted, which is what makes a line-anchored match
 * safe; `staged-sync.test.ts` fails if that stops being true.
 *
 * @param {string} source contents of app/lib/games.ts
 * @returns {StaticGame[]}
 */
export function parseStaticGames(source) {
  const start = source.indexOf("export const games: Game[] = [");
  if (start === -1) return [];
  const end = source.indexOf("\n];", start);
  const body = source.slice(start, end === -1 ? undefined : end);

  /** @type {StaticGame[]} */
  const found = [];
  for (const entry of body.matchAll(/^ {2}\{\n([\s\S]*?)^ {2}\},?$/gm)) {
    const slug = /^ {4}slug:\s*"([^"]+)"/m.exec(entry[1])?.[1];
    if (!slug) continue;
    found.push({ slug, staged: /^ {4}staged:\s*true\b/m.test(entry[1]) });
  }
  return found;
}

/**
 * Resolve the effective staged state of every slug the deploy needs to reason
 * about, and which slugs are registered at all.
 *
 * `overrides`/`externals` are `null` when the database could not be read; the
 * result then carries `registered: null`, meaning "unknown", which callers must
 * treat as "create nothing".
 *
 * @param {object} input
 * @param {StaticGame[]} input.staticGames
 * @param {{ slug: string, staged: boolean | null }[] | null} input.overrides
 *   rows of `game_overrides` that set `staged` (NULL rows are simply absent)
 * @param {{ slug: string, staged: boolean }[] | null} input.externals
 *   rows of `external_games`
 * @returns {{ staged: Set<string>, registered: Set<string> | null }}
 */
export function resolveStaged({ staticGames, overrides, externals }) {
  const staged = new Set();
  for (const g of staticGames) if (g.staged) staged.add(g.slug);

  if (overrides === null || externals === null) {
    return { staged, registered: null };
  }

  // Override wins over the static flag in BOTH directions: `false` publishes a
  // `staged: true` entry, `true` stages a published one.
  for (const o of overrides) {
    if (o.staged === true) staged.add(o.slug);
    else if (o.staged === false) staged.delete(o.slug);
  }

  const registered = new Set(staticGames.map((g) => g.slug));
  for (const e of externals) {
    registered.add(e.slug);
    // An external game has no static entry, so its column IS the answer.
    if (e.staged) staged.add(e.slug);
    else staged.delete(e.slug);
  }
  return { staged, registered };
}

/**
 * What the sync should do with the blobs of one slug.
 *
 *  - `skip-staged`   staged; never mirrored, whether or not a directory exists
 *  - `mirror`        a local directory exists, or the slug is registered and
 *                    not staged (its directory is created on write)
 *  - `skip-no-dir`   no directory and no proof the game is published — today's
 *                    "deleted game?" skip, and the only outcome when the
 *                    database was unreachable
 *
 * @param {object} input
 * @param {string} input.slug
 * @param {boolean} input.hasLocalDir
 * @param {Set<string>} input.staged
 * @param {Set<string> | null} input.registered null when the DB was unreachable
 * @returns {"skip-staged" | "mirror" | "skip-no-dir"}
 */
export function decideSlug({ slug, hasLocalDir, staged, registered }) {
  if (staged.has(slug)) return "skip-staged";
  if (hasLocalDir) return "mirror";
  if (registered?.has(slug)) return "mirror";
  return "skip-no-dir";
}

/**
 * Read the staging state out of Neon. Returns `null` for either list when the
 * query fails — a missing column (migration 035 not applied), a bad URL, a
 * network error — so the caller degrades to the static-only fallback instead of
 * aborting a deploy over a read it can live without.
 *
 * `sql` is a tagged-template query function, `neon(url)` in production.
 *
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>} sql
 * @returns {Promise<{
 *   overrides: { slug: string, staged: boolean | null }[] | null,
 *   externals: { slug: string, staged: boolean }[] | null,
 *   error: string | null,
 * }>}
 */
export async function fetchStagedRows(sql) {
  try {
    const [overrides, externals] = await Promise.all([
      sql`SELECT slug, staged FROM game_overrides WHERE staged IS NOT NULL`,
      sql`SELECT slug, staged FROM external_games`,
    ]);
    return { overrides, externals, error: null };
  } catch (err) {
    return {
      overrides: null,
      externals: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
