/**
 * HallPass — turning a `beta_reports` row into something an agent can read.
 *
 * PURE and free of `server-only`, like `growth/content-rules.ts`: it maps
 * already-fetched rows and decides nothing about the database, so it unit-tests
 * in the plain `node` environment. `bugs.ts` is the half that reads and writes.
 *
 * ── WHY A DELIBERATE WIRE SHAPE AND NOT `JSON.stringify(row)` ──────────────
 * Returning the row verbatim would be less code and would leak two things that
 * have no business in an agent's context.
 *
 * The first is blob PATHS. `clipBlobPath` and `shotBlobPath` are storage keys
 * kept so the resolve path can delete the evidence; the URLs beside them are
 * what a reader actually uses. A key is not more useful than a URL to anybody
 * reading a bug, and handing out the write-side addressing of a bucket holding
 * children's screen recordings is a thing to do on purpose or not at all.
 *
 * The second is SIZE. `errorLog` is capped but can still be kilobytes, and the
 * summary shape exists so listing the queue does not pay for every row's stack
 * traces. Detail is a second call.
 *
 * ── THE READER IS A LANGUAGE MODEL ─────────────────────────────────────────
 * Which changes two things about the shape. Field names are spelled out rather
 * than abbreviated, because they are read as English and never as a schema. And
 * `severity` is left null on features rather than being defaulted to something
 * printable — a model shown `severity: "minor"` on a feature request will
 * cheerfully reason about how minor it is.
 */

import type { BugSeverity, ReportKind, ReportStatus } from "@/app/lib/beta/config";
import type { BetaReport, BetaReportWithAuthor } from "@/app/lib/beta/store";

/**
 * One entry from a game's own error log.
 *
 * Every field is optional because this JSON was produced by a game's runtime
 * inside an iframe and stored as TEXT — `beta/schema.sql` says so, and says why:
 * "a malformed payload should degrade to 'no errors shown' rather than fail the
 * insert and lose what the tester typed". The same posture applies to reading it
 * back.
 */
export type GameError = {
  at?: number;
  source?: string;
  kind?: string;
  message?: string;
  stack?: string;
  file?: string;
  line?: number;
  count?: number;
};

/**
 * Parse the stored error log, degrading to an empty list on anything unexpected.
 *
 * NEVER THROWS, and that is the whole contract. This text arrives from a game's
 * own runtime; a single corrupt payload must not be able to fail the tool call
 * that was listing the queue, because the report behind it is exactly the one
 * somebody needs to see. `page.tsx`'s `ErrorList` makes the same trade for the
 * same reason, and its comment says a corrupt report "would otherwise hide every
 * other report waiting behind it".
 *
 * A non-array payload is dropped rather than wrapped: the writer stringifies an
 * array, so anything else is corruption and guessing at its shape would invent
 * errors that were never reported.
 */
export function parseErrorLog(raw: string | null): GameError[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GameError[]) : [];
  } catch {
    return [];
  }
}

/**
 * The severity a decision should be recorded with.
 *
 * THE SAME RULE THE SERVER ACTIONS APPLY, lifted here so both callers and the
 * tests can see it:
 *
 *   * a FEATURE carries no severity, ever. The cross-field CHECK
 *     (`beta_reports_severity_matches_kind`) rejects one, so passing a stray
 *     value through would turn a caller's mistake into a 500.
 *   * a BUG keeps the tester's own severity unless the caller overrides it. The
 *     override wins because triage is exactly the moment somebody corrects a
 *     tester who called their own find a blocker — a reporter should not set
 *     their own payout.
 */
export function resolveSeverity(
  report: { kind: ReportKind; severity: BugSeverity | null },
  override: BugSeverity | null | undefined,
): BugSeverity | null {
  if (report.kind !== "bug") return null;
  return override ?? report.severity;
}

/** A queue row: enough to choose what to work on, and nothing more. */
export type ReportSummary = {
  id: number;
  slug: string;
  kind: ReportKind;
  severity: BugSeverity | null;
  status: ReportStatus;
  title: string;
  /** How many errors the game itself threw. The strongest "this is real" signal. */
  errorCount: number;
  hasClip: boolean;
  hasScreenshot: boolean;
  createdAt: string;
};

/** A queue row plus everything needed to actually reproduce and fix the bug. */
export type ReportDetail = ReportSummary & {
  body: string;
  device: string;
  errors: GameError[];
  /** Read-only URLs. The blob keys behind them are deliberately not exposed. */
  clipUrl: string | null;
  screenshotUrl: string | null;
  /** The tester's public handle, or null for an orphaned report. */
  author: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

export function toReportSummary(report: BetaReport): ReportSummary {
  return {
    id: report.id,
    slug: report.slug,
    kind: report.kind,
    severity: report.severity,
    status: report.status,
    title: report.title,
    errorCount: report.errorCount,
    // Booleans rather than the URLs: whether evidence EXISTS is what decides
    // which report to open, and the URLs themselves are detail-call weight.
    hasClip: Boolean(report.clipUrl),
    hasScreenshot: Boolean(report.shotUrl),
    createdAt: report.createdAt,
  };
}

/**
 * The author's display name, preferring the claimed username.
 *
 * `null` when the report is orphaned — `player_id` is `ON DELETE SET NULL`, so a
 * report can outlive its author. That is a real row with a real bug in it, so it
 * is reported with no author rather than hidden (`bug-mcp-design.md` §9).
 */
function authorLabel(report: BetaReportWithAuthor): string | null {
  return report.authorUsername ?? report.authorHandle ?? report.authorName ?? null;
}

export function toReportDetail(report: BetaReportWithAuthor): ReportDetail {
  return {
    ...toReportSummary(report),
    body: report.body,
    device: report.device,
    errors: parseErrorLog(report.errorLog),
    clipUrl: report.clipUrl,
    screenshotUrl: report.shotUrl,
    author: authorLabel(report),
    resolvedBy: report.resolvedBy,
    resolvedAt: report.resolvedAt,
  };
}
