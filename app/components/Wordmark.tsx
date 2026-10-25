/**
 * HallPass wordmark — the SINGLE source of truth for the brand mark: lowercase
 * "hallpass" in brand purple (font-black) with its raised yellow dot. Use this
 * everywhere the logo appears (arcade, dashboard, sign-in, account) so the
 * surfaces never drift apart again.
 */
export function Wordmark({
  size = "text-2xl",
  dotClass = "h-1.5 w-1.5",
  className = "",
  tag,
}: {
  /** Tailwind font-size class for the wordmark text. */
  size?: string;
  /** Tailwind sizing for the yellow dot. */
  dotClass?: string;
  className?: string;
  /**
   * A small chip after the mark, e.g. "mobile" for the phone shell. Kept as an
   * optional prop rather than a second component so the brand mark itself stays
   * the single source of truth — the tag is a suffix on the ONE wordmark, not a
   * fork of it. Absent by default, so every existing call site is unchanged.
   */
  tag?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-0.5 ${className}`}>
      <span className={`font-black tracking-tight text-brand ${size}`}>
        hallpass
      </span>
      <span
        className={`${dotClass} ha-wm-dot shrink-0 translate-y-[-2px] rounded-full bg-accent-yellow`}
      />
      {/* Fright Fest: the skin swaps the yellow dot for this pixel moon (hidden
          for everyone else by `.ha-deco`; see events/fright-fest/header.css). */}
      <span
        aria-hidden="true"
        data-ha-moment="moon"
        data-ha-size={dotClass.includes("h-2") ? "lg" : undefined}
        className="ha-deco ha-spr ha-wm-moon"
      />
      {tag && (
        <span className="ml-1 self-center rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-brand">
          {tag}
        </span>
      )}
    </span>
  );
}
