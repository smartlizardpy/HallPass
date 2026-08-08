"use server";

/**
 * HallPass dashboard — project tracker server actions.
 *
 * SERVER ACTIONS, NOT ROUTE HANDLERS, and that is a convention call worth
 * restating. `app/api/v1/games/[slug]/reviews/route.ts` sets out the split: a
 * route handler is for a PLAYER write by someone with no role, while every admin
 * write in this codebase is a `requireRole`-gated server action. The tracker is
 * entirely admin writes, so it belongs with curation and moderation.
 *
 * Control flow mirrors `curation/actions.ts` exactly, and each step is there for
 * a reason:
 *   1. `requireRole("admin")` FIRST, so the action fails closed even though the
 *      form that posts to it only renders on a gated page. The Next.js forms
 *      guide is explicit that a Server Action is its own entry point and must
 *      re-check authorization itself.
 *   2. Validate and narrow every field. `FormData` is attacker-editable even on
 *      an admin-only page, and a status that reaches the CHECK constraint
 *      unnarrowed is a 500 rather than a banner.
 *   3. The single fallible store call inside a try/catch, with the `redirect()`
 *      OUTSIDE it — `redirect()` reports via a thrown control signal, and a
 *      catch-all around it would swallow the navigation and report a false
 *      failure.
 *   4. `revalidatePath()` the surfaces that render the change, then land on
 *      `?ok=` / `?error=`.
 *
 * No `updateTag()` anywhere: nothing here is read through `unstable_cache`, so
 * there is no tag to expire. And emphatically no `bumpGamesVersion()` — that
 * sentinel makes every online client re-fetch every `/game-html/` URL, i.e. the
 * whole game corpus re-downloaded because somebody moved a card.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { tracker } from "@/app/lib/tracker";
import {
  BRIEF_MAX,
  TITLE_MAX,
  UPDATE_BODY_MAX,
  parseTags,
  toStatus,
} from "@/app/lib/tracker/config";

const BOARD = "/dashboard/tracker";

/** Build an `?ok`/`?error` redirect target back to a tracker surface. */
function target(path: string, key: "ok" | "error", message: string): string {
  return `${path}?${key}=${encodeURIComponent(message)}`;
}

/** The item detail path. */
function itemPath(id: number): string {
  return `${BOARD}/${id}`;
}

/**
 * Narrow an id posted as a hidden field. Anything that is not a positive
 * integer is refused before it reaches a bound parameter.
 */
function toId(value: unknown): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Revalidate the board and, when known, the item detail page. */
function revalidateTracker(id?: number): void {
  revalidatePath(BOARD);
  if (id) revalidatePath(itemPath(id));
}

/**
 * Paste a new item in.
 *
 * The title is required; the brief and tags are not, because the composer has to
 * accept a half-formed thought at the moment somebody has it. Unusable tag
 * fragments are dropped by `parseTags` rather than failing the submit — losing a
 * stray "!!!" must never cost somebody the spec they just pasted.
 *
 * On success it redirects to the NEW ITEM, not back to the board: whoever just
 * wrote a brief wants to see it, and it puts the "add an update" box one scroll
 * away.
 */
export async function createItemAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("admin");

  const title = String(formData.get("title") ?? "").trim().slice(0, TITLE_MAX);
  const brief = String(formData.get("brief") ?? "").slice(0, BRIEF_MAX);
  const tags = parseTags(String(formData.get("tags") ?? ""));

  if (!title) {
    redirect(target(`${BOARD}/new`, "error", "Give it a title."));
  }

  let id: number | null = null;
  let saveFailed = false;
  try {
    id = await tracker.createItem({ title, brief, tags, actor: email });
  } catch (error) {
    console.error("[tracker] createItem failed:", error);
    saveFailed = true;
  }
  if (saveFailed || id === null) {
    redirect(target(`${BOARD}/new`, "error", "Could not save that. Try again."));
  }

  revalidateTracker(id);
  redirect(target(itemPath(id), "ok", "Added"));
}

/**
 * Move an item to another lane.
 *
 * Re-selecting the lane it is already in is reported as success, not as an
 * error: the store treats it as a no-op, and a double-submitted form should not
 * look like a failure.
 */
export async function setStatusAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("admin");

  const id = toId(formData.get("id"));
  const status = toStatus(String(formData.get("status") ?? ""));
  const back = formData.get("back") === "board" ? BOARD : id ? itemPath(id) : BOARD;

  if (!id || !status) redirect(target(BOARD, "error", "Unknown item or status."));

  let result: Awaited<ReturnType<typeof tracker.setStatus>> = null;
  let saveFailed = false;
  try {
    result = await tracker.setStatus(id, status, email);
  } catch (error) {
    console.error("[tracker] setStatus failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(back, "error", "Could not move that item."));
  if (result === null) redirect(target(BOARD, "error", "That item is gone."));

  revalidateTracker(id);
  redirect(target(back, "ok", result.changed ? "Moved" : "Already there"));
}

/** Rewrite an item's title and brief. */
export async function editItemAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("admin");

  const id = toId(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim().slice(0, TITLE_MAX);
  const brief = String(formData.get("brief") ?? "").slice(0, BRIEF_MAX);

  if (!id) redirect(target(BOARD, "error", "Unknown item."));
  if (!title) redirect(target(itemPath(id), "error", "A title is required."));

  let ok = false;
  let saveFailed = false;
  try {
    ok = await tracker.editItem(id, { title, brief }, email);
  } catch (error) {
    console.error("[tracker] editItem failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(itemPath(id), "error", "Could not save."));
  if (!ok) redirect(target(BOARD, "error", "That item is gone."));

  revalidateTracker(id);
  redirect(target(itemPath(id), "ok", "Saved"));
}

/** Converge an item's tags to exactly what the field says. */
export async function setTagsAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("admin");

  const id = toId(formData.get("id"));
  const tags = parseTags(String(formData.get("tags") ?? ""));
  if (!id) redirect(target(BOARD, "error", "Unknown item."));

  let ok = false;
  let saveFailed = false;
  try {
    ok = await tracker.setTags(id, tags, email);
  } catch (error) {
    console.error("[tracker] setTags failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(itemPath(id), "error", "Could not save tags."));
  if (!ok) redirect(target(BOARD, "error", "That item is gone."));

  revalidateTracker(id);
  redirect(target(itemPath(id), "ok", "Tags updated"));
}

/** Add a dated progress note. */
export async function addUpdateAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("admin");

  const id = toId(formData.get("id"));
  const body = String(formData.get("body") ?? "").trim().slice(0, UPDATE_BODY_MAX);

  if (!id) redirect(target(BOARD, "error", "Unknown item."));
  if (!body) redirect(target(itemPath(id), "error", "Write something first."));

  let newId: number | null = null;
  let saveFailed = false;
  try {
    newId = await tracker.addUpdate(id, body, email);
  } catch (error) {
    console.error("[tracker] addUpdate failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(itemPath(id), "error", "Could not post that."));
  if (newId === null) redirect(target(BOARD, "error", "That item is gone."));

  revalidateTracker(id);
  redirect(target(itemPath(id), "ok", "Update posted"));
}

/**
 * Soft-delete an item.
 *
 * Archive rather than delete, so a mis-click is one click from being undone and
 * the activity trail is never orphaned. The confirmation is a `<details>`
 * disclosure on the page rather than `window.confirm()`, following the
 * moderation screen: a native dialog blocks the browser, cannot be styled, and
 * trains people to dismiss it reflexively.
 */
export async function archiveItemAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("admin");

  const id = toId(formData.get("id"));
  if (!id) redirect(target(BOARD, "error", "Unknown item."));

  let ok = false;
  let saveFailed = false;
  try {
    ok = await tracker.archiveItem(id, email);
  } catch (error) {
    console.error("[tracker] archiveItem failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(itemPath(id), "error", "Could not archive."));
  if (!ok) redirect(target(BOARD, "error", "That item is already gone."));

  revalidateTracker(id);
  redirect(target(BOARD, "ok", "Archived"));
}

/** Bring an archived item back. */
export async function restoreItemAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("admin");

  const id = toId(formData.get("id"));
  if (!id) redirect(target(BOARD, "error", "Unknown item."));

  let ok = false;
  let saveFailed = false;
  try {
    ok = await tracker.restoreItem(id, email);
  } catch (error) {
    console.error("[tracker] restoreItem failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(itemPath(id), "error", "Could not restore."));
  if (!ok) redirect(target(BOARD, "error", "That item is not archived."));

  revalidateTracker(id);
  redirect(target(itemPath(id), "ok", "Restored"));
}
