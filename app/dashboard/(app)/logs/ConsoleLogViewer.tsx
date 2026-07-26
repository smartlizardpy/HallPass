"use client";

/**
 * Live viewer for the client-side console buffer (see
 * `app/lib/console-capture.ts`). Subscribes to the on-device ring buffer and
 * re-renders as new entries arrive, so a super admin can read `console.*`
 * output, uncaught errors, and the PostHog token warning on their phone without
 * opening devtools.
 *
 * The buffer only exists in the browser, so `useSyncExternalStore` renders the
 * empty server snapshot first (no hydration mismatch) and swaps to the live
 * client snapshot after hydration.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  clearConsoleLog,
  getConsoleLogEntries,
  subscribeConsoleLog,
  type ConsoleLevel,
} from "@/app/lib/console-capture";

type Filter = "all" | "error" | "warn" | "info";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "error", label: "Errors" },
  { key: "warn", label: "Warnings" },
  { key: "info", label: "Info" },
];

const LEVEL_STYLE: Record<ConsoleLevel, string> = {
  error: "bg-red-50 text-red-700 border-red-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  info: "bg-surface-2 text-muted border-border",
  log: "bg-surface-2 text-muted border-border",
  debug: "bg-surface-2 text-muted border-border",
};

function matchesFilter(level: ConsoleLevel, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "error") return level === "error";
  if (filter === "warn") return level === "warn";
  return level === "log" || level === "info" || level === "debug";
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ConsoleLogViewer() {
  // The buffer is an external store; subscribe to it directly. getServerSnapshot
  // returns a stable empty array so SSR renders the empty state, then the client
  // snapshot takes over after hydration.
  const entries = useSyncExternalStore(
    subscribeConsoleLog,
    getConsoleLogEntries,
    getConsoleLogEntries,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);

  // Newest first, filtered. Derived during render — no effect needed.
  const visible = useMemo(
    () =>
      entries.filter((e) => matchesFilter(e.level, filter)).slice().reverse(),
    [entries, filter],
  );

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const e of entries) {
      if (e.level === "error") errors++;
      else if (e.level === "warn") warnings++;
    }
    return { errors, warnings };
  }, [entries]);

  const handleCopy = async () => {
    const text = visible
      .slice()
      .reverse()
      .map((e) => `[${formatTime(e.ts)}] ${e.level.toUpperCase()} ${e.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const handleClear = () => {
    clearConsoleLog();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={
                filter === f.key
                  ? "rounded-full bg-brand px-3 py-1 text-xs font-bold text-white"
                  : "rounded-full border border-border bg-surface px-3 py-1 text-xs font-bold text-foreground hover:bg-surface-2"
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-bold text-foreground hover:bg-surface-2"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-bold text-foreground hover:bg-surface-2"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <span>
          <span className="font-bold text-foreground">{entries.length}</span>{" "}
          captured
        </span>
        <span>
          <span className="font-bold text-red-700">{counts.errors}</span> errors
        </span>
        <span>
          <span className="font-bold text-amber-700">{counts.warnings}</span>{" "}
          warnings
        </span>
        <span className="text-muted">Updates live · this device only</span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm font-semibold text-foreground">
            No console output captured yet.
          </p>
          <p className="mt-1 text-sm text-muted">
            Browse the site in this browser, then come back — warnings and errors
            logged on any page show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {visible.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-2.5">
              <span className="shrink-0 tabular-nums text-xs text-muted">
                {formatTime(e.ts)}
              </span>
              <span
                className={`h-fit shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${LEVEL_STYLE[e.level]}`}
              >
                {e.level}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                {e.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
