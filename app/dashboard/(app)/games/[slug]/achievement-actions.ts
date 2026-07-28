"use server";

/**
 * HallPass dashboard — per-game ACHIEVEMENT PROVISIONING server actions.
 *
 * Its own file rather than growing `actions.ts`, exactly as `media-actions.ts`
 * is: these four actions own the `achievements` CATALOGUE for one game (the
 * admin-authored rows a game addresses by `key`), and nothing else.
 *
 * ── THEY MUST NOT CALL `bumpGamesVersion()` ─────────────────────────────────
 *
 * The same rule `media-actions.ts` opens with, and for the same reason. That
 * sentinel makes every online client re-fetch EVERY `/game-html/` URL with
 * `cache: "no-store"` — the entire ~11 MB game corpus re-downloaded because an
 * admin renamed a trophy. Achievements are PAGE DATA, identical in kind to
 * screenshots: they change what the store page says, never what the playable
 * bundle IS. So they ride on `revalidateTag` + `revalidatePath` like every other
 * dashboard edit, and a player on a metered school connection pays nothing.
 *
 * ── WHY THE SQL IS HERE AND NOT IN `app/lib/achievements/store.ts` ──────────
 *
 * That store is the RUNTIME surface: reads a game makes, and the one batched
 * write a player makes. Provisioning is a different consumer with a different
 * threat model — it is admin-only, it is the only thing allowed to mint a row,
 * and it is reached from exactly one screen. Putting it in the store would put
 * `INSERT INTO achievements` one import away from the public API route that
 * serves running games, and the whole design of this feature (see the migration
 * header) rests on a game being unable to mint achievements. Keeping the DDL-ish
 * writes in the admin surface keeps that boundary visible in the import graph.
 *
 * ── THE KEY IS IMMUTABLE ────────────────────────────────────────────────────
 *
 * `updateAchievementAction` has no `key` in its `SET` list, deliberately and
 * permanently. `key` is what a shipped game passes to `unlock("first-blood")`;
 * renaming it does not migrate anything, it simply makes every future unlock
 * from every already-published build resolve to nothing and return
 * `unknown-achievement` — a silent failure with no error, no log line on the
 * game's side, and no way for a player to notice beyond "I never get that one".
 * Deleting and re-creating is the honest way to change a key, and it is honest
 * precisely because it visibly destroys the unlock rows (ON DELETE CASCADE).
 *
 * ── HOUSE SHAPE ─────────────────────────────────────────────────────────────
 *
 *   1. `requireRole("admin")` FIRST, before a form field is read. Server Actions
 *      are reachable by direct POST; this is the only gate.
 *   2. Validate — every bound value is checked against the same bounds as the
 *      table's CHECK constraints, so a bad field is a banner rather than a 503.
 *   3. A TIGHT `try` around the query only.
 *   4. `redirect()` OUTSIDE that `try` — `redirect` signals by THROWING, and a
 *      catch-all around it swallows the navigation so the action silently does
 *      nothing.
 *   5. `revalidateTag(ACHIEVEMENTS_CACHE_TAG, { expire: 0 })` +
 *      `revalidatePath("/game/<slug>")`.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { sql } from "@/app/lib/db";
import { isResolvedSlug } from "@/app/lib/games-store";
import {
  MAX_ACHIEVEMENTS_PER_GAME,
  isAchievementKey,
} from "@/app/lib/achievements/config";

/**
 * Cache tag for achievement catalogue reads.
 *
 * NOT `export`ed, and that is a constraint of the file rather than a choice: a
 * `"use server"` module may only export async functions, so a shared literal
 * cannot live here. It is declared here anyway because this is the only module
 * that INVALIDATES it, and a bare string repeated at four call sites is exactly
 * how a tag quietly drifts from the read that registered it.
 *
 * Nothing registers this tag TODAY — the dashboard panel reads uncached (an
 * admin must see their own write immediately after the redirect) and the public
 * island reads through `/api/v1/games/<slug>/achievements`, whose freshness is
 * governed by its own 30-second `s-maxage`. The call is kept because the moment
 * a `use cache` read of the catalogue is added, forgetting to invalidate it
 * produces a store page that is stale for an hour with nothing on screen to
 * suggest why. `revalidatePath` below is what does the real work now.
 */
const ACHIEVEMENTS_CACHE_TAG = "game-achievements";

/**
 * Field bounds, mirrored BY HAND from the CHECK constraints in
 * `009_achievements.sql`. Kept in lockstep deliberately rather than derived: the
 * point of validating here is to turn a constraint violation (which surfaces as
 * a 503 the admin reads as "the dashboard is broken") into a sentence naming the
 * field they got wrong.
 */
const MAX_NAME = 60;
const MAX_DESCRIPTION = 200;
const MAX_ICON = 8;
const MAX_POINTS = 1000;
const MAX_TARGET = 1_000_000;

/** What the column defaults to, so an empty icon field is not an error. */
const DEFAULT_ICON = "🏅";

function gameUrl(slug: string, query: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${query}`;
}
const ok = (slug: string, msg: string) =>
  gameUrl(slug, `ok=${encodeURIComponent(msg)}`);
const err = (slug: string, msg: string) =>
  gameUrl(slug, `error=${encodeURIComponent(msg)}`);

/**
 * Invalidate the catalogue plus the one public route that renders it. Narrow on
 * purpose — an achievement edit changes a single game's store page, so there is
 * no reason to touch `/`, the sitemap or the LLM manifest.
 */
function revalidateAchievements(slug: string): void {
  // Two-arg `{ expire: 0 }` form. The single-arg call is deprecated in this
  // Next.js, and immediate expiry is what gives the admin read-your-own-writes.
  revalidateTag(ACHIEVEMENTS_CACHE_TAG, { expire: 0 });
  revalidatePath(`/game/${slug}`);
}

/**
 * Count CHARACTERS the way Postgres's `char_length` does, not UTF-16 code units.
 *
 * This is not pedantry, it is the difference between the form accepting a value
 * and the INSERT throwing. `"🏅".length` is 2 in JS and 1 to Postgres; a flag
 * emoji is 4 in JS and 2 to Postgres. Validating with `.length` would reject
 * icons the column happily stores, and — worse for the text fields — a name of
 * 60 emoji would pass a `char_length`-shaped check written with `.length`
 * nowhere near the truth. Spreading a string iterates code points, which is what
 * `char_length` counts.
 */
function charLength(value: string): number {
  return [...value].length;
}

/** Trim and collapse runs of whitespace — a name is a label, not prose. */
function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a bounded integer field, returning `null` for anything the column would
 * refuse. `Number("")` is `0`, so an empty field must be rejected BEFORE the
 * numeric coercion or a blank "Points" box would silently mean zero points.
 */
function boundedInt(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * The numeric row id from a form field.
 *
 * `id` is BIGINT, and the driver may hand it back as a string, so the panel
 * renders it as text and it arrives here as text. Anything that is not a plain
 * positive integer is refused rather than bound — a non-numeric value would make
 * Postgres raise 22P02 for the whole statement, which the admin would read as an
 * outage.
 */
function rowId(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Everything the create and edit forms share, already validated. */
type Fields = {
  name: string;
  description: string;
  icon: string;
  points: number;
  target: number;
  secret: boolean;
};

/**
 * Validate the shared fields, returning either the row values or the single
 * sentence to put in the banner. One function for both forms so the create path
 * and the edit path can never disagree about what is allowed.
 */
function readFields(formData: FormData): Fields | string {
  const name = oneLine(formData.get("name"));
  if (name === "") return "Give the achievement a name";
  if (charLength(name) > MAX_NAME) {
    return `That name is over ${MAX_NAME} characters`;
  }

  // NOT `oneLine` — a description may legitimately be a sentence, and collapsing
  // its whitespace is the right normalisation while flattening it to a single
  // line is not something the column asks for.
  const description = String(formData.get("description") ?? "").trim();
  if (charLength(description) > MAX_DESCRIPTION) {
    return `That description is over ${MAX_DESCRIPTION} characters`;
  }

  // An empty icon takes the column default rather than failing: the field is
  // decorative and an admin leaving it blank means "whatever you normally use".
  const icon = oneLine(formData.get("icon")) || DEFAULT_ICON;
  if (charLength(icon) > MAX_ICON) {
    return "Use a single emoji for the icon";
  }

  const points = boundedInt(formData.get("points"), 0, MAX_POINTS);
  if (points === null) return `Points must be a whole number, 0–${MAX_POINTS}`;

  const target = boundedInt(formData.get("target"), 1, MAX_TARGET);
  if (target === null) {
    return `Target must be a whole number, 1–${MAX_TARGET.toLocaleString()}`;
  }

  // An unchecked checkbox posts NOTHING, so presence is the whole test.
  const secret = formData.get("secret") != null;

  return { name, description, icon, points, target, secret };
}

/** Postgres INTEGER arrives as a JS number; be defensive about NULL/strings. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Provision one achievement for a game.
 *
 * ONE STATEMENT, and the cap is enforced INSIDE it. The obvious shape — count
 * the rows, then insert if there is room — is two `neon()` calls, which is two
 * stateless HTTP requests with no transaction spanning them and a real TOCTOU
 * window between: two admins (or one admin double-clicking a submit button) can
 * both read 199 and both insert. The count therefore lives in a CTE the INSERT
 * selects from, so "is there room" and "take the room" are the same snapshot.
 *
 * `next_position` is resolved the same way and for the same reason: derived
 * server-side from `max(position) + 1` rather than from what the rendered page
 * happened to show.
 *
 * `ON CONFLICT (slug, key) DO NOTHING` makes a duplicate key a no-op rather than
 * a 23505 the admin reads as a crash — the outer SELECT reports both counters so
 * the banner can tell "the game is full" apart from "that key is taken", which
 * are the only two ways an insert of a valid row can fail.
 */
export async function createAchievementAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=Unknown+game");
  // `isResolvedSlug`, NOT the static `games` array: an external game is exactly
  // the kind of game an admin provisions achievements for, and validating
  // against the static list is the bug that makes `favorites.ts` drop them.
  if (!(await isResolvedSlug(slug))) redirect("/dashboard/games?error=Unknown+game");

  const key = String(formData.get("key") ?? "")
    .trim()
    .toLowerCase();
  if (!isAchievementKey(key)) {
    redirect(
      err(
        slug,
        "Key must be lowercase letters, numbers, - or _, starting with a letter or number",
      ),
    );
  }

  const fields = readFields(formData);
  if (typeof fields === "string") redirect(err(slug, fields));

  let failed = false;
  let inserted = 0;
  let existing = 0;
  try {
    const rows = await sql`
      WITH existing AS (
        SELECT count(*)::int                       AS n,
               COALESCE(max(position) + 1, 0)::int AS next_position
        FROM achievements
        WHERE slug = ${slug}
      ),
      ins AS (
        INSERT INTO achievements
          (slug, key, name, description, icon, points, target, secret, position)
        SELECT ${slug}, ${key}, ${fields.name}, ${fields.description},
               ${fields.icon}, ${fields.points}::int, ${fields.target}::int,
               ${fields.secret}::boolean, e.next_position
        FROM existing e
        WHERE e.n < ${MAX_ACHIEVEMENTS_PER_GAME}
        ON CONFLICT (slug, key) DO NOTHING
        RETURNING id
      )
      SELECT e.n                             AS existing,
             (SELECT count(*) FROM ins)::int AS inserted
      FROM existing e
    `;
    existing = toInt((rows[0] ?? {}).existing);
    inserted = toInt((rows[0] ?? {}).inserted);
  } catch {
    failed = true;
  }

  if (failed) redirect(err(slug, "Could not add that achievement"));
  if (inserted === 0) {
    redirect(
      err(
        slug,
        existing >= MAX_ACHIEVEMENTS_PER_GAME
          ? `This game already has the maximum of ${MAX_ACHIEVEMENTS_PER_GAME} achievements`
          : `“${key}” is already used by another achievement in this game`,
      ),
    );
  }

  revalidateAchievements(slug);
  redirect(ok(slug, `Added “${fields.name}”`));
}

/**
 * Edit one achievement's presentation.
 *
 * THE `SET` LIST HAS NO `key`, ON PURPOSE — see the module docblock. The form
 * renders the key as a read-only field so the admin can copy it into the game's
 * source, and even a forged POST carrying `key=whatever` cannot rename anything,
 * because the value is never read here.
 *
 * Scoped by `slug` as well as `id`, matching `setMediaAlt`: the id alone would
 * find the row (it is the primary key), but then a forged id in one game's panel
 * could rewrite another game's achievement, and `RETURNING` lets the action say
 * "that achievement is no longer here" honestly instead of reporting a silent
 * no-op as a success.
 *
 * LOWERING `target` UNDER PLAYERS WHO ARE ALREADY PAST IT IS SAFE and needs no
 * backfill here: `store.ts` stamps `unlocked_at` from
 * `GREATEST(incoming, prev_progress) >= target`, so the next beacon from a
 * player who was already over the new target earns it. Their stored `progress`
 * legitimately exceeds `target` and the read path clamps it for display.
 */
export async function updateAchievementAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const id = rowId(formData.get("id"));
  if (!slug) redirect("/dashboard/games?error=Unknown+game");
  if (id === null) redirect(err(slug, "Unknown achievement"));

  const fields = readFields(formData);
  if (typeof fields === "string") redirect(err(slug, fields));

  let failed = false;
  let matched = false;
  try {
    const rows = await sql`
      UPDATE achievements
      SET name        = ${fields.name},
          description = ${fields.description},
          icon        = ${fields.icon},
          points      = ${fields.points}::int,
          target      = ${fields.target}::int,
          secret      = ${fields.secret}::boolean,
          updated_at  = now()
      WHERE id = ${id} AND slug = ${slug}
      RETURNING id
    `;
    matched = rows.length > 0;
  } catch {
    failed = true;
  }

  if (failed) redirect(err(slug, "Could not save that achievement"));
  if (!matched) redirect(err(slug, "That achievement is no longer here"));

  revalidateAchievements(slug);
  redirect(ok(slug, `Saved “${fields.name}”`));
}

/**
 * Delete one achievement — and, by CASCADE, every player's unlock of it.
 *
 * That cascade is the migration's deliberate choice (an orphaned unlock belongs
 * to nobody and is unreachable from any page), which makes this the one
 * genuinely destructive action in the panel: it revokes a trophy from every
 * player who earned it, with no tombstone and no undo. The UI says so; there is
 * nothing to add here beyond not pretending otherwise.
 */
export async function deleteAchievementAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const id = rowId(formData.get("id"));
  if (!slug) redirect("/dashboard/games?error=Unknown+game");
  if (id === null) redirect(err(slug, "Unknown achievement"));

  let failed = false;
  let removed: string | null = null;
  try {
    const rows = await sql`
      DELETE FROM achievements
      WHERE id = ${id} AND slug = ${slug}
      RETURNING key
    `;
    removed = rows.length > 0 ? String(rows[0].key) : null;
  } catch {
    failed = true;
  }

  if (failed) redirect(err(slug, "Could not delete that achievement"));
  if (removed === null) redirect(err(slug, "That achievement is no longer here"));

  revalidateAchievements(slug);
  redirect(ok(slug, `Deleted “${removed}” and every unlock of it`));
}

/**
 * Move one achievement one slot earlier or later.
 *
 * PER-ROW ↑/↓ SUBMIT BUTTONS, NOT A "SAVE THE WHOLE ORDER" FORM. This repo has
 * already shipped that bug once: hidden id fields render in the order the rows
 * are ALREADY in, so submitting them posts the existing sequence and the reorder
 * is a guaranteed no-op that looks like it worked. A move carries the only two
 * things a plain form can honestly express — WHICH row and WHICH direction — and
 * the server derives the new sequence itself. `media-actions.ts` documents the
 * same fix; this is that shape, not a variation on it.
 *
 * WHERE THIS DOES DIVERGE FROM MEDIA: media re-reads the current order in one
 * query and writes it back in a second. Here the whole thing is ONE statement.
 * The read-then-write is two stateless HTTP requests over `neon()` with no
 * transaction spanning them, so two admins clicking ↑ and ↓ at the same moment
 * can each compute a sequence from a list the other has already changed and
 * write a torn order. Collapsing it removes the window entirely:
 *
 *   ordered    — the live order, numbered 1..n by `row_number()`. Derived from
 *                `position` rather than trusted from the client, so a stale page
 *                cannot move the wrong row.
 *   move       — the moved row joined to its neighbour at `rn ± 1`. THE JOIN IS
 *                THE BOUNDS CHECK: at either end there is no neighbour, the CTE
 *                is empty, and everything downstream collapses to a no-op. No
 *                `LEAST`/`GREATEST` clamp that could quietly move the wrong row.
 *   renumbered — every row's new rank, with exactly the two swapped.
 *
 * The UPDATE rewrites EVERY row's position, not just the two. That looks like
 * more work than necessary and is the point: positions are only ever read as a
 * sort key, they are not guaranteed contiguous (a delete leaves a gap), and
 * writing only the pair would mean reasoning about whether the two new values
 * still interleave correctly with gaps around them. Renumbering to a canonical
 * 0..n-1 makes the invariant hold by construction after every single move. The
 * catalogue is capped at `MAX_ACHIEVEMENTS_PER_GAME` rows, so "every row" is
 * bounded and small.
 */
export async function moveAchievementAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const id = rowId(formData.get("id"));
  const direction = String(formData.get("direction") ?? "");
  if (!slug) redirect("/dashboard/games?error=Unknown+game");
  if (id === null) redirect(err(slug, "Unknown achievement"));
  if (direction !== "up" && direction !== "down") {
    redirect(err(slug, "Unknown move"));
  }

  // A VALUE, not a fragment — it is bound like any other parameter, so this is
  // not the `selectTopRows` two-templates case. The branch exists in JS only so
  // that nothing but ±1 can ever reach the query.
  const delta = direction === "up" ? -1 : 1;

  let failed = false;
  let moved = 0;
  try {
    const rows = await sql`
      WITH ordered AS (
        SELECT id,
               row_number() OVER (ORDER BY position ASC, id ASC)::int AS rn
        FROM achievements
        WHERE slug = ${slug}
      ),
      move AS (
        SELECT a.rn AS from_rn, b.rn AS to_rn
        FROM ordered a
        JOIN ordered b ON b.rn = a.rn + ${delta}::int
        WHERE a.id = ${id}
      ),
      renumbered AS (
        SELECT o.id,
               CASE o.rn
                 WHEN (SELECT from_rn FROM move) THEN (SELECT to_rn FROM move)
                 WHEN (SELECT to_rn FROM move)   THEN (SELECT from_rn FROM move)
                 ELSE o.rn
               END AS rn
        FROM ordered o
        WHERE EXISTS (SELECT 1 FROM move)
      ),
      upd AS (
        UPDATE achievements t
        SET position = r.rn - 1, updated_at = now()
        FROM renumbered r
        WHERE t.id = r.id AND t.slug = ${slug}
        RETURNING t.id
      )
      SELECT (SELECT count(*) FROM upd)::int AS moved
    `;
    moved = toInt((rows[0] ?? {}).moved);
  } catch {
    failed = true;
  }

  if (failed) redirect(err(slug, "Could not reorder"));

  // A no-op at either end. The buttons are disabled there, so reaching this only
  // happens from a stale page — which should not produce an error banner.
  if (moved > 0) revalidateAchievements(slug);
  redirect(ok(slug, moved > 0 ? "Order updated" : "Already in place"));
}
