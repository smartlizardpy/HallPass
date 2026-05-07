import type { Metadata } from "next";
import Link from "next/link";
import { findGame } from "../lib/games";
import { getDashboardStats } from "../lib/stats";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "HALLPASS live analytics — top games, plays, and visitors.",
  robots: { index: false, follow: false },
};

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();
  const peak = Math.max(1, ...stats.daily.map((d) => d.plays));
  const topPlays = stats.topGames[0]?.plays ?? 1;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-1">
            Live analytics from PostHog · last 30 days
          </p>
        </div>
        <Link
          href="/"
          className="text-sm font-semibold text-brand hover:text-brand-600"
        >
          ← Back to arcade
        </Link>
      </header>

      {!stats.configured && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 mb-6">
          PostHog server credentials missing. Set{" "}
          <code className="font-mono">POSTHOG_PERSONAL_API_KEY</code> to see live
          data. <code className="font-mono">POSTHOG_PROJECT_ID</code> is optional
          and only needed if you want to override the API key&apos;s current project.
        </div>
      )}

      {stats.unavailable && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 mb-6">
          Live analytics are temporarily unavailable. The dashboard now fails
          fast instead of hanging when PostHog does not respond.
          {process.env.NODE_ENV !== "production" && stats.unavailableReason && (
            <div className="mt-2 font-mono text-xs break-words">
              {stats.unavailableReason}
            </div>
          )}
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total plays" value={formatNumber(stats.totalPlays)} />
        <StatCard label="Unique visitors" value={formatNumber(stats.uniqueVisitors)} />
        <StatCard
          label="Plays / visitor"
          value={
            stats.uniqueVisitors
              ? (stats.totalPlays / stats.uniqueVisitors).toFixed(1)
              : "—"
          }
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Plays · last 14 days">
          {stats.daily.length === 0 ? (
            <Empty />
          ) : (
            <div className="flex items-end gap-1 h-48 pt-4">
              {stats.daily.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${formatNumber(d.plays)}`}
                  className="flex-1 bg-brand/80 hover:bg-brand rounded-t"
                  style={{ height: `${(d.plays / peak) * 100}%` }}
                />
              ))}
            </div>
          )}
          {stats.daily.length > 0 && (
            <div className="flex justify-between text-xs text-muted mt-2">
              <span>{stats.daily[0]?.date}</span>
              <span>{stats.daily[stats.daily.length - 1]?.date}</span>
            </div>
          )}
        </Panel>

        <Panel title="Top games">
          {stats.topGames.length === 0 ? (
            <Empty />
          ) : (
            <ol className="space-y-2">
              {stats.topGames.map((row, i) => {
                const game = findGame(row.slug);
                const width = (row.plays / topPlays) * 100;
                return (
                  <li key={row.slug} className="flex items-center gap-3">
                    <span className="text-muted font-mono text-xs w-5 text-right">
                      {i + 1}
                    </span>
                    <Link
                      href={`/game/${row.slug}`}
                      className="flex-1 min-w-0 group"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-semibold group-hover:text-brand">
                          {game?.title ?? row.slug}
                        </span>
                        <span className="font-mono text-sm tabular-nums">
                          {formatNumber(row.plays)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-surface-2 rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-brand/70"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface border border-border p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="text-3xl font-black tabular-nums mt-1">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface border border-border p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted mb-3">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-sm text-muted py-8 text-center">No data yet.</div>;
}
