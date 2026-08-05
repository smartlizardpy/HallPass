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
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { beta } from "@/app/lib/beta";
import {
  toBugSeverity,
  toReportStatus,
  toShotStatus,
  REPORT_STATUSES,
} from "@/app/lib/beta/config";
import { xpForReport, xpForShot } from "@/app/lib/beta/xp";
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
  if (!status || status === "open") {
    // "open" is the state a report LEAVES; offering it as a decision would let
    // an admin un-resolve a report and re-trigger its payout.
    back("error", `Pick one of: ${REPORT_STATUSES.filter((s) => s !== "open").join(", ")}`);
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

  // The reason must describe WHAT WAS PAID, not merely what the report was.
  // Encoding the severity unconditionally produced ledger lines like
  // "+5 bug:minor" for a duplicate, flatly contradicting the rate card on /beta
  // that promises 30 for a minor bug. `rejected` pays nothing and so never
  // reaches the ledger, leaving `duplicate` as the only non-accepted reason.
  const reason =
    status === "accepted"
      ? report.kind === "bug" && severity
        ? `bug:${severity}`
        : "feature:accepted"
      : status;

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

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  // `applied === false` means the guard matched nothing, i.e. someone else
  // triaged it between the read above and the write. Say so rather than
  // reporting a success that did not happen.
  if (!applied) back("error", "Someone else triaged that first");
  back("ok", xp > 0 ? `Accepted — ${xp} XP awarded` : "Report closed");
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
