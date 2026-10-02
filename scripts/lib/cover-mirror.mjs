// Which chosen covers the deploy should write to `public/games/<slug>/cover.png`.
//
// WHY. A game's cover is a database pointer (`game_overrides.cover_url` →
// a `/game-media/...` row), and every in-app surface follows it with no deploy.
// One reader does not: the share-card renderer (`app/lib/og/brand.tsx`) reads
// `public/games/<slug>/cover.png` from disk, because a link preview must not
// depend on a second network hop. So at deploy time `sync-games.mjs` copies the
// chosen cover over that file in the CI working tree. NOTHING is committed to
// Git: the checkout is thrown away after the build, and the repo's own
// `cover.png` stays the "original cover" that "restore original" falls back to.
//
// A plain-Node module (an .mjs script cannot import the TS app) tested from
// `app/lib/cover-mirror.test.ts`, like `staged.mjs` beside it.
//
// THE RULES, each fail-closed:
//   - STAGED games are never mirrored — `public/games/` is public static, so a
//     staged game's art there would be visible to anyone who guesses the path.
//   - PNG ONLY. The file is named `.png` and `coverDataUri` labels it
//     `image/png`; a JPEG/WebP cover keeps working in the app and simply leaves
//     the share card on the repo's art. Checked on the declared type here AND
//     on the downloaded bytes (`isPng`) in the caller.
//   - Only slugs `decideSlug` would mirror (a directory exists, or the slug is
//     in games.ts) — never create a directory for an unknown slug.
//   - If the database could not be read, mirror nothing.

import { decideSlug } from "./staged.mjs";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Whether `bytes` start with the PNG signature.
 *
 * @param {Uint8Array} bytes
 */
export function isPng(bytes) {
  return bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Read every cover pointer that targets a media row of the same game.
 * `rows` is `null` when the query fails (missing table, bad URL, network).
 *
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>} sql
 * @returns {Promise<{
 *   rows: { slug: string, blob_url: string | null, content_type: string }[] | null,
 *   error: string | null,
 * }>}
 */
export async function fetchCoverRows(sql) {
  try {
    const rows = await sql`
      SELECT o.slug, m.blob_url, m.content_type
      FROM game_overrides o
      JOIN game_media m ON m.slug = o.slug AND o.cover_url = '/' || m.blob_path
      WHERE o.cover_url IS NOT NULL
    `;
    return { rows, error: null };
  } catch (err) {
    return { rows: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Decide which covers to write.
 *
 * @param {object} input
 * @param {{ slug: string, blob_url: string | null, content_type: string }[] | null} input.coverRows
 * @param {Set<string>} input.staged
 * @param {Set<string> | null} input.registered null when the staging read failed
 * @param {(slug: string) => boolean} input.hasLocalDir
 * @returns {{
 *   mirror: { slug: string, url: string }[],
 *   skipped: { slug: string, reason: string }[],
 * }}
 */
export function planCoverMirror({ coverRows, staged, registered, hasLocalDir }) {
  const mirror = [];
  const skipped = [];
  if (coverRows === null || registered === null) {
    return { mirror, skipped };
  }
  const seen = new Set();
  for (const row of coverRows) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    const decision = decideSlug({
      slug: row.slug,
      hasLocalDir: hasLocalDir(row.slug),
      staged,
      registered,
    });
    if (decision === "skip-staged") {
      skipped.push({ slug: row.slug, reason: "staged: beta-only, never mirrored" });
    } else if (decision === "skip-no-dir") {
      skipped.push({ slug: row.slug, reason: "no local directory and not in games.ts" });
    } else if (row.content_type !== "image/png") {
      skipped.push({ slug: row.slug, reason: `${row.content_type} cover, PNG only` });
    } else if (!row.blob_url) {
      skipped.push({ slug: row.slug, reason: "media row has no blob URL" });
    } else {
      mirror.push({ slug: row.slug, url: row.blob_url });
    }
  }
  return { mirror, skipped };
}
