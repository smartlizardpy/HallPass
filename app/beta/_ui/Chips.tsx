/**
 * HallPass beta — the small status pills shared by the tester and admin views.
 *
 * ONE definition per vocabulary, imported by both sides. When a tester sees
 * "Major" amber on their report and an admin sees the same word in a different
 * colour on the queue, they stop trusting that they are looking at the same
 * thing — and the two surfaces are edited months apart by definition.
 *
 * Server components: these are pure functions of their props with no state, so
 * there is nothing to hydrate. `_ui` is a private folder (underscore prefix), so
 * none of this is routable.
 *
 * Tones follow `BadgeShelf`'s convention — a light tinted background with a dark
 * same-hue text colour, never a saturated fill. The palette is deliberately the
 * one already used across the site (`brand`, `amber`, `emerald`, `sky`, plus
 * Tailwind's `red`/`zinc`), so nothing here introduces a new colour.
 */

import type {
  AssignmentStatus,
  BugSeverity,
  ReportKind,
  ReportStatus,
  ShotStatus,
} from "@/app/lib/beta/config";

/** The one pill shape used everywhere. Sizing matches the site's other chips. */
const PILL =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide";

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`${PILL} ${tone}`}>{children}</span>;
}

/**
 * Severity, coloured by how much it hurts.
 *
 * Ascending heat (zinc → sky → amber → red) so a queue can be triaged by glance
 * alone. Red is reserved for `blocker`; using it for `major` too would leave the
 * genuinely unplayable case with nothing louder to escalate to.
 */
const SEVERITY_TONES: Record<BugSeverity, string> = {
  cosmetic: "bg-surface-2 text-zinc-700",
  minor: "bg-sky-50 text-sky-900",
  major: "bg-amber-100 text-amber-900",
  blocker: "bg-red-100 text-red-900",
};

export function SeverityChip({ severity }: { severity: BugSeverity }) {
  return <Pill tone={SEVERITY_TONES[severity]}>{severity}</Pill>;
}

/**
 * Triage state.
 *
 * `open` carries the brand colour rather than a neutral because it is the only
 * state that needs someone to DO something — it should pull the eye on a queue
 * that is mostly resolved.
 */
const REPORT_STATUS_TONES: Record<ReportStatus, string> = {
  open: "bg-brand-50 text-brand",
  accepted: "bg-emerald-50 text-emerald-900",
  rejected: "bg-surface-2 text-zinc-600",
  duplicate: "bg-surface-2 text-zinc-600",
};

export function ReportStatusChip({ status }: { status: ReportStatus }) {
  return <Pill tone={REPORT_STATUS_TONES[status]}>{status}</Pill>;
}

/** Bug vs feature request. Neutral on purpose — it is a category, not a state. */
export function KindChip({ kind }: { kind: ReportKind }) {
  return (
    <Pill tone={kind === "bug" ? "bg-red-50 text-red-900" : "bg-sky-50 text-sky-900"}>
      {kind === "bug" ? "Bug" : "Idea"}
    </Pill>
  );
}

const ASSIGNMENT_STATUS_TONES: Record<AssignmentStatus, string> = {
  assigned: "bg-brand-50 text-brand",
  in_progress: "bg-amber-100 text-amber-900",
  submitted: "bg-emerald-50 text-emerald-900",
  closed: "bg-surface-2 text-zinc-600",
};

/** Underscores never reach the screen; `in_progress` reads as "In progress". */
const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned: "To do",
  in_progress: "In progress",
  submitted: "Submitted",
  closed: "Closed",
};

export function AssignmentStatusChip({ status }: { status: AssignmentStatus }) {
  return (
    <Pill tone={ASSIGNMENT_STATUS_TONES[status]}>
      {ASSIGNMENT_STATUS_LABELS[status]}
    </Pill>
  );
}

const SHOT_STATUS_TONES: Record<ShotStatus, string> = {
  pending: "bg-brand-50 text-brand",
  accepted: "bg-emerald-50 text-emerald-900",
  rejected: "bg-surface-2 text-zinc-600",
};

export function ShotStatusChip({ status }: { status: ShotStatus }) {
  return <Pill tone={SHOT_STATUS_TONES[status]}>{status}</Pill>;
}

/**
 * An XP amount, always signed with a `+`.
 *
 * Only ever renders a positive number: awards are append-only and the amount
 * column is CHECK'd `>= 0`, so a minus sign here would be a lie about how the
 * ledger works.
 */
export function XpChip({ amount }: { amount: number }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-accent-yellow/20 px-2.5 py-0.5 text-[11px] font-black tabular-nums text-amber-900">
      +{amount.toLocaleString("en-US")} XP
    </span>
  );
}
