"use client";

/**
 * What the bug-MCP agent is doing, live, on `/dashboard/beta`.
 *
 * The MCP's closing tools DELETE the report they act on and pay the tester from
 * the XP ledger, which is deliberate (`bug-mcp-design.md` §3) and has a
 * consequence this panel exists to fix: after an agent has worked the queue, the
 * dashboard is missing exactly the rows that would have explained what happened
 * to it. `agent-activity-design.md` is the whole argument.
 *
 * ── WHY A CLIENT ISLAND THAT POLLS ─────────────────────────────────────────
 * Watching an agent work is the point; a panel that needs a reload is a panel
 * you read after the fact. Same shape as `moderation/_ui/OpenReportBadge`, for
 * the same reasons: it calls a Server Function, which does NOT re-render the
 * calling page, so a poll costs one POST and a twenty-row read rather than
 * re-rendering a dashboard that also holds the roster, both queues and every
 * assignment. The timer skips hidden tabs, so a dashboard left open in a
 * background tab all day makes no queries at all.
 *
 * SEEDED FROM THE SERVER. `initial` is rendered by the page, so the panel is
 * correct before any JavaScript runs and correct if none ever does.
 *
 * ── IT RENDERS THE SECTION, AND RENDERS NOTHING WHEN EMPTY ─────────────────
 * Both halves are deliberate. A permanently empty "Agent activity" card on a
 * deployment with no `MCP_SECRET` set is exactly the clutter the rest of this
 * page just lost. And because the island owns the section rather than sitting
 * inside one, the panel APPEARS on the poll that first sees a line — an operator
 * who starts an agent while watching the dashboard sees it arrive, which is the
 * entire point of polling.
 *
 * ── EMPTY MEANS NO AGENT IS RUNNING ────────────────────────────────────────
 * The read answers nothing once a run is over: the agent called
 * `finish_agent_activity`, which deletes the run, or nothing has been written
 * for the idle window (`agent-activity-design.md` §11). So the panel
 * DISAPPEARS on the first poll after an agent stops, and the next agent's first
 * line brings it back holding only its own run. That is decided on the server,
 * by the database's clock; this component never hides a run on its own
 * reckoning.
 *
 * A FAILED POLL KEEPS THE LAST ROWS. Flashing the panel away would read as "the
 * agent stopped", which is the one thing this panel must never say by accident
 * — and now that disappearing is exactly how it says so, the poll's Server
 * Function throws on a database error rather than answering `[]`.
 */

import { startTransition, useEffect, useState } from "react";
import type { AgentActivity } from "@/app/lib/beta";
import { agentActivityAction } from "../actions";

/** How often to re-read while the tab is in the foreground. */
const POLL_MS = 10_000;

/** Anything newer than this is "now" rather than a duration. */
const JUST_NOW_MS = 45_000;

/**
 * Tones for the three outcomes, following the chip convention used across the
 * beta surfaces: a light tint with dark same-hue text, never a saturated fill.
 *
 * `refused` is amber and not red on purpose. It is not an error — the tool
 * declined the call, in words, usually because somebody else got to the report
 * first — and colouring it as a failure would have an operator chasing a bug
 * that is a race the design already handles.
 */
const OUTCOME_TONES: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-900",
  refused: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-900",
};

/**
 * "just now" / "4m ago" / "2h ago" / "3d ago".
 *
 * `now` is passed IN rather than read here, and is null until the component has
 * mounted. Two reasons, and they point the same way: reading the clock during
 * render is impure (the React Compiler's lint rule says so, and it is right —
 * the same render would produce different output on a replay), and a relative
 * label computed on the server is a hydration mismatch waiting for a minute
 * boundary. So the server renders the line without an age and the browser fills
 * it in on mount, which is one frame later and never wrong.
 */
function since(iso: string, now: number | null): string {
  const then = new Date(iso).getTime();
  if (now == null || Number.isNaN(then)) return "";
  const ms = Math.max(0, now - then);
  if (ms < JUST_NOW_MS) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AgentActivityFeed({
  initial,
  titles,
  idleMinutes,
}: {
  initial: AgentActivity[];
  /** slug → game title, for the rows that name a game. */
  titles: Record<string, string>;
  /**
   * How long a quiet run lasts before the server stops returning it, for the
   * footer's wording only. A prop, like `titles`: the page already has it, and
   * the decision itself is the server's.
   */
  idleMinutes: number;
}) {
  const [rows, setRows] = useState(initial);
  // Null until mounted — see `since`. Advanced by the same tick that re-reads,
  // so the ages keep moving while the tab is watched.
  const [now, setNow] = useState<number | null>(null);
  // Re-read from the server's props whenever the page itself re-renders (after
  // a triage action, say), so a fresh page load and a poll cannot disagree.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setRows(initial);
  }

  useEffect(() => {
    // `cancelled` rather than an AbortController: a Server Function call is not
    // an abortable fetch we own, so the best we can do is refuse to write a
    // stale read into state after unmount.
    let cancelled = false;

    const read = () => {
      setNow(Date.now());
      startTransition(async () => {
        try {
          const next = await agentActivityAction();
          if (!cancelled) setRows(next);
        } catch {
          // Deliberately silent. The action logs server-side, and the last known
          // rows staying on screen is the honest degradation — see the docblock.
        }
      });
    };

    // One guard serves both triggers: the timer must skip hidden tabs, and the
    // visibility listener fires on hide as well as on show.
    const readIfVisible = () => {
      if (document.visibilityState === "visible") read();
    };

    read();

    const timer = window.setInterval(readIfVisible, POLL_MS);
    document.addEventListener("visibilitychange", readIfVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", readIfVisible);
    };
  }, []);

  if (rows.length === 0) return null;

  const latest = rows[0];

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
          Agent activity
        </h2>
        <span className="text-xs text-muted">
          {latest.actor}
          {now != null && <> · {since(latest.createdAt, now)}</>}
        </span>
      </div>

      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-border px-3 py-2"
          >
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                OUTCOME_TONES[row.outcome] ?? "bg-surface-2 text-zinc-700"
              }`}
            >
              {row.outcome}
            </span>
            {/* Written by the agent, rendered as a plain string child so React
                escapes it. The narration tool takes free text from a model. */}
            {/* The tool name is the thing you want the moment a line looks
                wrong and clutter every other moment, so it is a tooltip rather
                than a column. */}
            <span
              title={row.tool}
              className="min-w-0 flex-1 text-sm font-semibold text-zinc-900"
            >
              {row.summary}
            </span>
            {/* Joined rather than three conditional fragments each carrying
                its own separator: the age is empty until mount, and a hardcoded
                " · " after it leaves a dangling dot on the first paint. */}
            <span className="shrink-0 text-[11px] font-semibold text-muted">
              {[
                row.reportId != null ? `#${row.reportId}` : null,
                row.slug ? (titles[row.slug] ?? row.slug) : null,
                since(row.createdAt, now),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>

      {/* Says the panel is live, so an operator does not sit reloading a page
          that is already refreshing itself — and says when it will go, so its
          disappearing reads as "the agent stopped" rather than as a fault. */}
      <p className="mt-2 text-[11px] font-semibold text-muted">
        Newest first · refreshes every {POLL_MS / 1000}s while this tab is open ·
        closes when the agent finishes or after {idleMinutes} quiet minutes
      </p>
    </section>
  );
}
