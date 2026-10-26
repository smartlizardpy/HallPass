"use server";

/**
 * HallPass dashboard — championship server actions (`/dashboard/championship`).
 *
 * The house shape of `moderation/actions.ts`, for the same reasons:
 *
 *   1. `requireRole(SITE_WRITE_ROLE)` FIRST, before any form field is read.
 *      Server actions are reachable by direct POST; this is the gate.
 *   2. Validate every field against the championship config. A bad value is a
 *      banner, never a 500 and never an unchecked value reaching Postgres.
 *   3. A tight `try` around the store calls only.
 *   4. `redirect()` OUTSIDE that `try` (it throws to navigate).
 *   5. `revalidatePath` before the success redirect.
 *
 * The actor is `requireRole()`'s email, never a form field: an audit log anyone
 * can write a name into is worse than none. Admins cannot review their own
 * runs: the reviewer's own player id goes to the store, whose statement refuses
 * a run that belongs to it.
 *
 * Clock-dependent rules (verification only after the finishing grace, reopen
 * only before the scheduled close) are checked with the DATABASE clock via
 * `eventActionAllowed`; the stored-state rules are the SQL's own guards.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { championshipStore, computeStandings } from "@/app/lib/championship";
import { eventActionAllowed } from "@/app/lib/championship/admin";
import { awardsFrom, publicAwards } from "@/app/lib/championship/awards";
import { championshipById } from "@/app/lib/championship/config";
import { toPublicStandings } from "@/app/lib/championship/standings";
import {
  GAME_TRANSITIONS,
  REVIEW_TRANSITIONS,
  type EventAction,
  type GameAction,
  type ReviewAction,
} from "@/app/lib/championship/store";
import type { ChampionshipConfig } from "@/app/lib/championship/types";
import { collectiblesStore } from "@/app/lib/collectibles";
import { describeRewards, payChampionshipRewards, type RewardsReport } from "@/app/lib/collectibles/championship-rewards";

const PATH = "/dashboard/championship";
const MAX_REASON = 300;
const EVENT_ACTIONS: readonly EventAction[] = ["suspend", "resume", "close-early", "reopen", "start-verification", "archive"];
/** Actions whose reason is part of the record and must be given. */
const REASON_REQUIRED = new Set<string>(["suspend", "close-early", "withdraw-game", "pause-game", "disqualify-run", "reinstate-run"]);

function back(kind: "ok" | "error", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function readChampionship(formData: FormData): ChampionshipConfig {
  const c = championshipById(String(formData.get("championship") ?? ""));
  if (!c) back("error", "Unknown championship.");
  return c;
}

function readReason(formData: FormData, action: string): string | null {
  const raw = String(formData.get("reason") ?? "").trim().slice(0, MAX_REASON);
  if (!raw && REASON_REQUIRED.has(action)) back("error", "Give a reason: it goes in the audit log.");
  return raw || null;
}

function readRunId(formData: FormData): number {
  const raw = String(formData.get("runId") ?? "").trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) back("error", "That run id was not valid.");
  return n;
}

const GAME_DONE: Record<GameAction, string> = {
  "open-game": "opened",
  "pause-game": "paused",
  "resume-game": "resumed",
  "withdraw-game": "withdrawn",
};

export async function gameAction(formData: FormData): Promise<void> {
  const { email } = await requireRole(SITE_WRITE_ROLE);
  const c = readChampionship(formData);
  const action = String(formData.get("action") ?? "") as GameAction;
  if (!(action in GAME_TRANSITIONS)) back("error", "Unknown lineup action.");
  const game = c.games.find((g) => g.slug === String(formData.get("game") ?? ""));
  if (!game) back("error", "That game is not in this championship.");
  const reason = readReason(formData, action);

  let changed: boolean | null = null;
  try {
    changed = await championshipStore.setGameStatus({ eventId: c.id, gameSlug: game.slug, action, actorEmail: email, reason });
  } catch (error) {
    console.error(`[championship] ${action} ${game.slug} failed`, error);
  }
  if (changed === null) back("error", `Could not change ${game.title} (database error).`);
  if (!changed) back("error", `${game.title} was not in a state that action applies to; the page was stale.`);
  revalidatePath(PATH);
  back("ok", `${game.title}: board ${GAME_DONE[action]}.`);
}

const EVENT_DONE: Record<EventAction, string> = {
  suspend: "Suspended. No runs are accepted until you resume.",
  resume: "Resumed.",
  "close-early": "Closed early. Runs already started have the finishing grace.",
  reopen: "Reopened.",
  "start-verification": "Verification started. Submissions are closed; review the flagged runs, then finalise.",
  archive: "Archived.",
};

export async function eventAction(formData: FormData): Promise<void> {
  const { email } = await requireRole(SITE_WRITE_ROLE);
  const c = readChampionship(formData);
  const action = String(formData.get("action") ?? "") as EventAction;
  if (!EVENT_ACTIONS.includes(action)) back("error", "Unknown event action.");
  const reason = readReason(formData, action);

  let outcome: { ok: true } | { ok: false; why: string } | null = null;
  try {
    const snap = await championshipStore.readEvent(c.id);
    if (!snap) {
      outcome = { ok: false, why: "The championship tables are missing. Apply migration 048." };
    } else {
      const allowed = eventActionAllowed(c, snap.state, snap.nowMs, action, 0);
      outcome = !allowed.ok
        ? allowed
        : (await championshipStore.setEventState({ eventId: c.id, action, actorEmail: email, reason }))
          ? { ok: true }
          : { ok: false, why: "Nothing changed; the page was stale." };
    }
  } catch (error) {
    console.error(`[championship] ${action} failed`, error);
  }
  if (!outcome) back("error", "Could not change the event (database error).");
  if (!outcome.ok) back("error", outcome.why);
  revalidatePath(PATH);
  back("ok", EVENT_DONE[action]);
}

const REVIEW_DONE: Record<ReviewAction, string> = {
  "approve-run": "approved; it now ranks",
  "disqualify-run": "disqualified",
  "reinstate-run": "reinstated; it ranks again",
};

export async function reviewAction(formData: FormData): Promise<void> {
  const { email, playerId } = await requireRole(SITE_WRITE_ROLE);
  const c = readChampionship(formData);
  const action = String(formData.get("action") ?? "") as ReviewAction;
  if (!(action in REVIEW_TRANSITIONS)) back("error", "Unknown review action.");
  const runId = readRunId(formData);
  const reason = readReason(formData, action);

  let changed: boolean | null = null;
  try {
    changed = await championshipStore.reviewRun({
      eventId: c.id,
      runId,
      action,
      actorEmail: email,
      actorPlayerId: playerId ?? null,
      reason,
    });
  } catch (error) {
    console.error(`[championship] ${action} #${runId} failed`, error);
  }
  if (changed === null) back("error", `Could not review run #${runId} (database error).`);
  if (!changed) {
    back("error", `Run #${runId} was not changed: it is not in a state that action applies to, it is your own run, or the results are final.`);
  }
  revalidatePath(PATH);
  back("ok", `Run #${runId} ${REVIEW_DONE[action]}.`);
}

/**
 * Freeze the result: the full public table plus who earns which reward,
 * public ids only. Refused while any run waits for review (checked here for the
 * message, and again inside the finalising statement so a run flagged a moment
 * ago cannot slip past).
 */
export async function finaliseAction(formData: FormData): Promise<void> {
  const { email } = await requireRole(SITE_WRITE_ROLE);
  const c = readChampionship(formData);

  let outcome: { ok: true; winners: number } | { ok: false; why: string } | null = null;
  try {
    const snap = await championshipStore.readEvent(c.id);
    if (!snap) {
      outcome = { ok: false, why: "The championship tables are missing." };
    } else {
      const counts = await championshipStore.runCounts(c.id);
      const allowed = eventActionAllowed(c, snap.state, snap.nowMs, "finalise", counts.flagged);
      if (!allowed.ok) {
        outcome = allowed;
      } else {
        const standings = await computeStandings(c, snap);
        const awards = awardsFrom(c, standings);
        const snapshot = {
          ...toPublicStandings(standings, { board: 10_000, overall: 10_000 }),
          phase: "finalised" as const,
          awards: publicAwards(awards),
        };
        outcome = (await championshipStore.finalise({ eventId: c.id, actorEmail: email, snapshot }))
          ? { ok: true, winners: awards.length }
          : { ok: false, why: "Not finalised: a run was flagged meanwhile, or the event left verification." };
      }
    }
  } catch (error) {
    console.error("[championship] finalise failed", error);
  }
  if (!outcome) back("error", "Could not finalise (database error).");
  if (!outcome.ok) back("error", outcome.why);
  revalidatePath(PATH);
  revalidatePath("/fright-fest");
  // Pay straight away. A failure here does not undo the result: the banner says
  // so, and "Grant rewards" finishes the job (every grant is idempotent).
  const paid = await payRewards(c, email);
  back("ok", `Final. ${paid.line}`);
}

/** Pay the frozen result's rewards and log the run. Never throws; returns a banner line and whether all went well. */
async function payRewards(c: ChampionshipConfig, actorEmail: string): Promise<{ ok: boolean; line: string }> {
  let report: RewardsReport | { error: "not-final" } | null = null;
  try {
    report = await payChampionshipRewards(c, {
      finalStandings: championshipStore.finalStandings,
      internalIds: championshipStore.internalIds,
      grantPack: collectiblesStore.grantPack,
    });
  } catch (error) {
    console.error("[championship] grant rewards failed", error);
  }
  if (!report) return { ok: false, line: "Rewards could not be granted (database error). Press Grant rewards to try again." };
  if ("error" in report) return { ok: false, line: "Nothing to grant: the results are not final." };
  try {
    await championshipStore.logAction({ eventId: c.id, actorEmail, action: "grant-rewards", reason: null, data: report });
  } catch (error) {
    console.error("[championship] logging the rewards run failed", error);
  }
  return { ok: report.failed === 0 && report.unknownPack === 0, line: `Rewards: ${describeRewards(report)}` };
}

/** Grant (or finish granting) a finalised championship's reward packs. Safe to press again. */
export async function grantRewardsAction(formData: FormData): Promise<void> {
  const { email } = await requireRole(SITE_WRITE_ROLE);
  const c = readChampionship(formData);
  const { ok, line } = await payRewards(c, email);
  revalidatePath(PATH);
  back(ok ? "ok" : "error", line);
}
