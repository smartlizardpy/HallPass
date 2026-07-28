/**
 * HallPass — who added each game.
 *
 * One row per game recording the person who first put it on the site, so a store
 * page can say "Added by Ateş" instead of leaving the footer's site-wide "Games
 * by Ateş Demir · Site by Ozan Kaygusuz" to stand in for per-game attribution.
 *
 * Shaped after `game-media.ts`, including the two rules that matter:
 *
 * FAIL-SOFT: the public store page must render when Neon is unreachable, so
 * {@link getGameCredit} returns `null` on any failure. The try/catch lives at the
 * CALL SITE rather than inside the cached primitive — `unstable_cache` only
 * stores fulfilled results, so a transient blip must REJECT there or the empty
 * map gets cached under the tag for the full TTL and every game loses its credit
 * line until something invalidates it.
 *
 * FIRST WRITER WINS, and that is enforced by the database rather than by this
 * module remembering to check. `slug` is the PRIMARY KEY and {@link recordFirstUpload}
 * is `ON CONFLICT DO NOTHING`, so re-uploading a game to fix a bug — much the
 * commonest write on this path — cannot re-attribute someone else's game to
 * whoever last touched it. {@link setCredit} is the one deliberate override, and
 * exists only because the games that predate this table have no row and nothing
 * to derive one from.
 *
 * `uploader_email` is stored for tracing and is NEVER rendered. The public
 * surface is `uploader_name` only.
 *
 * MUTATIONS ARE UNCACHED. After any of them the calling server action MUST
 * `revalidateTag(CREDITS_CACHE_TAG, { expire: 0 })` and
 * `revalidatePath("/game/<slug>")`. It must NOT call `bumpGamesVersion()` — that
 * sentinel makes every online client re-fetch every `/game-html/` URL with
 * `cache: "no-store"`, i.e. the entire game corpus re-downloaded because a credit
 * line changed. Same rule as media: this is page data, not a PWA concern.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";

/** Cache tag for {@link readAllCreditsCached}. */
export const CREDITS_CACHE_TAG = "game-credits";

/** The public projection. Deliberately has NO email field. */
export type GameCredit = {
  slug: string;
  /** Display name as it read on the day of the upload. */
  uploaderName: string;
  /** ISO timestamp of the first upload. */
  firstUploadedAt: string;
};

type Row = Record<string, unknown>;

function mapCredit(row: Row): GameCredit {
  const at = new Date(String(row.first_uploaded_at));
  return {
    slug: String(row.slug),
    uploaderName: String(row.uploader_name),
    firstUploadedAt: Number.isNaN(at.getTime())
      ? String(row.first_uploaded_at)
      : at.toISOString(),
  };
}

/**
 * Read EVERY credit in one query, grouped by slug in JS.
 *
 * Same reasoning as `readOverrides()` and `readAllMediaCached()`: at most one row
 * per game, read on every store-page render, and one cache entry under one tag is
 * far simpler to invalidate than N per-slug entries. A per-slug `unstable_cache`
 * would key on a runtime argument and create unbounded entries.
 *
 * The email column is NOT selected. Nothing downstream needs it, and not
 * selecting it is a stronger guarantee than not rendering it.
 *
 * THROWS on failure by design — see the fail-soft note in the module docblock.
 */
const readAllCreditsCached = unstable_cache(
  async (): Promise<GameCredit[]> => {
    const rows = await sql`
      SELECT slug, uploader_name, first_uploaded_at
      FROM game_credits
      ORDER BY slug ASC
    `;
    return rows.map(mapCredit);
  },
  ["game-credits"],
  { tags: [CREDITS_CACHE_TAG], revalidate: 3600 },
);

/** Every credit, keyed by slug. Fail-soft to an empty map. */
export async function getAllGameCredits(): Promise<Map<string, GameCredit>> {
  let all: GameCredit[];
  try {
    all = await readAllCreditsCached();
  } catch {
    return new Map();
  }
  const bySlug = new Map<string, GameCredit>();
  for (const credit of all) bySlug.set(credit.slug, credit);
  return bySlug;
}

/** One game's credit, or `null` when nobody has been recorded. Fail-soft. */
export async function getGameCredit(slug: string): Promise<GameCredit | null> {
  return (await getAllGameCredits()).get(slug) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations — uncached. Callers revalidate.
// ---------------------------------------------------------------------------

/**
 * Record who first uploaded a game. A no-op if anybody already holds the credit.
 *
 * Called from every path that puts playable content at a slug for the first time
 * — an HTML upload, a paste, a zip bundle, an external-game registration. All of
 * them are also the RE-upload path, which is exactly why this must not overwrite:
 * fixing a bug in your own game is the commonest write here, and fixing a bug in
 * someone else's would otherwise transfer the credit.
 *
 * Best-effort by design. It is called for its side effect from actions whose real
 * job is publishing a game, and a failure to record a credit line must never fail
 * the upload it decorates — so this swallows errors, exactly like
 * `bumpGamesVersion()` does for the same reason.
 *
 * The display name is snapshotted from `dashboard_users` at write time in the
 * SAME statement (one round trip, and no window in which the two disagree),
 * falling back to the local-part of the email when the admin has no name yet —
 * never to the email itself, which is not for publishing.
 */
export async function recordFirstUpload(
  slug: string,
  actorEmail: string,
): Promise<void> {
  try {
    await sql`
      INSERT INTO game_credits (slug, uploader_email, uploader_name)
      SELECT
        ${slug},
        ${actorEmail},
        COALESCE(
          NULLIF(btrim(u.name), ''),
          -- Local-part only. An admin who never set a display name still gets a
          -- readable credit without their address being published.
          split_part(${actorEmail}, '@', 1)
        )
      FROM (SELECT ${actorEmail} AS email) AS input
      LEFT JOIN dashboard_users u ON u.email = input.email
      ON CONFLICT (slug) DO NOTHING
    `;
  } catch {
    // Best effort — see the docblock. A missing credit is a cosmetic gap; a
    // failed upload is not.
  }
}

/**
 * Set or correct a game's credit by hand. OVERWRITES.
 *
 * The counterpart to {@link recordFirstUpload}, and the only path that may
 * replace an existing row. It exists because the games that predate this table
 * have no row and nothing to derive one from, so somebody has to be able to say
 * who added them; and because an automatic capture can be wrong (an admin
 * uploading on a colleague's behalf).
 *
 * `first_uploaded_at` is NOT touched on an update — the correction is to WHO, not
 * to WHEN, and clobbering the date would quietly rewrite the one part of the row
 * that was actually observed rather than asserted.
 */
export async function setCredit(
  slug: string,
  uploaderName: string,
  actorEmail: string,
): Promise<void> {
  await sql`
    INSERT INTO game_credits (slug, uploader_email, uploader_name)
    VALUES (${slug}, ${actorEmail}, ${uploaderName})
    ON CONFLICT (slug) DO UPDATE
      SET uploader_name = EXCLUDED.uploader_name,
          uploader_email = EXCLUDED.uploader_email,
          updated_at = now()
  `;
}

/** Remove a credit entirely, so the store page stops showing a line. */
export async function clearCredit(slug: string): Promise<void> {
  await sql`DELETE FROM game_credits WHERE slug = ${slug}`;
}
