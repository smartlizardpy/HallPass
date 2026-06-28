/**
 * Dashboard page header — the cohesive title block every `(app)` screen opens
 * with. A server component (no interactivity): renders the page `title` as a
 * heavy `<h1>`, an optional muted `subtitle`, and an optional right-aligned
 * `action` slot (a button or link, e.g. "New board" / "← Back to arcade").
 * Centralising it keeps the type scale and spacing identical across pages so
 * the shell no longer jumps between routes.
 */

import type { ReactNode } from "react";

export function DashHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-black tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
