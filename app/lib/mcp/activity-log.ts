/**
 * HallPass — writing the bug MCP's activity feed.
 *
 * The SERVER-ONLY half beside the pure `activity.ts`, exactly as `bugs.ts` sits
 * beside `report-view.ts`: this module reaches the live store, so it is the one
 * that must never reach a client bundle. The part worth unit-testing — what the
 * operator actually reads — is next door and free of `server-only`.
 *
 * ── LOGGING NEVER FAILS A TOOL CALL ────────────────────────────────────────
 * This is the load-bearing property of this file, and the reason it is three
 * lines wrapped in a try. Schema here is applied BY HAND (`scoreboard/
 * migrations/`), so there is always a window where the code is live against a
 * database that has no `beta_agent_activity` yet — and an agent that could not
 * close a bug because the FEED table was missing would be a feature breaking the
 * thing it was built to observe. Migration 033 widened that window rather than
 * closing it: a deployment carrying the tracker tools against a database
 * without `tracker_item_id` logs nothing and goes on working, which is why that
 * column is an addition to this table rather than a table of its own.
 *
 * Same reasoning as `beta/index.ts`'s fail-soft reads, with the failure
 * swallowed one layer lower because the caller here is a tool handler with
 * nowhere sensible to put the news.
 *
 * It is still LOGGED. A trail that silently stopped recording would look exactly
 * like an agent that had stopped working, which is the one confusion this whole
 * feature exists to prevent.
 *
 * ── THE ADMINS ARE TOLD, ONCE PER RUN ──────────────────────────────────────
 * The panel this file feeds answers "what is it doing" for somebody already
 * watching, and nothing answered "is anything running?" for the operator who
 * left an agent going and went out — which is the case the feed exists for
 * (`agent-activity-design.md` §12). So the line that STARTS a run sends a
 * notification, and so does the tool that ends one. Both are two catalogue
 * entries and a `notifyAdmins` call: no new transport, and the admin roster,
 * the per-admin preferences and the Web Push all come from the module that
 * already owns them.
 *
 * ── NOTHING IS REVALIDATED HERE ────────────────────────────────────────────
 * Deliberate, and the opposite of what `bugs.ts` does after a write. The panel
 * polls (`agent-activity-design.md` §5), so it picks a new line up within
 * seconds on its own — while `revalidatePath` on every read tool would throw the
 * whole dashboard's cache away several times a minute for a feed that is already
 * live. The DECISIONS still revalidate, in `bugs.ts`, where they belong.
 */

import "server-only";
import { beta } from "@/app/lib/beta";
import { notifyAdmins } from "@/app/lib/notifications/deliver";
import { agentFinishedCopy, agentStartedCopy } from "@/app/lib/notifications/copy";
import type { ActivityLine } from "./activity";
import { ACTIVITY_IDLE_MINUTES, ACTIVITY_RETENTION_DAYS, mcpActor } from "./config";

/**
 * The one tool whose summary is the agent's OWN sentence rather than a
 * description built from a tool call's arguments.
 *
 * `describeToolCall` writes every other line, and those embed the thing they
 * are about — including the title a tester typed on a bug report. The run-start
 * notification is a candidate lock-screen banner, so it quotes this line and no
 * other (`agent-activity-design.md` §12, and `copy.ts`'s rule for admin kinds).
 */
const NARRATION_TOOL = "log_agent_activity";

/**
 * Tell every current admin that an agent has started, once per run.
 *
 * Fail-soft twice over. `notifyAdmins` swallows its own errors by design —
 * delivery must never fail the thing that triggered it — and this whole call
 * sits inside {@link recordActivity}'s try, so neither an unreachable roster
 * nor a missing VAPID key can cost the agent a tool call.
 *
 * AWAITED rather than left as a floating promise. This is a serverless
 * function: a promise nobody holds is a promise the platform may kill when the
 * response is sent, and this runs once per RUN rather than once per call, so
 * the round trip is not worth the risk of never sending it.
 */
async function announceStart(line: ActivityLine): Promise<void> {
  await notifyAdmins({
    kind: "agent_started",
    copy: agentStartedCopy({
      note: line.tool === NARRATION_TOOL ? line.summary : null,
    }),
    // One per run, and a run has no id (`agent-activity-design.md` §11). The
    // actor and the minute are enough: two agents starting within the same
    // minute on the same key are one run as far as this feed is concerned,
    // which is exactly what §11 says about them sharing it.
    dedupeKey: `agent-start:${mcpActor()}:${new Date().toISOString().slice(0, 16)}`,
  });
}

/** Append one line to the feed. Never throws. */
export async function recordActivity(line: ActivityLine): Promise<void> {
  try {
    const { started } = await beta.logAgentActivity({
      actor: mcpActor(),
      tool: line.tool,
      outcome: line.outcome,
      reportId: line.reportId,
      trackerItemId: line.itemId,
      slug: line.slug,
      summary: line.summary,
      retainDays: ACTIVITY_RETENTION_DAYS,
      idleMinutes: ACTIVITY_IDLE_MINUTES,
    });
    if (started) await announceStart(line);
  } catch (error) {
    console.error(`mcp activity log failed for ${line.tool}:`, error);
  }
}

/**
 * Delete the whole feed, because the agent has finished. Answers how many lines
 * went.
 *
 * THROWS, unlike {@link recordActivity}. Clearing is the entire job of the tool
 * that calls this, so a failure has to reach the agent as an error — and the
 * feed as a `failed` line, which the wrapper in `server.ts` writes — rather than
 * being swallowed into a "finished" that left every line on the panel.
 */
export async function clearActivity(): Promise<number> {
  const cleared = await beta.clearAgentActivity();
  // AFTER the delete, and outside its failure. A "the agent has finished" that
  // went out while the panel still showed a live run would be the one thing
  // §5 says this surface must never say by accident — so the notification
  // follows the clear, and a clear that threw never reaches it.
  await notifyAdmins({
    kind: "agent_finished",
    copy: agentFinishedCopy({ steps: cleared }),
    // Keyed on the run's SIZE as well as the minute, so a second finish
    // moments after the first — which clears nothing — cannot be mistaken for
    // the same event and swallowed.
    dedupeKey: `agent-finish:${mcpActor()}:${new Date().toISOString().slice(0, 16)}:${cleared}`,
  });
  return cleared;
}
