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
 * thing it was built to observe. Same reasoning as `beta/index.ts`'s fail-soft
 * reads, with the failure swallowed one layer lower because the caller here is a
 * tool handler with nowhere sensible to put the news.
 *
 * It is still LOGGED. A trail that silently stopped recording would look exactly
 * like an agent that had stopped working, which is the one confusion this whole
 * feature exists to prevent.
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
import type { ActivityLine } from "./activity";
import { ACTIVITY_IDLE_MINUTES, ACTIVITY_RETENTION_DAYS, mcpActor } from "./config";

/** Append one line to the feed. Never throws. */
export async function recordActivity(line: ActivityLine): Promise<void> {
  try {
    await beta.logAgentActivity({
      actor: mcpActor(),
      tool: line.tool,
      outcome: line.outcome,
      reportId: line.reportId,
      slug: line.slug,
      summary: line.summary,
      retainDays: ACTIVITY_RETENTION_DAYS,
      idleMinutes: ACTIVITY_IDLE_MINUTES,
    });
  } catch (error) {
    console.error(`mcp activity log failed for ${line.tool}:`, error);
  }
}
