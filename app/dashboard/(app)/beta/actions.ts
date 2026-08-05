"use server";

/**
 * HallPass dashboard — beta programme write actions (admin only).
 *
 * The WRITE half of `/dashboard/beta`; the read-only server component that
 * renders the roster and queues lives alongside in `page.tsx`.
 *
 * Every action follows the invariant sequence set by `users/actions.ts`:
 *   1. `requireRole("admin")` FIRST, before a single form field is read, so an
 *      unauthorised caller is redirected before anything is parsed or written.
 *   2. Validate and narrow from `unknown` — FormData values are user input, and
 *      an unchecked cast would let a malformed value reach a CHECK constraint
 *      and turn a typo into a raw 500 instead of a banner.
 *   3. Wrap ONLY the fallible store write in try/catch.
 *   4. `revalidatePath`, then `back()`.
 *
 * `redirect()` must stay OUTSIDE every try, because it signals by throwing and
 * a catch-all would swallow it — turning a successful action into a silent
 * no-op. This is the single most repeated mistake in this file's shape.
 *
 * XP IS COMPUTED HERE, NOT IN SQL. The rate card lives in `beta/config.ts` so
 * the tester's page and the payout cannot drift, which means the amount has to
 * be worked out in TypeScript and handed to the store. The store's write is
 * guarded on the report's pre-state and deduped by a partial unique index, so
 * the read-then-write that implies is still safe against a double submit.
 */

import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { beta } from "@/app/lib/beta";
import {
  acceptanceReason,
  toBugSeverity,
  toReportStatus,
  toShotStatus,
  DUPLICATE_XP,
  REASON_DUPLICATE,
  REASON_FIXED,
} from "@/app/lib/beta/config";
import { xpForFix, xpForReport, xpForShot } from "@/app/lib/beta/xp";
import { isResolvedSlug } from "@/app/lib/games-store";
import { social } from "@/app/lib/social";

const BETA_PATH = "/dashboard/beta";

/** Redirect back to the dashboard carrying a banner message. */
function back(kind: "ok" | "error", message: string): never {
  redirect(`${BETA_PATH}?${kind}=${encodeURIComponent(message)}`);
}

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Invite a player to the programme by username.
 *
 * BY USERNAME, NOT EMAIL, deliberately. `dashboard_users` is keyed on email
 * because an admin is invited before they ever sign in; a tester is a player who
 * ALREADY EXISTS, and their username is the identifier an admin actually sees on
 * profiles and leaderboards. Asking for an email would also mean typing a
 * child's address into a form that has no need for it.
 */
export async function inviteTesterAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const username = readString(formData, "username").toLowerCase();
  if (!username) back("error", "Enter a username");

  // Reuses the social store's existing lookup rather than adding a second
  // username-to-id query — usernames are its concern (it owns the uniqueness
  // constraint, the rename flow and `username_history`).
  let playerId: string | null = null;
  try {
    playerId = await social.internalIdFromUsername(username);
  } catch {
    back("error", "Could not look up that player (database error)");
  }
  if (!playerId) back("error", `No player with the username "${username}"`);

  try {
    await beta.invite(playerId, actor);
  } catch {
    back("error", "Invite failed (database error)");
  }
  revalidatePath(BETA_PATH);
  back("ok", `${username} is now a beta tester`);
}

/** Withdraw membership. The row and its XP ledger survive for the audit trail. */
export async function revokeTesterAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const playerId = readString(formData, "playerId");
  if (!playerId) back("error", "Missing player");

  try {
    await beta.revoke(playerId);
  } catch {
    back("error", "Revoke failed (database error)");
  }
  revalidatePath(BETA_PATH);
  back("ok", "Access revoked");
}

/**
 * Assign a game to a tester.
 *
 * The slug is checked against the RESOLVED catalogue (static + overrides +
 * external) rather than the static array, because an external game is exactly
 * the kind that most needs testing — and `beta_assignments.slug` is not a
 * foreign key, so this check is the only thing standing between a typo and an
 * assignment pointing at a game that does not exist.
 */
export async function assignGameAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const playerId = readString(formData, "playerId");
  const slug = readString(formData, "slug");
  const brief = readString(formData, "brief").slice(0, 500);

  if (!playerId) back("error", "Pick a tester");
  if (!slug) back("error", "Pick a game");
  if (!(await isResolvedSlug(slug))) back("error", `No game with the slug "${slug}"`);

  try {
    await beta.assign({ playerId, slug, assignedBy: actor, brief });
  } catch {
    back("error", "Assign failed (database error)");
  }
  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  back("ok", "Game assigned");
}

/** Withdraw an assignment entirely. */
export async function unassignAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const id = Number(readString(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) back("error", "Missing assignment");

  try {
    await beta.unassign(id);
  } catch {
    back("error", "Could not remove that assignment");
  }
  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  back("ok", "Assignment removed");
}

/**
 * Triage a report: set its outcome and pay whatever that outcome earns.
 *
 * The severity submitted here WINS over the tester's own guess — a tester
 * calling their own find a blocker should not set their own payout, and triage
 * is exactly the moment an admin corrects that. It is only read for bugs; the
 * cross-field CHECK rejects a severity on a feature, so passing one through
 * would turn an admin's stray form value into a 500.
 */
export async function triageReportAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const id = Number(readString(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) back("error", "Missing report");

  const status = toReportStatus(formData.get("status"));
  // Only the two outcomes that KEEP the row. "open" is the state a report
  // leaves, and offering it would let an admin un-resolve a report and
  // re-trigger its payout. `duplicate` is no longer reachable here at all — it
  // deletes the report now, so it lives in `duplicateReportAction` with the
  // other removing outcome rather than in the status-setting path.
  if (status !== "accepted" && status !== "rejected") {
    back("error", "Pick one of: accepted, rejected");
  }

  let report;
  try {
    report = await beta.reportById(id);
  } catch {
    back("error", "Could not load that report");
  }
  if (!report) back("error", "That report no longer exists");
  if (report.status !== "open") back("error", "That report was already triaged");

  // A feature must carry no severity, and a bug keeps its own unless the admin
  // overrode it on the form.
  const severity =
    report.kind === "bug"
      ? (toBugSeverity(formData.get("severity")) ?? report.severity)
      : null;

  const xp = xpForReport({ kind: report.kind, severity, status });

  // Minted by `config.ts`, never assembled here: the partial unique index that
  // makes a double-submit idempotent only recognises a repeat if the string is
  // identical, and this used to be built by hand in two separate actions.
  // Only `accepted` reaches the ledger from here — `rejected` pays nothing and
  // `duplicate` has its own action — so the fallback is unreachable and kept
  // only so a future third status cannot silently write an empty reason.
  const reason = status === "accepted" ? acceptanceReason(report.kind, severity) : status;

  let applied = false;
  try {
    applied = await beta.triageReport({
      id,
      status,
      severity,
      resolvedBy: actor,
      xp,
      reason,
    });
  } catch {
    back("error", "Triage failed (database error)");
  }

  // A resolved report's replay has done its job, and it is a recording of a
  // child's screen — there is no reason to keep it and a good reason not to.
  // Best-effort and deliberately AFTER the triage write: a failed delete must
  // never undo a decision, and `del()` is free of charge anyway. The row's
  // pointer is cleared too, so the clip route stops offering a 404'ing video.
  if (applied && report.clipBlobPath) {
    try {
      await del(report.clipBlobPath);
      await beta.clearClip(id);
    } catch (error) {
      console.error(`beta clip cleanup failed for report ${id}:`, error);
    }
  }

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  // `applied === false` means the guard matched nothing, i.e. someone else
  // triaged it between the read above and the write. Say so rather than
  // reporting a success that did not happen.
  if (!applied) back("error", "Someone else triaged that first");
  back("ok", xp > 0 ? `Accepted — ${xp} XP awarded` : "Report closed");
}

/**
 * Mark a report FIXED: pay the fix bonus and remove the report.
 *
 * The outcome triage never had. Accept says "you are right"; this says "and it
 * is done". Those are different facts and only the second one is worth removing
 * the row for, because only the second one means nothing is outstanding.
 *
 * ── WHY IT IS NOT A `status` VALUE ──────────────────────────────────────────
 * A fixed report is DELETED, so it never needs one. Everything an admin would
 * later want from the row — that a tester found something real and it shipped —
 * is in the XP ledger, which survives the delete because `report_id` is
 * ON DELETE SET NULL. The alternative, a terminal `fixed` status filtered out of
 * the queue, keeps a growing table of rows nobody reads and still has to be
 * excluded from every future query by hand.
 *
 * ── WORKS FROM `open` AND FROM `accepted`, AND PAYS DIFFERENTLY ─────────────
 * From `open` it pays the severity award and the bonus together, so fixing
 * something on sight is one click. From `accepted` it pays the bonus alone,
 * because the severity award is already in the ledger. `xpForFix()` owns that
 * split; see its docblock for why the reason strings have to match.
 *
 * A `rejected` report is refused. It is the one combination that cannot be made
 * to mean anything: the fix contradicts the triage, and one of the two is wrong.
 */
export async function fixReportAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const id = Number(readString(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) back("error", "Missing report");

  let report;
  try {
    report = await beta.reportById(id);
  } catch {
    back("error", "Could not load that report");
  }
  if (!report) back("error", "That report no longer exists");
  if (report.status === "rejected") {
    back("error", "That report was rejected — reopen it before marking it fixed");
  }

  // Same rule as triage: the admin's severity wins over the tester's guess, and
  // a feature carries none. Only consulted when the report is still open — an
  // accepted one pays no severity award, so a stray form value cannot change
  // what it costs.
  const severity =
    report.kind === "bug"
      ? (toBugSeverity(formData.get("severity")) ?? report.severity)
      : null;

  const award = xpForFix({ kind: report.kind, severity, status: report.status });

  // Must be byte-identical to what `triageReportAction` writes for the same
  // decision, or the unique index cannot recognise a re-payment. Both now call
  // the same minting function, so they cannot drift apart.
  const reason = acceptanceReason(report.kind, severity);

  let applied = false;
  let clipBlobPath: string | null = null;
  try {
    ({ applied, clipBlobPath } = await beta.payAndRemoveReport({
      id,
      resolvedBy: actor,
      awards: [
        { amount: award.acceptance, reason },
        { amount: award.bonus, reason: REASON_FIXED },
      ],
    }));
  } catch {
    back("error", "Could not mark that fixed (database error)");
  }

  // AFTER the write, best-effort, exactly as triage does it: a failed blob
  // delete must never undo a decision. No `clearClip` follows, because the row
  // that held the pointer is already gone.
  if (applied && clipBlobPath) {
    try {
      await del(clipBlobPath);
    } catch (error) {
      console.error(`beta clip cleanup failed for fixed report ${id}:`, error);
    }
  }

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  if (!applied) back("error", "Someone else resolved that first");
  back("ok", `Fixed — ${award.total} XP awarded, report removed`);
}

/**
 * Close a report as a DUPLICATE: pay the consolation and remove the report.
 *
 * Removal is the whole point. A duplicate is, by definition, a bug already
 * tracked by the report it duplicates — so the row is the one kind of record
 * that is guaranteed to be redundant the moment it is filed. Leaving it in the
 * queue behind a status meant re-reading the same bug every time an admin
 * scrolled past it.
 *
 * ── THE REPORTER IS NOT PAID FOR THE FIND ───────────────────────────────────
 * Only {@link DUPLICATE_XP}, never the severity award, however real the bug
 * turns out to be. The credit for finding it belongs to whoever filed it first,
 * and paying both would make the SECOND report the profitable one to file — you
 * would only have to watch the queue. What the consolation buys is the tester
 * not learning that reporting is a lottery; `config.ts` argues that at length,
 * and it is deliberately small enough that farming duplicates is pointless.
 *
 * ── OPEN REPORTS ONLY ───────────────────────────────────────────────────────
 * Unlike Fixed, this does not offer itself on an already-judged report. Calling
 * something a duplicate AFTER accepting it would have to decide what happens to
 * the severity award already paid, and there is no answer that is not either a
 * clawback or a double payment.
 */
export async function duplicateReportAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const id = Number(readString(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) back("error", "Missing report");

  let report;
  try {
    report = await beta.reportById(id);
  } catch {
    back("error", "Could not load that report");
  }
  if (!report) back("error", "That report no longer exists");
  if (report.status !== "open") {
    back("error", "That report was already triaged");
  }

  let applied = false;
  let clipBlobPath: string | null = null;
  try {
    ({ applied, clipBlobPath } = await beta.payAndRemoveReport({
      id,
      resolvedBy: actor,
      // ONE award, and the reason says what was PAID rather than what the report
      // was. Encoding the severity here would put "+5 bug:blocker" in the ledger,
      // flatly contradicting the rate card on /beta.
      awards: [{ amount: DUPLICATE_XP, reason: REASON_DUPLICATE }],
    }));
  } catch {
    back("error", "Could not close that as duplicate (database error)");
  }

  if (applied && clipBlobPath) {
    try {
      await del(clipBlobPath);
    } catch (error) {
      console.error(`beta clip cleanup failed for duplicate report ${id}:`, error);
    }
  }

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  if (!applied) back("error", "Someone else triaged that first");
  back("ok", `Duplicate — ${DUPLICATE_XP} XP awarded, report removed`);
}

/**
 * Review a submitted image.
 *
 * Acceptance pays {@link xpForShot}; promotion to cover art is a separate,
 * later decision that pays again under a different reason, which is why the
 * store's dedupe index is keyed on `(shot_id, reason)` rather than `shot_id`.
 */
export async function reviewShotAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const id = readString(formData, "id");
  if (!id) back("error", "Missing image");

  const status = toShotStatus(formData.get("status"));
  if (!status || status === "pending") back("error", "Pick accept or reject");

  const xp = status === "accepted" ? xpForShot({ promotedToCover: false }) : 0;

  let applied = false;
  try {
    applied = await beta.reviewShot({
      id,
      status,
      reviewedBy: actor,
      xp,
      reason: "shot:accepted",
    });
  } catch {
    back("error", "Review failed (database error)");
  }

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  if (!applied) back("error", "Someone else reviewed that first");
  back("ok", xp > 0 ? `Accepted — ${xp} XP awarded` : "Image rejected");
}
