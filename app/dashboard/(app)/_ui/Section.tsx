/**
 * Dashboard section card — a titled `rounded-xl border bg-surface` panel shared
 * by the boards/games/account screens so every grouped block reads identically.
 * A server component: renders an optional header row (`title` + optional muted
 * `subtitle`) above `children`. Omit `title` to get a bare padded card. An
 * extra `className` is merged onto the card so callers can add spans/margins
 * without re-deriving the base style.
 */

import type { ReactNode } from "react";

export function Section({
  title,
  subtitle,
  className = "",
  children,
}: {
  title?: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
            {title}
          </h2>
          {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
