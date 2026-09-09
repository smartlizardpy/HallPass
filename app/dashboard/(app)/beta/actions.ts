"use server";

/**
 * HallPass dashboard — beta programme write actions.
 *
 * The WRITE half of `/dashboard/beta`; the read-only server component that
 * renders the roster and queues lives alongside in `page.tsx`.
 *
 * Every action follows the invariant sequence set by `users/actions.ts`:
 *   1. `requireRole(...)` FIRST, before a single form field is read, so an
 *      unauthorised caller is redirected before anything is parsed or written.
 *      Most of this surface asks for `BETA_MIN_ROLE`, because running the beta
 *      programme is what the lowest rung exists for; the two that change
 *      MEMBERSHIP ask for more (see `canManageTesters`).
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
 * ── FOUR EYES ───────────────────────────────────────────────────────────────
 * Nobody but a super admin may judge a report or an image THEY filed. Admins can
 * file reports like anyone else — they pass the tester guard without a
 * membership row — and every judging action here PAYS XP, so without this an
 * admin's own find is a self-service payout. {@link assertNotOwnWork} is the one
 * place that asks, and it runs after the row is loaded (the author is on the
 * row) and before anything is written.
 *
 * XP IS COMPUTED HERE, NOT IN SQL. The rate card lives in `beta/config.ts` so
 * the tester's page and the payout cannot drift, which means the amount has to
 * be worked out in TypeScript and handed to the store. The store's write is
 * guarded on the report's pre-state and deduped by a partial unique index, so
 * the read-then-write that implies is still safe against a double submit.
 */

import { revalidatePath, updateTag } from "next/cache";
import { copy, del } from "@vercel/blob";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import type { Role } from "@/app/lib/dashboard-users";
import {
  BETA_MIN_ROLE,
  canConfirmOwnWork,
  SITE_WRITE_ROLE,
} from "@/app/lib/permissions";
import { blobOpDisabledMessage, isBlobOpEnabled } from "@/app/lib/blob-ops";
import { beta } from "@/app/lib/beta";
import {
  acceptanceReason,
  INVITE_NOTE_MAX,
  toBugSeverity,
  toReportStatus,
  toShotStatus,
  DUPLICATE_XP,
  REASON_DUPLICATE,
  REASON_FIXED,
} from "@/app/lib/beta/config";
import { xpForFix, xpForReport, xpForShot } from "@/app/lib/beta/xp";
import { MEDIA_CACHE_TAG, insertMedia } from "@/app/lib/game-media";
import { mediaBlobPath } from "@/app/lib/game-media-blob";
import { toImageType } from "@/app/lib/image-meta";
import { isResolvedSlug } from "@/app/lib/games-store";
import { findGame } from "@/app/lib/games";
import { betaAssignmentCopy } from "@/app/lib/notifications/copy";
import { notifyPlayer } from "@/app/lib/notifications/deliver";
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
 * Refuse a decision the caller is not allowed to make about their OWN
 * submission. Returns normally when the decision may proceed; otherwise it
 * redirects with a banner (via `back()`, which throws).
 *
 * ── WHY IT TAKES THE ACTOR'S PLAYER ID AND NOT THEIR EMAIL ──────────────────
 * `dashboard_users` is keyed by email and `beta_reports.player_id` is a Google
 * subject id. They identify the same human through completely separate columns,
 * and only the player id is comparable to what is stored on the row.
 *
 * ── A SESSION WITH NO PLAYER ID IS REFUSED, NOT WAVED THROUGH ───────────────
 * `playerId` is pinned at login, so a token minted before that carries none. The
 * question this function answers is "can I prove this is not yours?", and a
 * missing id means NO. Refusing costs that admin one sign-out and sign-in, which
 * the banner says; waving them through would make "hold an old token" the way
 * around the rule.
 */
function assertNotOwnWork(input: {
  role: Role;
  actorPlayerId: string | undefined;
  ownerPlayerId: string | null;
  what: "report" | "image";
}): void {
  if (canConfirmOwnWork(input.role)) return;
  // Nobody owns it any more (the author's player row was deleted), so there is
  // no self-dealing to prevent.
  if (input.ownerPlayerId == null) return;
  if (!input.actorPlayerId) {
    back(
      "error",
      "Sign out and back in before judging this — your session predates the check that says whose it is",
    );
  }
  if (input.ownerPlayerId === input.actorPlayerId) {
    back(
      "error",
      `You submitted this ${input.what} — another admin has to judge it`,
    );
  }
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
  const { email: actor } = await requireRole(SITE_WRITE_ROLE);

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

/**
 * ASK for a player to be invited, for a role that may not invite one.
 *
 * By username for the same reason {@link inviteTesterAction} takes one: a tester
 * is a player who already exists, and their username is the identifier an admin
 * actually sees. The optional note is what the approver reads to answer yes or
 * no; without it the queue is a list of names with no case attached to any of
 * them.
 *
 * ALREADY-ACTIVE TESTERS ARE REFUSED HERE, not left for the approver to notice.
 * A request to invite somebody who is already in the programme would be approved
 * (it is not wrong, exactly), write a no-op membership upsert, and teach both
 * people that the queue contains work that is not work.
 */
export async function requestTesterAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole(BETA_MIN_ROLE);

  const username = readString(formData, "username").toLowerCase();
  if (!username) back("error", "Enter a username");
  const note = readString(formData, "note").slice(0, INVITE_NOTE_MAX);

  let playerId: string | null = null;
  try {
    playerId = await social.internalIdFromUsername(username);
  } catch {
    back("error", "Could not look up that player (database error)");
  }
  if (!playerId) back("error", `No player with the username "${username}"`);

  let filed = false;
  try {
    if (await beta.isActiveTester(playerId)) {
      back("error", `${username} is already a beta tester`);
    }
    filed = await beta.requestInvite({
      playerId,
      requestedBy: actor,
      note,
    });
  } catch {
    back("error", "Could not file that request (database error)");
  }

  revalidatePath(BETA_PATH);
  // `filed === false` means the partial unique index matched: somebody has
  // already asked for this player and nobody has decided yet. Saying "requested"
  // again would imply a second request exists to be answered.
  if (!filed) back("ok", `${username} is already waiting for a decision`);
  back("ok", `Asked an admin to invite ${username}`);
}

/**
 * Approve a requested invite: grant membership, then record the decision.
 *
 * ── THAT ORDER IS DELIBERATE ────────────────────────────────────────────────
 * There is no transaction across two statements here (see `store.ts`), so the
 * order is chosen by which half-finished state is recoverable. Membership
 * granted with the request still pending simply shows up in the queue again, and
 * approving it a second time converges — `beta.invite` upserts. The other order
 * leaves a request marked approved with nobody actually invited, which looks
 * finished and is not.
 *
 * ── THE INVITER OF RECORD IS THE REQUESTER ──────────────────────────────────
 * `beta_testers.invited_by` credits whoever asked, because that is who brought
 * the tester in. Who ALLOWED it is `decided_by` on the request row, which is why
 * that row is kept rather than deleted.
 */
export async function approveInviteRequestAction(
  formData: FormData,
): Promise<void> {
  const { email: actor, role } = await requireRole(SITE_WRITE_ROLE);

  const id = Number(readString(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) back("error", "Missing request");

  let request;
  try {
    request = await beta.inviteRequestById(id);
  } catch {
    back("error", "Could not load that request");
  }
  if (!request) back("error", "That request no longer exists");
  if (request.status !== "pending") back("error", "That request was already decided");
  // Four eyes again, on emails this time: `requested_by` and the acting admin
  // are both `dashboard_users` addresses. Approving your own ask is the same
  // one-person loop the request exists to break, so it is refused for everyone
  // the rule binds — a full admin included.
  if (!canConfirmOwnWork(role) && request.requestedBy === actor) {
    back("error", "You raised this request — another admin has to approve it");
  }

  let applied = false;
  try {
    await beta.invite(request.playerId, request.requestedBy);
    applied = await beta.decideInviteRequest({
      id,
      status: "approved",
      decidedBy: actor,
    });
  } catch {
    back("error", "Could not approve that request (database error)");
  }

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  if (!applied) back("error", "Someone else decided that first");
  back("ok", "Invited");
}

/** Turn a requested invite down. Keeps the row as the record of the answer. */
export async function denyInviteRequestAction(
  formData: FormData,
): Promise<void> {
  const { email: actor, role } = await requireRole(SITE_WRITE_ROLE);

  const id = Number(readString(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) back("error", "Missing request");

  let request;
  try {
    request = await beta.inviteRequestById(id);
  } catch {
    back("error", "Could not load that request");
  }
  if (!request) back("error", "That request no longer exists");
  if (request.status !== "pending") back("error", "That request was already decided");
  // Denying your own ask grants nothing, but it does let one person quietly
  // clear their own trail out of the queue. The record of who asked and who
  // answered is the point of the row, so the same rule applies.
  if (!canConfirmOwnWork(role) && request.requestedBy === actor) {
    back("error", "You raised this request — another admin has to answer it");
  }

  let applied = false;
  try {
    applied = await beta.decideInviteRequest({
      id,
      status: "denied",
      decidedBy: actor,
    });
  } catch {
    back("error", "Could not deny that request (database error)");
  }

  revalidatePath(BETA_PATH);
  if (!applied) back("error", "Someone else decided that first");
  back("ok", "Request denied");
}

/** Withdraw membership. The row and its XP ledger survive for the audit trail. */
export async function revokeTesterAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

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
  const { email: actor } = await requireRole(BETA_MIN_ROLE);

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

  // Tell the tester. An assignment is work handed to a person, and before this
  // the only way to discover one was to visit `/beta` and notice a new row.
  //
  // NO DEDUPE KEY. `beta.assign` upserts, and its own docblock records that an
  // admin re-assigning a closed game means "look at this again" — which is a
  // real instruction to the tester, not a duplicate. A key on the pair would
  // make exactly that case silent.
  //
  // Between the write and the redirect: `back()` throws a control signal, so
  // nothing may sit after it, and `notifyPlayer` never rejects.
  await notifyPlayer(playerId, {
    kind: "beta_assignment",
    // The display title where the game is in the static catalogue, the slug
    // otherwise — an external game is exactly the kind most likely to be under
    // test, so it must still notify.
    copy: betaAssignmentCopy({ gameTitle: findGame(slug)?.title ?? slug }),
    dedupeKey: null,
  });

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  back("ok", "Game assigned");
}

/** Withdraw an assignment entirely. */
export async function unassignAction(formData: FormData): Promise<void> {
  await requireRole(BETA_MIN_ROLE);

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
  const { email: actor, role, playerId } = await requireRole(BETA_MIN_ROLE);

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
  assertNotOwnWork({
    role,
    actorPlayerId: playerId,
    ownerPlayerId: report.playerId,
    what: "report",
  });

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
  const { email: actor, role, playerId } = await requireRole(BETA_MIN_ROLE);

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
  // Fixed pays MORE than accept (the severity award plus the bonus), so it is
  // the outcome self-dealing would reach for first.
  assertNotOwnWork({
    role,
    actorPlayerId: playerId,
    ownerPlayerId: report.playerId,
    what: "report",
  });

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
  const { email: actor, role, playerId } = await requireRole(BETA_MIN_ROLE);

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
  // Pays only the consolation, but it also DELETES the report — so on your own
  // report it is the outcome that quietly removes the evidence.
  assertNotOwnWork({
    role,
    actorPlayerId: playerId,
    ownerPlayerId: report.playerId,
    what: "report",
  });

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
/**
 * Copy an approved shot into the public gallery.
 *
 * ── WHY A COPY AND NOT A POINTER ────────────────────────────────────────────
 * `mediaPublicPath()` derives a media row's URL straight from its `blob_path`,
 * and the only route that serves those is `/game-media/`. A `game_media` row
 * left pointing at `beta-shots/…` would therefore resolve to a URL nothing
 * answers — the image would be in the gallery and still invisible. So the object
 * moves under the `game-media/` prefix, which is what `mediaBlobPath()` builds.
 *
 * `copy()` is one ADVANCED Blob operation, and the Hobby allowance is 2,000 a
 * month. At a handful of accepted shots that is noise, but it is why this
 * happens once on acceptance rather than on every gallery read.
 *
 * ── THE MEDIA ID IS THE SHOT ID, DELIBERATELY ───────────────────────────────
 * That makes the whole sequence idempotent: `copy()` overwrites the same key,
 * `insertMedia()` now conflicts away on the primary key, and `markShotPromoted`
 * is guarded on the pointer still being null. A retry after a half-finished
 * publish converges instead of creating a second gallery entry.
 *
 * Never touches the `games/` prefix — see `game-media.sql` for the seven
 * behaviours that sweep it — and never calls `bumpGamesVersion()`, which would
 * force every online client to re-download the whole corpus over one screenshot.
 */
async function publishShotToGallery(shot: {
  id: string;
  slug: string;
  blobPath: string;
  blobUrl: string | null;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
}): Promise<string> {
  const contentType = toImageType(shot.contentType);
  const blobPath = mediaBlobPath(shot.slug, shot.id, contentType);
  // `copy` takes the source URL when there is one; the stored path is the
  // fallback for a row written before `blob_url` existed.
  const copied = await copy(shot.blobUrl ?? shot.blobPath, blobPath, {
    access: "public",
    addRandomSuffix: false,
  });
  await insertMedia({
    id: shot.id,
    slug: shot.slug,
    kind: "screenshot",
    blobPath,
    blobUrl: copied.url,
    contentType,
    width: shot.width,
    height: shot.height,
    bytes: shot.bytes,
  });
  return shot.id;
}

/** Drop every cache that could still be serving the old gallery. */
function revalidateGallery(slug: string): void {
  updateTag(MEDIA_CACHE_TAG);
  revalidatePath(`/game/${slug}`);
}

export async function reviewShotAction(formData: FormData): Promise<void> {
  const { email: actor, role, playerId } = await requireRole(BETA_MIN_ROLE);

  const id = readString(formData, "id");
  if (!id) back("error", "Missing image");

  const status = toShotStatus(formData.get("status"));
  if (!status || status === "pending") back("error", "Pick accept or reject");

  const xp = status === "accepted" ? xpForShot({ promotedToCover: false }) : 0;

  // Loaded BEFORE the branch below, and for both outcomes: the author is on the
  // row, and rejecting your own image is judging your own work exactly as
  // accepting it is. The accept path reuses this read rather than repeating it.
  let shot;
  try {
    shot = await beta.shotById(id);
  } catch {
    back("error", "Could not load that image");
  }
  if (!shot) back("error", "That image no longer exists");
  assertNotOwnWork({
    role,
    actorPlayerId: playerId,
    ownerPlayerId: shot.playerId,
    what: "image",
  });

  // ── PUBLISH FIRST, THEN MARK ACCEPTED ─────────────────────────────────────
  // Without a transaction one half can land alone, so the order is chosen by
  // which half-finished state is recoverable. Published-but-still-pending simply
  // shows up in the queue again, and the retry converges because every step is
  // idempotent. Accepted-but-unpublished is the bug this whole change exists to
  // fix: the shot is marked done, the tester is paid, and the image is nowhere.
  let mediaId: string | null = null;
  let slug: string | null = null;
  if (status === "accepted") {
    // The publish is a `copy`, an advanced Blob operation, so it can be switched
    // off — and because publish comes BEFORE accept, refusing here leaves the
    // shot pending rather than accepted-and-invisible. The tester is not paid
    // for a decision that was not made; the queue simply keeps the image until
    // the switch is back on. REJECTING is untouched: it writes no blob, so
    // triage can still clear the queue of the ones that were never going in.
    if (!(await isBlobOpEnabled("shot_promotion"))) {
      back("error", blobOpDisabledMessage("shot_promotion"));
    }
    slug = shot.slug;
    try {
      mediaId = await publishShotToGallery(shot);
    } catch (error) {
      console.error(`beta shot publish failed for ${id}:`, error);
      // Deliberately does NOT fall through to accepting it. Paying for an image
      // that never reaches the gallery is the failure being removed here.
      back("error", "Could not publish that image to the gallery — nothing changed");
    }
  }

  let applied = false;
  try {
    applied = await beta.reviewShot({
      id,
      status,
      reviewedBy: actor,
      xp,
      reason: "shot:accepted",
      promotedMediaId: mediaId,
    });
  } catch {
    back("error", "Review failed (database error)");
  }

  revalidatePath(BETA_PATH);
  revalidatePath("/beta");
  if (slug) revalidateGallery(slug);
  if (!applied) back("error", "Someone else reviewed that first");
  back("ok", xp > 0 ? `Accepted — ${xp} XP awarded, image published` : "Image rejected");
}

/**
 * Publish shots that were accepted back when acceptance published nothing.
 *
 * Ten of these exist on production: marked accepted, paid for, and invisible.
 * They cannot go back through `reviewShotAction`, which is guarded on `pending`,
 * so the repair is its own action — and it doubles as the retry for any future
 * acceptance whose publish half fails.
 *
 * Pays nothing. The XP was already awarded when the shot was accepted; this
 * finishes a job that was left half-done, it does not make a new decision.
 */
export async function publishAcceptedShotsAction(): Promise<void> {
  await requireRole(BETA_MIN_ROLE);

  if (!(await isBlobOpEnabled("shot_promotion"))) {
    back("error", blobOpDisabledMessage("shot_promotion"));
  }

  let pending;
  try {
    pending = await beta.unpublishedShots();
  } catch {
    back("error", "Could not load the unpublished images");
  }
  if (pending.length === 0) back("ok", "Every accepted image is already published");

  const slugs = new Set<string>();
  let published = 0;
  const failures: string[] = [];
  for (const shot of pending) {
    try {
      const mediaId = await publishShotToGallery(shot);
      await beta.markShotPromoted(shot.id, mediaId);
      slugs.add(shot.slug);
      published += 1;
    } catch (error) {
      // One bad blob must not strand the rest of the batch.
      console.error(`beta shot backfill failed for ${shot.id}:`, error);
      failures.push(shot.id);
    }
  }

  revalidatePath(BETA_PATH);
  for (const slug of slugs) revalidateGallery(slug);
  if (published === 0) back("error", "Could not publish any of them");
  back(
    "ok",
    failures.length === 0
      ? `Published ${published} image${published === 1 ? "" : "s"} to the gallery`
      : `Published ${published}, but ${failures.length} failed — see the logs`,
  );
}
