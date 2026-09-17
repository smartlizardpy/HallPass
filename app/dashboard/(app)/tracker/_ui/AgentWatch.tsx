"use client";

/**
 * Which tracker items an agent is working on right now, live.
 *
 * The tracker half of what `beta/_ui/AgentActivityFeed.tsx` does for the bug
 * queue, and it makes the same arguments; read that file's docblock for the
 * ones not repeated here. `tracker-mcp-design.md` §5 is the full version.
 *
 * ── ONE PROVIDER, NOT ONE ISLAND PER CARD ──────────────────────────────────
 * The board renders tens of cards and every one of them could ask "is the agent
 * on me". As tens of polling islands that is tens of POSTs every ten seconds
 * for one answer, so instead this is a Client Component taking `children` — the
 * shape Next's own Server-and-Client-Components guide gives for context — and
 * the server-rendered lanes pass straight through it. {@link AgentBadge} and
 * {@link AgentBanner} read what it polls. One request, whatever is on the
 * board.
 *
 * ── WHAT THE MARKER MEANS ──────────────────────────────────────────────────
 * "A line about this item was written within the idle window", NOT "this item
 * is in the Building lane". The lane is a claim about the work and is already
 * said by the chip and the column; this is a claim about right now. It goes out
 * three ways, all decided on the server: the agent calls
 * `finish_agent_activity`, its run goes quiet for the idle window, or a newer
 * run replaces it.
 *
 * Its honest limitation, stated because somebody will notice it before they
 * find the design doc: it tracks what the agent SAYS. An agent that moves an
 * item to Building and then writes code in silence stops being marked while
 * still building. The transport is stateless, so silence is all there is to go
 * on, and the tool descriptions ask for a line per step precisely because of
 * it.
 *
 * ── A FAILED POLL KEEPS THE LAST STATE ─────────────────────────────────────
 * Not "hides the marker". An empty answer means "no agent is working", so a
 * network hiccup rendered as empty would say the agent had stopped — the one
 * thing this must never say by accident.
 */

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TrackerAgentActivity } from "@/app/lib/beta";
import { trackerAgentActivityAction } from "../actions";

/** How often to re-read while the tab is in the foreground. */
const POLL_MS = 10_000;

/** Anything newer than this is "now" rather than a duration. */
const JUST_NOW_MS = 45_000;

type Watch = {
  byItem: Map<number, TrackerAgentActivity>;
  /** Null until mounted — see {@link since}. */
  now: number | null;
};

/**
 * Empty by default, so a marker rendered outside a provider is simply absent
 * rather than a crash. The consumers are meant to be droppable into any card.
 */
const WatchContext = createContext<Watch>({ byItem: new Map(), now: null });

/**
 * "just now" / "4m ago" / "2h ago".
 *
 * `now` comes from the context and is null until mount, for the reason the
 * feed's own `since` gives: reading the clock during render is impure, and a
 * relative label computed on the server is a hydration mismatch waiting for a
 * minute boundary.
 */
function since(iso: string, now: number | null): string {
  const then = new Date(iso).getTime();
  if (now == null || Number.isNaN(then)) return "";
  const ms = Math.max(0, now - then);
  if (ms < JUST_NOW_MS) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function AgentWatch({
  initial,
  children,
}: {
  /** Rendered by the page, so the markers are right before any JavaScript is. */
  initial: TrackerAgentActivity[];
  children: ReactNode;
}) {
  const [rows, setRows] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  // Re-seed whenever the page itself re-renders — after a move, say — so a
  // fresh server render and a poll cannot disagree about what is live.
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
          const next = await trackerAgentActivityAction();
          if (!cancelled) setRows(next);
        } catch {
          // Deliberately silent, and deliberately not `setRows([])`. The action
          // logs server-side; keeping the last markers is the honest
          // degradation — see the docblock.
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

  const value = useMemo<Watch>(
    () => ({ byItem: new Map(rows.map((row) => [row.itemId, row])), now }),
    [rows, now],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}

/** What the agent last said about this item, or `null` if it is not on it. */
function useAgentOn(itemId: number): { line: TrackerAgentActivity; now: number | null } | null {
  const { byItem, now } = useContext(WatchContext);
  const line = byItem.get(itemId);
  return line ? { line, now } : null;
}

/**
 * The green dot on a board card.
 *
 * Renders NOTHING when no agent is on this item, which is almost always — a
 * permanent "no agent" slot on every card would be clutter on the one screen
 * whose job is to be scannable.
 *
 * `motion-safe:` on the pulse: this is the only animated thing on the
 * dashboard, and it should not animate for somebody who asked their OS for no
 * animation.
 */
export function AgentBadge({ itemId }: { itemId: number }) {
  const watching = useAgentOn(itemId);
  if (!watching) return null;
  const { line, now } = watching;

  return (
    <span
      // The agent's own last words, for anyone who wants to know what "working"
      // means right now. A tooltip rather than a line, because a card has to
      // stay one glance wide.
      title={`${line.summary}${now ? ` · ${since(line.createdAt, now)}` : ""}`}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-900 dark:text-emerald-200"
    >
      <span className="inline-block size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
      Agent working
    </span>
  );
}

/**
 * The same fact, on the item's own page, where there is room to say what the
 * agent is actually doing.
 *
 * A banner rather than a chip because this page is opened BY somebody asking
 * "where is this", and "an agent is on it, and here is its last line" is the
 * whole answer.
 */
export function AgentBanner({ itemId }: { itemId: number }) {
  const watching = useAgentOn(itemId);
  if (!watching) return null;
  const { line, now } = watching;
  const age = since(line.createdAt, now);

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-black uppercase tracking-wide text-emerald-900 dark:text-emerald-200">
        <span className="inline-block size-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
        Agent working on this
      </span>
      {/* Written by a model and rendered as a plain string child, so React
          escapes it. */}
      <span className="min-w-0 flex-1 text-sm text-emerald-900 dark:text-emerald-200">{line.summary}</span>
      <span className="shrink-0 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
        {[line.actor, age].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}
