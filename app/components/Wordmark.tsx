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
}: {
  /** Tailwind font-size class for the wordmark text. */
  size?: string;
  /** Tailwind sizing for the yellow dot. */
  dotClass?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-0.5 ${className}`}>
      <span className={`font-black tracking-tight text-brand ${size}`}>
        hallpass
      </span>
      <span
        className={`${dotClass} shrink-0 translate-y-[-2px] rounded-full bg-accent-yellow`}
      />
    </span>
  );
}
