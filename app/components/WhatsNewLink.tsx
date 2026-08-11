/**
 * "What's New" link → the hosted ShipNote changelog for HallPass, opened in a new
 * tab. A pure presentational `<a>` (no client hooks), so the same component drops
 * into BOTH the client arcade header and the server dashboard layout. Two visual
 * variants: `header` (a compact pill that collapses to an icon on mobile) and
 * `sidebar` (a nav-style row for the dashboard).
 *
 * The two variants sit on different surfaces and must not be unified. The
 * dashboard rail is white, so `sidebar` is a bare row that only fills on hover.
 * `SiteHeader`'s bar is ALSO white now, so `header` fills with `bg-surface-2` —
 * it was `bg-white` + a shadow back when the bar was `--background`, and both of
 * those were doing the job `--surface-2` now does properly.
 *
 * The changelog URL is centralised here so both entry points stay in sync; update
 * it in one place if the ShipNote slug/domain ever changes.
 */

const WHATS_NEW_URL = "https://useshipnote.vercel.app/c/hallpass";

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 2.5l1.7 6.8 6.8 1.7-6.8 1.7L12 19.5l-1.7-6.8L3.5 11l6.8-1.7z" />
    </svg>
  );
}

export function WhatsNewLink({
  variant = "header",
}: {
  variant?: "header" | "sidebar";
}) {
  if (variant === "sidebar") {
    return (
      <a
        href={WHATS_NEW_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground transition hover:bg-surface-2"
      >
        <Sparkle className="h-4 w-4 text-brand" />
        What&apos;s New
      </a>
    );
  }
  // Header pill: icon + label on >= sm, icon-only on mobile to save space.
  //
  // THIS SHAPE IS TARGETED FROM OUTSIDE. `SiteHeader` wraps this pill and hides
  // the label for one more breakpoint band with a `[&>a>span]` child selector,
  // because the header's horizontal budget is the header's problem and not this
  // component's (the same pill in the dashboard rail has room to spare). That
  // selector depends on the structure directly below: an `<a>` whose only
  // `<span>` child is the label, with the sparkle an `<svg>` beside it. Wrap the
  // label in anything, or add a second `<span>` child, and the header silently
  // stops collapsing — grep for `[&>a>span]` before you reshape this.
  return (
    <a
      href={WHATS_NEW_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="What's New"
      aria-label="What's New"
      className="flex h-11 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-sm font-bold text-zinc-700 transition hover:text-brand sm:px-4"
    >
      <Sparkle className="h-[18px] w-[18px] text-brand" />
      <span className="hidden sm:inline">What&apos;s New</span>
    </a>
  );
}
