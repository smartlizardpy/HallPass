// Slugs of the PUBLIC entries in the static `games` array of app/lib/games.ts,
// read by regex because this runs from a plain .mjs build script that cannot
// import TypeScript.
//
// Entries with `staged: true` are skipped. A staged game is visible only to beta
// testers until an admin publishes it, so its routes must never land in the
// service-worker precache: that cache is shared by every visitor to the browser
// profile and would serve the game's page and files to the public, offline.
//
// Scoped to the `games` array literal so a `slug:` or `staged: true` mentioned in
// a docblock elsewhere in the file cannot add a slug or hide a real one. Each
// entry is the text from its `slug:` to the next entry's `slug:` (or the closing
// `];`), which works because `slug` is the first field of every entry.

const ARRAY_START = /export const games:\s*Game\[\]\s*=\s*\[/;

export function publicStaticSlugs(gamesTs) {
  const start = ARRAY_START.exec(gamesTs);
  if (!start) return [];
  const from = start.index + start[0].length;
  const end = gamesTs.indexOf("\n];", from);
  const body = gamesTs.slice(from, end === -1 ? undefined : end);

  const matches = [...body.matchAll(/slug:\s*["']([^"']+)["']/g)];
  const slugs = [];
  matches.forEach((m, i) => {
    const entry = body.slice(m.index, matches[i + 1]?.index ?? body.length);
    if (/\bstaged:\s*true\b/.test(entry)) return;
    slugs.push(m[1]);
  });
  return slugs;
}
