"use server";

/**
 * HallPass dashboard — board management server actions.
 *
 * These are the WRITE half of the leaderboard admin UI; the matching read-only
 * server components live alongside in `boards/`. Both the create and the update
 * action funnel their raw form fields through the SAME `parseCreateBoardInput`
 * that the admin HTTP route (`app/api/v1/admin/boards`) uses, so the dashboard
 * and the API can never drift on what a valid board looks like.
 *
 * Two form→domain coercions are load-bearing and intentionally explicit here,
 * before validation:
 *   - `maxScore`  an empty input means "no cap" → `undefined` (absent), never
 *                 `Number("")` (which is `0`). A present value is `Number(...)`d
 *                 and re-checked by the validator (rejects negative / NaN).
 *   - `gameSlug`  the select's empty option ("") means STANDALONE → an explicit
 *                 `null`. We deliberately do not let it fall through as the
 *                 absent/empty case, which the validator would otherwise default
 *                 to "link to the same-named game". A real slug passes straight
 *                 to the validator, which confirms it names a known game.
 *
 * Every action fails closed: `requireRole("admin")` runs first and redirects an
 * unauthorised caller before any input is read or any row is written.
 *
 * Write hardening: every store write here is wrapped in a try/catch so a Neon
 * outage (or an unconfigured `DATABASE_URL`) bounces the admin back to the form
 * with `?error=...` instead of throwing a 500. The recovery `redirect` always
 * lives OUTSIDE the try — `redirect()` signals via a thrown control object, so a
 * catch-all would otherwise swallow it.
 *
 * The score-moderation actions (`deleteScoreAction`, `resetBoardAction`) follow
 * the same shape and are consumed by the board detail page's moderation panel.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { games } from "@/app/lib/games";
import { store } from "@/app/lib/scoreboard";
import {
  parseCreateBoardInput,
  type ParseBoardInputResult,
  type RawBoardInput,
} from "@/app/lib/scoreboard/board-input";

/** Games-list membership test injected into the shared board validator. */
const isKnownGame = (s: string): boolean => games.some((g) => g.slug === s);

/**
 * Lift a submitted `FormData` into the validator's `RawBoardInput` shape and run
 * the shared normalisation. Applies the two form-specific coercions documented
 * at the top of the file; everything else (slug/title/sort/scoreLabel rules) is
 * left to `parseCreateBoardInput`.
 */
function parseBoardForm(
  formData: FormData,
  // A board may already be LINKED to a game that has since been removed from the
  // catalogue. When editing such a board we must still accept its existing link
  // so the row round-trips on save — otherwise the validator rejects it as an
  // "Unknown game" and the board becomes uneditable. `allowGameSlug` grandfathers
  // that one slug into the membership test.
  allowGameSlug?: string,
): ParseBoardInputResult {
  const maxScoreField = String(formData.get("maxScore") ?? "").trim();
  const gameSlugField = String(formData.get("gameSlug") ?? "");

  const raw: RawBoardInput = {
    slug: String(formData.get("slug") ?? ""),
    title: String(formData.get("title") ?? ""),
    sort: String(formData.get("sort") ?? ""),
    scoreLabel: String(formData.get("scoreLabel") ?? ""),
    // Empty → undefined (no cap), not Number("") === 0.
    maxScore: maxScoreField === "" ? undefined : Number(maxScoreField),
    // Empty select option → explicit standalone (null); a real slug stays put.
    gameSlug: gameSlugField === "" ? null : gameSlugField,
  };

  const known = (s: string): boolean =>
    isKnownGame(s) || (Boolean(allowGameSlug) && s === allowGameSlug);
  return parseCreateBoardInput(raw, { isKnownGame: known });
}

/**
 * Create a board from the "new board" form. Unlike {@link updateBoardAction},
 * this is a strict CREATE: an id that already names a board is rejected with
 * `?error` rather than silently overwriting it (`store.createBoard` upserts on
 * id, so without this guard a duplicate id would clobber a live leaderboard's
 * config). A validation / exists / save failure bounces back with the message in
 * `?error`; on success we revalidate the list and land on the new board's detail.
 *
 * An optional hidden `returnTo` field lets a caller (e.g. the game control
 * center) steer both the error and success redirects back to its own page. It is
 * only honoured when it is a safe same-origin path — a single leading "/" — so a
 * crafted value can never be coerced into an off-site redirect; anything else
 * falls back to the `/dashboard/boards/new` form.
 */
export async function createBoardAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  // Caller-supplied return path, kept only when it is a safe same-origin path:
  // starts with a single "/" (not "//", which a browser reads as a protocol-
  // relative off-site URL). The error redirects fall back to the new-board form.
  const returnTo = String(formData.get("returnTo") ?? "");
  const safeReturn =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "";
  const errorBase = safeReturn || "/dashboard/boards/new";

  const parsed = parseBoardForm(formData);
  if (!parsed.ok) {
    redirect(`${errorBase}?error=${encodeURIComponent(parsed.error.message)}`);
  }

  // Strict CREATE: refuse an id that already exists so the upsert below cannot
  // silently overwrite that board's config (updateBoardAction is the edit path).
  if (await store.boardExists(parsed.value.slug)) {
    redirect(
      `${errorBase}?error=${encodeURIComponent("A board with that id already exists")}`,
    );
  }

  // A write failure (Neon down / unconfigured) must not 500 the action: flag it
  // inside the try and bounce OUTSIDE, mirroring the validation redirect above.
  let saveFailed = false;
  try {
    await store.createBoard(parsed.value);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) {
    redirect(`${errorBase}?error=${encodeURIComponent("Could not save board")}`);
  }

  revalidatePath("/dashboard/boards");
  redirect(safeReturn || `/dashboard/boards/${parsed.value.slug}`);
}

/**
 * Update an existing board from its detail-page edit form. The board id is NOT
 * editable, so it arrives via a hidden `slug` field; `store.createBoard` upserts
 * on that id. On error we return to the same detail page with `?error`; on
 * success we revalidate both the list and the detail route and reload the
 * detail page.
 */
export async function updateBoardAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  // Accept the board's existing (possibly now-removed) game link so it survives
  // the save rather than being rejected as unknown — see parseBoardForm.
  const originalGameSlug = String(formData.get("originalGameSlug") ?? "").trim();
  const parsed = parseBoardForm(formData, originalGameSlug || undefined);
  if (!parsed.ok) {
    redirect(
      `/dashboard/boards/${encodeURIComponent(slug)}?error=${encodeURIComponent(parsed.error.message)}`,
    );
  }

  // As in createBoardAction: a write failure flips a flag, and the recovery
  // redirect lives OUTSIDE the try so its thrown control signal is never caught.
  let saveFailed = false;
  try {
    await store.createBoard(parsed.value);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) {
    redirect(
      `/dashboard/boards/${encodeURIComponent(parsed.value.slug)}?error=${encodeURIComponent("Could not save board")}`,
    );
  }

  revalidatePath("/dashboard/boards");
  revalidatePath(`/dashboard/boards/${parsed.value.slug}`);
  redirect(`/dashboard/boards/${parsed.value.slug}`);
}

/**
 * Link a standalone board to a game from the game control center. Both ids ride
 * in as hidden fields; the target `gameSlug` is first checked against the
 * catalogue (an unknown game bounces to the games index), then `setBoardGame`
 * points the board at it (and bumps `updated_at`). A write failure or an unknown
 * board bounces back to the game page with `?error`; success lands there with
 * `?ok`. The recovery/success redirects sit OUTSIDE the try, as `redirect()`
 * signals via a thrown control object a catch-all would swallow.
 */
export async function linkBoardAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const boardId = String(formData.get("boardId") ?? "").trim();
  const gameSlug = String(formData.get("gameSlug") ?? "").trim();
  if (!boardId || !gameSlug) {
    redirect(
      `/dashboard/games/${encodeURIComponent(gameSlug)}?error=${encodeURIComponent("Pick a board to link")}`,
    );
  }

  // Reject a target that doesn't name a real game, so a typo or stale form can't
  // point a board at a slug with no game behind it (mirrors parseBoardForm).
  if (!isKnownGame(gameSlug)) redirect("/dashboard/games?error=Unknown+game");

  let linkFailed = false;
  try {
    const linked = await store.setBoardGame(boardId, gameSlug);
    if (!linked) linkFailed = true;
  } catch {
    linkFailed = true;
  }
  if (linkFailed) {
    redirect(
      `/dashboard/games/${encodeURIComponent(gameSlug)}?error=${encodeURIComponent("Could not link board")}`,
    );
  }

  revalidatePath(`/dashboard/games/${gameSlug}`);
  revalidatePath("/dashboard/boards");
  redirect(
    `/dashboard/games/${encodeURIComponent(gameSlug)}?ok=${encodeURIComponent("Linked")}`,
  );
}

/**
 * Unlink a board from its game (clear `game_slug` to NULL), leaving the board and
 * its scores intact. `gameSlug` is optional and only steers the redirect target:
 * present → back to that game's control center, absent → the boards index. Same
 * try/catch + outside-redirect shape as {@link linkBoardAction}.
 */
export async function unlinkBoardAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const boardId = String(formData.get("boardId") ?? "").trim();
  const gameSlug = String(formData.get("gameSlug") ?? "").trim();
  const back = gameSlug
    ? `/dashboard/games/${encodeURIComponent(gameSlug)}`
    : "/dashboard/boards";
  if (!boardId) redirect(`${back}?error=${encodeURIComponent("Missing board id")}`);

  // setBoardGame returns false when no board matched (nothing was cleared);
  // surface that as a failure too, matching linkBoardAction.
  let unlinkFailed = false;
  try {
    const ok = await store.setBoardGame(boardId, null);
    if (!ok) unlinkFailed = true;
  } catch {
    unlinkFailed = true;
  }
  if (unlinkFailed) {
    redirect(`${back}?error=${encodeURIComponent("Could not unlink board")}`);
  }

  if (gameSlug) revalidatePath(`/dashboard/games/${gameSlug}`);
  revalidatePath("/dashboard/boards");
  redirect(`${back}?ok=${encodeURIComponent("Unlinked")}`);
}

/**
 * Delete a single score from a board's moderation table. The board id and the
 * row id ride in as hidden form fields; the row id is coerced and bounds-checked
 * (a non-finite id bounces back with `?error` before any query runs). The delete
 * is store-scoped to `boardId`, so a stray id can never touch another board.
 * Success revalidates the detail page and lands back on it with `?ok`.
 */
export async function deleteScoreAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const boardId = String(formData.get("boardId") ?? "");
  const scoreId = Number(formData.get("scoreId"));

  if (!Number.isFinite(scoreId)) {
    redirect(
      `/dashboard/boards/${encodeURIComponent(boardId)}?error=${encodeURIComponent("Invalid score id")}`,
    );
  }

  let deleteFailed = false;
  try {
    await store.deleteScore(boardId, scoreId);
  } catch {
    deleteFailed = true;
  }
  if (deleteFailed) {
    redirect(
      `/dashboard/boards/${encodeURIComponent(boardId)}?error=${encodeURIComponent("Could not remove score")}`,
    );
  }

  revalidatePath(`/dashboard/boards/${boardId}`);
  redirect(
    `/dashboard/boards/${encodeURIComponent(boardId)}?ok=${encodeURIComponent("Score removed")}`,
  );
}

/**
 * Wipe every score on a board (the "Reset board" control). The cleared count is
 * captured inside the try and surfaced in the success `?ok` message; a write
 * failure bounces back with `?error`, both via redirects placed OUTSIDE the try.
 */
export async function resetBoardAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const boardId = String(formData.get("boardId") ?? "");

  let cleared = 0;
  let resetFailed = false;
  try {
    cleared = await store.clearBoardScores(boardId);
  } catch {
    resetFailed = true;
  }
  if (resetFailed) {
    redirect(
      `/dashboard/boards/${encodeURIComponent(boardId)}?error=${encodeURIComponent("Could not clear scores")}`,
    );
  }

  revalidatePath(`/dashboard/boards/${boardId}`);
  redirect(
    `/dashboard/boards/${encodeURIComponent(boardId)}?ok=${encodeURIComponent(`Cleared ${cleared} scores`)}`,
  );
}

/**
 * Permanently delete a board and every score on it (scores cascade via the
 * `scores.board_id` FK). Guarded by a TYPED confirmation: the admin must re-type
 * the board id, so a stray click cannot wipe a leaderboard. A mismatch or a write
 * failure bounces back to the detail page with `?error`; success lands on the
 * boards index with an `?ok` banner. The redirects sit OUTSIDE the try.
 */
export async function deleteBoardAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const boardId = String(formData.get("boardId") ?? "").trim();
  if (!boardId) redirect("/dashboard/boards");

  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== boardId) {
    redirect(
      `/dashboard/boards/${encodeURIComponent(boardId)}?error=${encodeURIComponent("Type the board id exactly to confirm deletion")}`,
    );
  }

  let deleteFailed = false;
  try {
    await store.deleteBoard(boardId);
  } catch {
    deleteFailed = true;
  }
  if (deleteFailed) {
    redirect(
      `/dashboard/boards/${encodeURIComponent(boardId)}?error=${encodeURIComponent("Could not delete board")}`,
    );
  }

  revalidatePath("/dashboard/boards");
  redirect(
    `/dashboard/boards?ok=${encodeURIComponent(`Deleted leaderboard “${boardId}”`)}`,
  );
}
