/**
 * `/dashboard/coop` — how much online co-op is used.
 *
 * Co-op games run peer to peer, so the server never sees a session. The P2P SDK
 * reports rooms and sessions through the page shell as `coop_*` PostHog events
 * (`app/lib/coop-telemetry.ts`) and this page reads them back
 * (`app/lib/coop/stats.ts`). No Neon table is involved.
 *
 * Every number is DEVICES, not people, over PostHog's 30-day window; the
 * definitions of room, session and length are in `app/lib/coop/config.ts` and
 * repeated in the footer so the page reads without that file.
 *
 * Inherits the admin gate, the `noindex` and the service worker's
 * never-intercept prefix by living under `/dashboard`, and re-checks
 * `requireRole(DASHBOARD_MIN_ROLE)` in its own body, as the other pages do.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { DASHBOARD_MIN_ROLE } from "@/app/lib/permissions";
import { resolveGames } from "@/app/lib/games-store";
import {
  COOP_WINDOW_DAYS,
  conversionRate,
  durationLabel,
  playerMinutes,
  unfinishedSessions,
} from "@/app/lib/coop/config";
import { getCoopStats } from "@/app/lib/coop/stats";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { Bars, type Bar } from "../growth/_ui/Bars";

export const metadata: Metadata = {
  title: "Co-op",
  description: "How many HALLPASS co-op sessions are made, and how long they last.",
  robots: { index: false, follow: false },
};

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);

export default async function CoopPage() {
  await requireRole(DASHBOARD_MIN_ROLE);

  const [stats, games] = await Promise.all([getCoopStats(), resolveGames()]);
  const titleBySlug = new Map(games.map((g) => [g.slug, g.title]));

  const conversion = conversionRate(stats.rooms, stats.sessions);
  const unfinished = unfinishedSessions(stats.sessions, stats.ended);
  const peakDay = Math.max(1, ...stats.daily.map((d) => d.sessions));

  const gameBars: Bar[] = stats.games.map((g) => ({
    key: g.slug,
    label: titleBySlug.get(g.slug) ?? g.slug,
    value: g.sessions,
    note: `· ${fmt(g.rooms)} rooms · avg ${durationLabel(g.avgSeconds)}`,
  }));

  return (
    <>
      <DashHeader
        title="Co-op"
        subtitle={`Online co-op rooms and sessions · last ${COOP_WINDOW_DAYS} days`}
        action={
          <Link href="/dashboard" className="text-sm font-semibold text-brand hover:text-brand-600">
            ← Overview
          </Link>
        }
      />

      {!stats.configured && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>Analytics panels cannot read.</strong> Set{" "}
          <code className="font-mono">POSTHOG_PERSONAL_API_KEY</code> and{" "}
          <code className="font-mono">POSTHOG_PROJECT_ID</code>.
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sessions" value={fmt(stats.sessions)} hint="Rooms that reached two players." />
        <StatCard label="Rooms created" value={fmt(stats.rooms)} hint="Includes lobbies nobody joined." />
        <StatCard
          label="Became a session"
          value={conversion === null ? "—" : `${conversion}%`}
          hint="Rooms that got a second player."
        />
        <StatCard label="Devices" value={fmt(stats.devices)} hint="Browser profiles, not people." />
        <StatCard
          label="Typical length"
          value={durationLabel(stats.medianSeconds)}
          hint={`Median · mean ${durationLabel(stats.avgSeconds)}`}
        />
        <StatCard
          label="Player-minutes"
          value={fmt(playerMinutes(stats.playerSeconds))}
          hint="Estimate: length × peak players."
        />
        <StatCard label="Joins" value={fmt(stats.joins)} hint="Players who joined someone's room." />
        <StatCard
          label="No end reported"
          value={fmt(unfinished)}
          hint="Crashed or force-closed hosts; excluded from lengths."
        />
      </section>

      <Section title="Sessions per day" subtitle="a quiet day is a zero" className="mt-6">
        {stats.sessions === 0 && stats.rooms === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            No co-op events yet. Games report them once they ship the P2P SDK 1.2.0 or later.
          </div>
        ) : (
          <div className="flex h-28 items-end gap-1" role="img" aria-label="Co-op sessions per day">
            {stats.daily.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.sessions} sessions, ${d.rooms} rooms`}
                className="flex-1 rounded-t bg-brand"
                style={{ height: `${d.sessions === 0 ? 2 : Math.max(6, (d.sessions / peakDay) * 100)}%`, opacity: d.sessions === 0 ? 0.25 : 1 }}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="By game" subtitle="sessions" className="mt-6">
        <Bars rows={gameBars} empty="No co-op sessions yet." />
      </Section>

      <p className="mt-6 text-xs text-muted">
        A <strong>room</strong> is a lobby a host opened; a <strong>session</strong> is a room that reached
        two connected players. Length is the host&apos;s time from the second player arriving to the room
        closing, reported only when the host&apos;s page closes cleanly. Counts are devices over PostHog&apos;s
        30-day window, so they will not match Neon-sourced panels.
      </p>
    </>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-3xl font-black tabular-nums">{value}</div>
      {hint && <div className="mt-auto pt-3 text-xs font-medium text-muted">{hint}</div>}
    </div>
  );
}
