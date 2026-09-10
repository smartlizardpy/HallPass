/**
 * HallPass — what the bug MCP's tools actually do.
 *
 * The SERVER-ONLY half, beside the pure `report-view.ts`: this is the module
 * that reaches for the live store, so it is the one that must never reach a
 * client bundle. Same split as `beta/store.ts` (pure factory) and
 * `beta/index.ts` (bound to the shared Neon client).
 *
 * ── THIS MODULE ADDS NO SQL AND NO XP ARITHMETIC ───────────────────────────
 * That is the single most important property here, and `bug-mcp-design.md` §3
 * argues it at length. Every decision below is a REPLAY of one the beta server
 * actions already make: the same store methods, the same minting functions, the
 * same guards in the same order. `store.ts`'s `payAndRemoveReport` carries a
 * comment explaining that the order of two statements is a safety property —
 * "reversing these two lines converts a retry into a silent theft" — and the way
 * to keep that property is to call it rather than to write it out again.
 *
 * ── WHY NOT CALL THE SERVER ACTIONS THEMSELVES ─────────────────────────────
 * They would be the obvious reuse, and they cannot be reused. Each takes
 * `FormData`, resolves an admin identity through `requireRole()`, and reports
 * its outcome by THROWING a redirect (`back()`), because a form post's answer is
 * a page. A tool call's answer is a value, and a redirect thrown inside a route
 * handler would surface to the agent as an unexplained failure. So the decision
 * sequence is repeated and the primitives are shared, which is the seam the
 * store was already built for.
 *
 * ── EVERY WRITE REPORTS REFUSAL AS REFUSAL ─────────────────────────────────
 * The store's writes return `applied: false` rather than throwing when their
 * `WHERE` matched nothing — someone else got there first, or the row is already
 * gone. An agent handed "ok" for a write that did nothing will confidently tell
 * you a bug is closed when it is not, so every path below distinguishes the two.
 */

import "server-only";
import { del } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { beta } from "@/app/lib/beta";
import {
  DUPLICATE_XP,
  REASON_DUPLICATE,
  REASON_FIXED,
  acceptanceReason,
  type BugSeverity,
  type ReportKind,
  type ReportStatus,
} from "@/app/lib/beta/config";
import { xpForFix, xpForReport } from "@/app/lib/beta/xp";
import { REVALIDATE_PATHS, clampLimit, mcpActor } from "./config";
import {
  resolveSeverity,
  toReportDetail,
  toReportSummary,
  type ReportDetail,
  type ReportSummary,
} from "./report-view";

/**
 * How deep into the queue a filtered list looks.
 *
 * `reportQueue` orders open reports first and caps itself at 500, so this is the
 * store's own ceiling rather than a number invented here. Filtering happens in
 * memory against that page: adding a filtered query to `store.ts` would be the
 * tidier read, and it is not worth editing a tested module for a queue whose
 * open half is realistically dozens of rows. What it is worth is SAYING SO when
 * the page fills up — see `truncated` below.
 */
const QUEUE_SCAN_DEPTH = 500;

/** What a write did, or why it did nothing. */
export type WriteResult =
  | { ok: true; message: string }
  | { ok: false; reason: string };

const refuse = (reason: string): WriteResult => ({ ok: false, reason });

/** Filters a caller may narrow the queue with. All optional, all ANDed. */
export type ListFilters = {
  status?: ReportStatus;
  kind?: ReportKind;
  severity?: BugSeverity;
  slug?: string;
  limit?: number;
};

export type ListResult = {
  reports: ReportSummary[];
  /**
   * True when the scan hit its ceiling, so older rows may exist that match the
   * filter and were never looked at.
   *
   * Reported rather than swallowed. A silent truncation is how an agent comes to
   * believe it has seen the whole queue, and the belief is unfalsifiable from
   * the outside — the answer looks exactly like a complete one.
   */
  truncated: boolean;
};

/**
 * The triage queue, newest first with open reports ahead of resolved ones.
 *
 * Summaries only; `getBugReport` is the detail call. That split is the reason a
 * hundred-row answer stays affordable — `errorLog` alone can be kilobytes.
 */
export async function listBugReports(filters: ListFilters): Promise<ListResult> {
  const scanned = await beta.reportQueue(QUEUE_SCAN_DEPTH);

  const slug = filters.slug?.trim().toLowerCase();
  const matched = scanned.filter((report) => {
    if (filters.status && report.status !== filters.status) return false;
    if (filters.kind && report.kind !== filters.kind) return false;
    if (filters.severity && report.severity !== filters.severity) return false;
    if (slug && report.slug !== slug) return false;
    return true;
  });

  return {
    reports: matched.slice(0, clampLimit(filters.limit)).map(toReportSummary),
    truncated: scanned.length >= QUEUE_SCAN_DEPTH,
  };
}

/**
 * One report in full, or `null` when it does not exist.
 *
 * `reportById` returns the row without its author, so the author is recovered
 * from the queue read. A report too old to appear in that scan still returns —
 * with a null author rather than not at all, on the same reasoning as an
 * orphaned report: the bug is the point, and the handle is decoration.
 */
export async function getBugReport(id: number): Promise<ReportDetail | null> {
  const report = await beta.reportById(id);
  if (!report) return null;

  const queue = await beta.reportQueue(QUEUE_SCAN_DEPTH);
  const joined = queue.find((row) => row.id === id);
  return toReportDetail(
    joined ?? { ...report, authorUsername: null, authorHandle: null, authorName: null },
  );
}

/**
 * Invalidate the two pages a decision changes.
 *
 * Mirrors what every beta server action does. `/dashboard/beta` is the queue an
 * operator refreshes after the agent has been working; `/beta` is the tester's
 * own page, where the report disappearing and the XP total moving are what the
 * decision looks like from their side.
 */
function revalidateBetaSurfaces(): void {
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
}

/**
 * Delete a resolved report's replay, best-effort and always AFTER the write.
 *
 * The actions' reasoning, unchanged: "a resolved report's replay has done its
 * job, and it is a recording of a child's screen — there is no reason to keep it
 * and a good reason not to." A failed delete must never undo a decision, so this
 * only ever logs.
 *
 * `clearPointer` is the difference between the two kinds of outcome, and it is
 * easy to get wrong in the silent direction. Triage KEEPS the row, so its
 * `clip_blob_path` must be nulled too or the clip route goes on offering a video
 * that is no longer there. Fixed and duplicate DELETE the row, so there is no
 * pointer left to clear and calling `clearClip` would be an update against an id
 * that no longer exists.
 */
async function cleanUpClip(
  clipBlobPath: string | null,
  id: number,
  clearPointer: boolean,
): Promise<void> {
  if (!clipBlobPath) return;
  try {
    await del(clipBlobPath);
    if (clearPointer) await beta.clearClip(id);
  } catch (error) {
    console.error(`mcp clip cleanup failed for report ${id}:`, error);
  }
}

/**
 * Set a report's outcome without removing it: `accepted` or `rejected`.
 *
 * The two REMOVING outcomes live in their own functions, exactly as they do in
 * the action layer — `duplicate` deletes the row, so offering it here would let
 * one tool do two very different things to a report depending on an argument.
 *
 * OPEN REPORTS ONLY. Re-triaging a judged report would re-trigger its payout;
 * the store's `WHERE status = 'open'` enforces it and this check reports it in
 * words rather than as a silent no-op.
 */
export async function triageBugReport(input: {
  id: number;
  status: Extract<ReportStatus, "accepted" | "rejected">;
  severity?: BugSeverity | null;
}): Promise<WriteResult> {
  const report = await beta.reportById(input.id);
  if (!report) return refuse(`Report ${input.id} does not exist.`);
  if (report.status !== "open") {
    return refuse(
      `Report ${input.id} was already triaged as "${report.status}". Only open reports can be triaged.`,
    );
  }

  const severity = resolveSeverity(report, input.severity);
  const xp = xpForReport({ kind: report.kind, severity, status: input.status });

  // Minted, never assembled here: the partial unique index that makes a repeat
  // idempotent only recognises it if the string is identical, and this used to
  // be built by hand in two separate actions. `rejected` pays nothing and so
  // writes no ledger row at all.
  const reason =
    input.status === "accepted" ? acceptanceReason(report.kind, severity) : input.status;

  const applied = await beta.triageReport({
    id: input.id,
    status: input.status,
    severity,
    resolvedBy: mcpActor(),
    xp,
    reason,
  });

  if (applied) await cleanUpClip(report.clipBlobPath, input.id, true);
  revalidateBetaSurfaces();

  if (!applied) return refuse(`Someone else resolved report ${input.id} first.`);
  return {
    ok: true,
    message:
      input.status === "accepted"
        ? `Report ${input.id} accepted${severity ? ` as ${severity}` : ""} — ${xp} XP awarded.`
        : `Report ${input.id} rejected. No XP awarded.`,
  };
}

/**
 * Mark a report FIXED: pay for the find and the fix, then remove the report.
 *
 * DESTRUCTIVE AND IRREVERSIBLE. The row is deleted, which is the operational
 * truth — there is nothing left to do about a bug that is fixed — and the XP is
 * in the ledger, which outlives the report by design.
 *
 * ONE-STEP AND TWO-STEP BOTH WORK, which `xpForFix` handles: an `open` report
 * pays the severity award AND the bonus, so fixing something the moment you read
 * it needs no separate accept; an already-`accepted` one pays the bonus only,
 * because re-paying the severity would double-credit the find.
 *
 * A REJECTED report is refused. "We fixed the thing you told us was not a thing"
 * is a triage contradiction; `xpForFix` is documented as refusing to price it,
 * and `payAndRemoveReport` excludes it in SQL as well, so this check is the
 * third of three rather than the only one.
 */
export async function markBugReportFixed(input: {
  id: number;
  severity?: BugSeverity | null;
}): Promise<WriteResult> {
  const report = await beta.reportById(input.id);
  if (!report) return refuse(`Report ${input.id} does not exist.`);
  if (report.status === "rejected") {
    return refuse(
      `Report ${input.id} was rejected — reopen it in the dashboard before marking it fixed.`,
    );
  }

  const severity = resolveSeverity(report, input.severity);
  const award = xpForFix({ kind: report.kind, severity, status: report.status });

  // Must be byte-identical to what an acceptance writes for the same decision,
  // or the unique index cannot recognise a re-payment as a repeat.
  const reason = acceptanceReason(report.kind, severity);

  const { applied, clipBlobPath } = await beta.payAndRemoveReport({
    id: input.id,
    resolvedBy: mcpActor(),
    awards: [
      { amount: award.acceptance, reason },
      { amount: award.bonus, reason: REASON_FIXED },
    ],
  });

  if (applied) await cleanUpClip(clipBlobPath, input.id, false);
  revalidateBetaSurfaces();

  if (!applied) return refuse(`Someone else resolved report ${input.id} first.`);
  return {
    ok: true,
    message: `Report ${input.id} marked fixed — ${award.total} XP awarded, report removed.`,
  };
}

/**
 * Close a report as a DUPLICATE: pay the consolation and remove it.
 *
 * OPEN REPORTS ONLY, unlike Fixed. Calling something a duplicate after accepting
 * it would have to decide what happens to the severity award already paid, and
 * there is no answer that is not either a clawback or a double payment.
 *
 * THE REPORTER IS NOT PAID FOR THE FIND, only the consolation, however real the
 * bug turns out to be — the credit belongs to whoever filed it first, and paying
 * both would make the second report the profitable one to file.
 */
export async function closeBugReportDuplicate(input: {
  id: number;
}): Promise<WriteResult> {
  const report = await beta.reportById(input.id);
  if (!report) return refuse(`Report ${input.id} does not exist.`);
  if (report.status !== "open") {
    return refuse(
      `Report ${input.id} was already triaged as "${report.status}". Only open reports can be closed as duplicates.`,
    );
  }

  const { applied, clipBlobPath } = await beta.payAndRemoveReport({
    id: input.id,
    resolvedBy: mcpActor(),
    // ONE award, and the reason says what was PAID rather than what the report
    // was. Encoding the severity here would put "+5 bug:blocker" in the ledger,
    // flatly contradicting the rate card on /beta.
    awards: [{ amount: DUPLICATE_XP, reason: REASON_DUPLICATE }],
  });

  if (applied) await cleanUpClip(clipBlobPath, input.id, false);
  revalidateBetaSurfaces();

  if (!applied) return refuse(`Someone else resolved report ${input.id} first.`);
  return {
    ok: true,
    message: `Report ${input.id} closed as a duplicate — ${DUPLICATE_XP} XP awarded, report removed.`,
  };
}
