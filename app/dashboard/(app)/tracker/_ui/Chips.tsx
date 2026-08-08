/**
 * Tracker chips — the status pill and the tag pill.
 *
 * Server components, no client hooks, mirroring `beta/_ui/Chips.tsx`. The colour
 * per status comes from `STATUS_CHIP_CLASS` in the tracker config rather than
 * being written here, so the board, the cards and the detail page cannot end up
 * disagreeing about what "building" looks like.
 *
 * The classes are spelled out in full in that config, not composed from a tone
 * name: Tailwind v4 scans source text for class names, so a template-built
 * `bg-${tone}-100` never reaches the output CSS and renders as an unstyled pill.
 */

import Link from "next/link";
import {
  STATUS_CHIP_CLASS,
  STATUS_LABEL,
  type TrackerStatus,
} from "@/app/lib/tracker/config";

/**
 * The dashboard's primary button, copied from `beta/page.tsx` so the tracker
 * does not introduce a second button style to a surface that already has one.
 */
export const PRIMARY_BUTTON =
  "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600";

/** The quieter sibling, for submits that sit inside a form row. */
export const SECONDARY_BUTTON =
  "rounded-full border border-border px-4 py-1.5 text-xs font-extrabold text-foreground transition hover:bg-surface-2";

export function StatusChip({ status }: { status: TrackerStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CHIP_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * One tag. A link when `href` is given, plain text otherwise.
 *
 * Rendering it as a link is what makes the filter discoverable: the way you find
 * everything tagged `pwa` is by clicking `pwa` on a card you are already looking
 * at, not by finding a filter control first.
 */
export function TagChip({ tag, href }: { tag: string; href?: string }) {
  const className =
    "inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-muted";
  if (!href) return <span className={className}>{tag}</span>;
  return (
    <Link href={href} className={`${className} hover:text-foreground`}>
      {tag}
    </Link>
  );
}

/**
 * A banner for the `?ok=` / `?error=` query the actions redirect back with.
 *
 * Renders nothing when neither is present. The message is untrusted by
 * construction — it arrives in the URL and anybody can edit it — so it is
 * rendered as text, never as markup.
 */
export function ResultBanner({
  ok,
  error,
}: {
  ok?: string;
  error?: string;
}) {
  if (!ok && !error) return null;
  const isError = Boolean(error);
  return (
    <p
      role="status"
      className={
        isError
          ? "rounded-lg bg-rose-100 px-3 py-2 text-sm font-bold text-rose-800"
          : "rounded-lg bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-800"
      }
    >
      {isError ? error : ok}
    </p>
  );
}
