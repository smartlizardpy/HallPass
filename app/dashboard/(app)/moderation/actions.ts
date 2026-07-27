"use server";

/**
 * HallPass dashboard — review-moderation server actions.
 *
 * The WRITE half of `/dashboard/moderation`; the server component that renders
 * the queue lives alongside in `page.tsx`. Every action here is a thin, boring
 * shell around one method on `createModerationStore` — the store owns the SQL,
 * the single-statement guarantee and the audit row, and nothing in this file may
 * quietly add a second write.
 *
 * House shape, copied deliberately from `games/actions.ts` and `users/actions.ts`
 * so all three read the same way:
 *
 *   1. `requireRole("admin")` FIRST, before a single form field is read. It fails
 *      closed (redirects) and re-resolves the live role, so a demoted admin loses
 *      these buttons on their very next request. It is also the only thing
 *      standing between a Server Action and the open internet: actions are
 *      reachable by direct POST, not just through the UI we render.
 *   2. Validate. A bad id becomes a banner, never a 500 and never an unguarded
 *      value reaching Postgres.
 *   3. A TIGHT `try` around the store call only.
 *   4. `redirect()` OUTSIDE that `try`. `redirect` works by THROWING a control
 *      signal; a `catch` that wraps it swallows the navigation and the action
 *      silently does nothing. This repo has been bitten by that before — see the
 *      note at the top of `games/actions.ts`.
 *   5. `revalidatePath("/dashboard/moderation")` before the success redirect, so
 *      the queue the admin lands back on is the post-action queue rather than the
 *      cached pre-action one.
 *
 * ACTOR EMAIL. Every store method takes `actorEmail`, and it comes from
 * `requireRole()`'s return value — the session's `dashboard_users` address —
 * never from a form field. A hidden input would be an audit log an attacker can
 * write anyone's name into, which is worse than no audit log at all because it
 * looks trustworthy. (That address is a colleague's work account and is safe to
 * render; the prohibition in `page.tsx` is on `players.email`, a child's school
 * address. See the module docblock in `app/lib/reviews/moderation.ts`.)
 *
 * TWO ID SPACES. Forms carry the author's `public_id` — a random UUID — because
 * that is the only id the queue is allowed to hand to a browser. `ban`/`unban`/
 * `dismissAllFromReporter` are keyed on the INTERNAL `players.id` (the Google
 * subject id), so those actions resolve the public id server-side through
 * `internalIdFromPublicId()` first. That resolution is the one sanctioned
 * crossing between the two spaces; nothing else in this file may do it.
 *
 * The store is instantiated once at module scope. The house pattern is to bind a
 * store to the shared `sql` in a `server-only` barrel (`reviews/index.ts` does it
 * for `createReviewStore`), and this belongs there eventually — but the barrel is
 * not this surface's to edit, and `createModerationStore` is a bag of closures
 * over `sql`, so a second binding costs nothing but a pointer.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { sql } from "@/app/lib/db";
import {
  createModerationStore,
  type ReviewActionResult,
} from "@/app/lib/reviews/moderation";

const moderation = createModerationStore(sql);

/** Where every action lands; centralised so the path cannot drift from `page.tsx`. */
const MODERATION_PATH = "/dashboard/moderation";

/**
 * Cap on a free-text moderator note. `review_bans.reason` and
 * `review_moderation_log.reason` are unbounded TEXT, so this is not a schema
 * requirement — it is a log-readability one. The audit trail is a table an admin
 * skims; a pasted essay in one cell makes the other forty rows unreadable.
 */
const MAX_REASON_CHARS = 300;

/**
 * Redirect back to the queue carrying a banner message. Returns `never`, so a
 * call to it terminates the action — and so TypeScript knows the code after one
 * is unreachable.
 */
function back(kind: "ok" | "error", message: string): never {
  redirect(`${MODERATION_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Read a BIGINT primary key out of the form.
 *
 * Returns `null` for anything that is not a positive whole number, which the
 * callers turn into a banner. Binding an unvalidated string would let a mangled
 * form take out the statement with a 22P02 (invalid input syntax) 500 instead —
 * loud, but useless to the admin looking at it.
 */
function readId(formData: FormData, field: string): number | null {
  const raw = String(formData.get(field) ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A trimmed, capped moderator note, or `null` when the field was left blank. */
function readReason(formData: FormData): string | null {
  const raw = String(formData.get("reason") ?? "").trim();
  if (!raw) return null;
  return raw.slice(0, MAX_REASON_CHARS);
}

/** "1 report" / "3 reports" — used in every success banner. */
function reports(n: number): string {
  return `${n} report${n === 1 ? "" : "s"}`;
}

/**
 * Run one review-scoped store call and turn its three-field result into a
 * banner, so the six near-identical actions below do not each re-derive the
 * same outcome table.
 *
 * `found: false` is an ERROR rather than a success: the review is gone (someone
 * else purged it, or the author's account cascaded), the admin's click did
 * nothing, and telling them "done" would be a lie. `changed: false` is NOT an
 * error — it is the common case where auto-hide already moved the status and the
 * moderator is confirming it; the reports still got closed, which is the work.
 *
 * The store call is the only fallible step and is the only thing inside the try.
 * Both `back()` calls sit outside it — see the docblock on `redirect()`.
 */
async function applyReviewAction(
  reviewId: number,
  verb: string,
  done: string,
  run: () => Promise<ReviewActionResult>,
): Promise<never> {
  let result: ReviewActionResult | null = null;
  try {
    result = await run();
  } catch (error) {
    // Logged rather than swallowed: an admin surface degrading to a banner is
    // right for the human, but a Neon outage must still be visible to whoever
    // reads the logs.
    console.error(`[moderation] ${verb} #${reviewId} failed`, error);
  }

  if (!result) back("error", `Could not ${verb} review #${reviewId} (database error).`);
  if (!result.found) {
    back("error", `Review #${reviewId} no longer exists — the queue was stale.`);
  }

  revalidatePath(MODERATION_PATH);
  const closed =
    result.reportsClosed > 0 ? `, closed ${reports(result.reportsClosed)}` : "";
  back(
    "ok",
    result.changed
      ? `Review #${reviewId} ${done}${closed}.`
      : `Review #${reviewId} was already ${done}${closed}.`,
  );
}

/**
 * Resolve the `playerPublicId` form field to the internal `players.id` the ban
 * tables are keyed on, or bail out with a banner.
 *
 * Separated from its callers so the crossing between the two id spaces happens
 * in exactly one place and can be audited by reading one function.
 */
async function resolveInternalId(formData: FormData): Promise<string> {
  const publicId = String(formData.get("playerPublicId") ?? "").trim();
  if (!publicId) back("error", "No player was selected.");

  let internalId: string | null = null;
  let failed = false;
  try {
    internalId = await moderation.internalIdFromPublicId(publicId);
  } catch (error) {
    console.error("[moderation] player lookup failed", error);
    failed = true;
  }
  if (failed) back("error", "Could not look up that player (database error).");
  // A clean null is a real answer, not a failure: the account was deleted
  // between the queue render and this click.
  if (!internalId) back("error", "That player no longer exists.");
  return internalId;
}

/* ------------------------------------------------------------------ reviews */

/** Take a review down, reversibly. The default moderator verb. */
export async function hideReviewAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const reviewId = readId(formData, "reviewId");
  if (reviewId === null) back("error", "That review id was not valid.");
  const reason = readReason(formData);

  await applyReviewAction(reviewId, "hide", "hidden", () =>
    moderation.hide(reviewId, actor, reason),
  );
}

/**
 * Put a review back — and clear the auto-hide counter with it (the store resets
 * `report_count`, which is why one later report cannot instantly re-hide what a
 * human just cleared).
 */
export async function unhideReviewAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const reviewId = readId(formData, "reviewId");
  if (reviewId === null) back("error", "That review id was not valid.");

  await applyReviewAction(reviewId, "unhide", "unhidden", () =>
    moderation.unhide(reviewId, actor),
  );
}

/**
 * Tombstone a review: the text stays in the row, the public site stops showing
 * it. No confirm step, unlike purge — nothing is destroyed, so the worst case is
 * a row a super admin can restore by hand.
 */
export async function deleteReviewAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const reviewId = readId(formData, "reviewId");
  if (reviewId === null) back("error", "That review id was not valid.");
  const reason = readReason(formData);

  await applyReviewAction(reviewId, "delete", "deleted", () =>
    moderation.softDelete(reviewId, actor, reason),
  );
}

/**
 * Destroy a review outright. Reserved for content that must not persist —
 * on a site for children that mostly means a phone number, an address, or
 * another pupil's real name.
 *
 * The `confirm` field is written only by the second step of the disclosure in
 * `page.tsx`. It is NOT a security control (an admin can POST whatever they
 * like, and they are already authorised to purge); it is a wiring check — if the
 * two-step UI is ever refactored into a single button by accident, this rejects
 * the request instead of silently destroying a row.
 */
export async function purgeReviewAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  if (formData.get("confirm") !== "purge") {
    back("error", "Purge was not confirmed.");
  }
  const reviewId = readId(formData, "reviewId");
  if (reviewId === null) back("error", "That review id was not valid.");
  const reason = readReason(formData);

  await applyReviewAction(reviewId, "purge", "purged", () =>
    moderation.purge(reviewId, actor, reason),
  );
}

/* ------------------------------------------------------------------ reports */

/**
 * "Looked at it, nothing wrong" — resolve ONE report without touching the
 * review. `dismissed`, not `actioned`: the schema draws that distinction so a
 * serial false-reporter is findable later.
 */
export async function dismissReportAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const reportId = readId(formData, "reportId");
  if (reportId === null) back("error", "That report id was not valid.");

  let dismissed: boolean | null = null;
  try {
    dismissed = await moderation.dismissReport(reportId, actor);
  } catch (error) {
    console.error(`[moderation] dismiss report #${reportId} failed`, error);
  }

  if (dismissed === null) {
    back("error", `Could not dismiss report #${reportId} (database error).`);
  }
  revalidatePath(MODERATION_PATH);
  back(
    "ok",
    dismissed
      ? `Dismissed report #${reportId}.`
      : `Report #${reportId} was already resolved.`,
  );
}

/**
 * Dismiss every open report from one reporter — the answer to a pupil who has
 * discovered the report button and flagged half the site. One decision, one log
 * row, however many reports it clears.
 */
export async function dismissReporterAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const reporterId = await resolveInternalId(formData);

  let dismissed: number | null = null;
  try {
    dismissed = await moderation.dismissAllFromReporter(reporterId, actor);
  } catch (error) {
    console.error("[moderation] bulk dismiss failed", error);
  }

  if (dismissed === null) {
    back("error", "Could not dismiss that reporter's reports (database error).");
  }
  revalidatePath(MODERATION_PATH);
  back(
    "ok",
    dismissed > 0
      ? `Dismissed ${reports(dismissed)} from that reporter.`
      : "That reporter had no open reports left.",
  );
}

/* --------------------------------------------------------------------- bans */

/**
 * Ban a player from writing reviews.
 *
 * EXPIRY is a `<input type="date">`, read as END OF THAT DAY IN UTC. The obvious
 * choice — `datetime-local` — submits a wall-clock string with NO offset
 * ("2026-07-27T15:30"), which `new Date()` would then interpret in the SERVER's
 * zone (UTC on Vercel), so a UK admin picking 3:30pm in summer would silently get
 * a ban ending at 4:30pm their time. A ban length is a coarse decision — "a
 * week", "until the end of term" — so a date plus a stated end-of-day rule is
 * both unambiguous and closer to what the admin actually meant. Blank stays
 * permanent, per the migration's `NULL = permanent`.
 *
 * A past expiry is rejected rather than written: the ban row would exist, look
 * like a ban in every list, and gate nothing.
 *
 * `hideBacklog` is opt-in and arrives UNCHECKED — see the checkbox's own comment
 * in `page.tsx` and the store's `ban()` docblock for why that default is the real
 * policy decision here.
 */
export async function banAuthorAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  if (formData.get("confirm") !== "ban") back("error", "Ban was not confirmed.");

  const reason = readReason(formData);
  const hideBacklog = formData.get("hideBacklog") === "1";

  let expiresAt: Date | null = null;
  const rawExpiry = String(formData.get("expiresAt") ?? "").trim();
  if (rawExpiry) {
    // `T23:59:59Z` pins the instant explicitly — see the docblock.
    const parsed = new Date(`${rawExpiry}T23:59:59Z`);
    if (Number.isNaN(parsed.getTime())) {
      back("error", "That ban expiry was not a valid date.");
    }
    if (parsed.getTime() <= Date.now()) {
      back("error", "A ban expiry has to be in the future.");
    }
    expiresAt = parsed;
  }

  const playerId = await resolveInternalId(formData);

  let result: Awaited<ReturnType<typeof moderation.ban>> | null = null;
  try {
    result = await moderation.ban(playerId, actor, {
      reason,
      expiresAt,
      hideBacklog,
    });
  } catch (error) {
    console.error("[moderation] ban failed", error);
  }

  if (!result) back("error", "Could not ban that player (database error).");
  if (!result.banned) back("error", "The ban was not written. Try again.");

  revalidatePath(MODERATION_PATH);
  const scope = expiresAt
    ? `until ${expiresAt.toISOString().slice(0, 10)}`
    : "permanently";
  const backlog =
    result.backlogHidden > 0
      ? ` and hid ${result.backlogHidden} existing review${result.backlogHidden === 1 ? "" : "s"}`
      : "";
  back("ok", `Banned that player from reviews ${scope}${backlog}.`);
}

/**
 * Lift a ban. Reviews hidden by `hideBacklog` are deliberately NOT restored —
 * "you may write again" is a different statement from "everything you wrote was
 * fine", and conflating them would republish content a moderator hid. Restoring
 * one is Unhide, one at a time, on purpose.
 */
export async function unbanAuthorAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const playerId = await resolveInternalId(formData);

  let lifted: boolean | null = null;
  try {
    lifted = await moderation.unban(playerId, actor);
  } catch (error) {
    console.error("[moderation] unban failed", error);
  }

  if (lifted === null) back("error", "Could not lift that ban (database error).");
  revalidatePath(MODERATION_PATH);
  back(
    "ok",
    lifted
      ? "Lifted that player's review ban."
      : "That player was not banned (it may have already expired).",
  );
}

/* ------------------------------------------------------------------ nav badge */

/**
 * How many reports are outstanding — the number on the sidebar's Moderation
 * link.
 *
 * A Server FUNCTION used for a read, which is unusual enough to justify. The
 * badge has to be live from every dashboard screen, and the nav is a client
 * component rendered by the `(app)` layout, which this surface does not own and
 * therefore cannot ask to fetch a count server-side. The alternatives were a
 * public route handler (a new endpoint to authorise) or a dead prop nothing
 * passes. This is one `count(*)` served entirely by `review_reports_open_idx`,
 * and — per the Next.js docs on Server Functions — invoking one does not
 * re-render the calling page, so it costs a POST and nothing else.
 *
 * `requireRole` still runs: a Server Function is reachable by direct POST, and
 * "how big is your moderation backlog" is not public information.
 *
 * A failure degrades to 0 (no badge) rather than throwing into the layout and
 * blanking the whole dashboard. It is logged, because a badge that silently
 * reads zero forever is exactly the sort of quiet breakage nobody notices; the
 * page itself always shows the authoritative count.
 */
export async function openReportCountAction(): Promise<number> {
  await requireRole("admin");
  try {
    return await moderation.openReportCount();
  } catch (error) {
    console.error("[moderation] open report count failed", error);
    return 0;
  }
}
