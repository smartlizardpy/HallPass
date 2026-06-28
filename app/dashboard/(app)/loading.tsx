/**
 * Route-group loading fallback for the whole `(app)` dashboard.
 *
 * This `loading.tsx` is shared by EVERY page in the group — analytics, boards,
 * and users alike — so it is deliberately NEUTRAL: a generic header bar plus a
 * small grid of plain card skeletons. An earlier version rendered the analytics
 * shape (stat cards + a bar chart), which flashed a misleading chart outline on
 * `/dashboard/boards` and `/dashboard/users` before their real content arrived.
 * Keeping it content-agnostic means it reads fine no matter which page mounts.
 */
export default function Loading() {
  // The layout now owns the `<main>` container (width + padding), so this
  // fallback is just the skeleton content rendered inside it.
  return (
    <div className="animate-pulse">
      {/* Generic page header: a title bar and a subtitle line. */}
      <div className="mb-8 space-y-3">
        <div className="h-9 w-44 rounded bg-surface-2" />
        <div className="h-4 w-64 rounded bg-surface-2" />
      </div>

      {/* A small grid of plain card skeletons — no chart, no role-specific shape. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-border bg-surface p-5"
          >
            <div className="h-4 w-28 rounded bg-surface-2" />
            <div className="mt-3 h-3 w-full rounded bg-surface-2" />
            <div className="mt-2 h-3 w-2/3 rounded bg-surface-2" />
          </div>
        ))}
      </section>
    </div>
  );
}
