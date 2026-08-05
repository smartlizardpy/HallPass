/**
 * The beta tester's home: rank, assigned games, and their own filed reports.
 *
 * Gated by `requireBetaTester()`, which redirects a signed-out visitor to
 * sign-in and a non-member to `/beta/closed`. Admins pass without a membership
 * row so they can see what testers see.
 *
 * DYNAMIC BY DESIGN, and safely so. This page calls `auth()` through its guard,
 * which makes it non-prerenderable — that is fine HERE and would be a bug on
 * `/` or `/game/[slug]`, where going dynamic silently drops the route from
 * `public/sw-manifest.js` and breaks offline play. Nothing on this page is
 * shared with those routes, which is the reason the beta test session lives at
 * `/beta/session/[slug]` instead of being bolted onto `PlayerOverlay`.
 *
 * SHELL. A bare `<main>` with a `BackButton`, matching `/play/account` and
 * `/play/friends` rather than the arcade shell: those standalone pages carry
 * per-viewer data and deliberately stay out of the shared service-worker cache,
 * and this one is the same kind of surface.
 *
 * Every read is fail-soft (see `beta/index.ts`), so a database blip renders an
 * empty queue rather than a 500 — a tester who cannot load their assignments
 * should still see their rank and their history.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { BackButton } from "@/app/components/BackButton";
import { CoverImage } from "@/app/components/CoverImage";
import { Wordmark } from "@/app/components/Wordmark";
import { resolveGames } from "@/app/lib/games-store";
import {
  getAssignments,
  getBetaStanding,
  getOwnReports,
  requireBetaTester,
} from "@/app/lib/beta";
import { BUG_XP, FEATURE_XP, SHOT_XP } from "@/app/lib/beta/config";
import {
  AssignmentStatusChip,
  KindChip,
  ReportStatusChip,
  SeverityChip,
} from "./_ui/Chips";
import { RankMeter } from "./_ui/RankMeter";

export const metadata: Metadata = {
  title: "Beta testers · HallPass",
  robots: { index: false, follow: false },
};

/** Fixed locale so the server and client never disagree on the rendered date. */
function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function BetaHomePage() {
  const { playerId, viaAdmin } = await requireBetaTester();

  // Resolved together to avoid a request waterfall. `resolveGames()` is cached
  // and already fails soft to the static catalogue on a Neon outage.
  const [standing, assignments, reports, games] = await Promise.all([
    getBetaStanding(playerId),
    getAssignments(playerId),
    getOwnReports(playerId),
    resolveGames(),
  ]);

  // One lookup for the whole page rather than a find() per assignment row.
  const bySlug = new Map(games.map((game) => [game.slug, game]));

  const open = assignments.filter(
    (a) => a.status === "assigned" || a.status === "in_progress",
  );
  const done = assignments.filter(
    (a) => a.status === "submitted" || a.status === "closed",
  );

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-5">
        <BackButton />

        <div className="text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" tag="beta" />
          <h1 className="mt-3 text-2xl font-black tracking-tight text-zinc-900">
            Beta testers
          </h1>
          <p className="mt-2 text-sm font-semibold text-muted">
            Play what you&rsquo;re assigned, report what breaks, earn XP.
          </p>
        </div>

        {viaAdmin && (
          // Admins reach this page without a membership row. Saying so avoids
          // the confusion of an empty queue that looks like a broken page.
          <p className="rounded-xl border border-brand/30 bg-brand-50 px-4 py-3 text-center text-xs font-bold text-brand">
            You&rsquo;re seeing this as an admin — assign yourself a game from
            the dashboard to try the full flow.
          </p>
        )}

        <RankMeter xp={standing.xp} rank={standing.rank} />

        {/* ASSIGNED --------------------------------------------------------- */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
            Your queue
          </h2>
          {open.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm font-semibold text-muted">
              Nothing assigned right now. New games land here when an admin picks
              you for one.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {open.map((assignment) => {
                const game = bySlug.get(assignment.slug);
                return (
                  <li key={assignment.id}>
                    <Link
                      href={`/beta/session/${assignment.slug}`}
                      className="card flex items-center gap-4 rounded-lg border border-border bg-surface-2 p-3 transition hover:border-brand"
                    >
                      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
                        {game ? (
                          <CoverImage game={game} initialClass="text-xl" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-black text-zinc-900">
                            {game?.title ?? assignment.slug}
                          </span>
                          <AssignmentStatusChip status={assignment.status} />
                        </span>
                        {assignment.brief && (
                          <span className="mt-0.5 block truncate text-xs font-semibold text-muted">
                            {assignment.brief}
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden
                        className="shrink-0 text-lg font-black text-brand"
                      >
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {done.length > 0 && (
            <>
              <h3 className="mt-6 text-[11px] font-black uppercase tracking-wide text-muted">
                Finished
              </h3>
              <ul className="mt-2 space-y-1.5">
                {done.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-2"
                  >
                    <span className="truncate text-sm font-bold text-muted">
                      {bySlug.get(assignment.slug)?.title ?? assignment.slug}
                    </span>
                    <AssignmentStatusChip status={assignment.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* YOUR REPORTS ----------------------------------------------------- */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
            Your reports
          </h2>
          {reports.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm font-semibold text-muted">
              Nothing filed yet. Open a game from your queue and tell us what
              goes wrong.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {reports.map((report) => (
                <li
                  key={report.id}
                  className="rounded-lg border border-border bg-surface-2 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 font-bold text-zinc-900">
                      {report.title}
                    </p>
                    <ReportStatusChip status={report.status} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <KindChip kind={report.kind} />
                    {report.severity && (
                      <SeverityChip severity={report.severity} />
                    )}
                    <span className="text-xs font-semibold text-muted">
                      {bySlug.get(report.slug)?.title ?? report.slug} ·{" "}
                      {formatDay(report.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* HOW XP WORKS ----------------------------------------------------- */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
            How XP works
          </h2>
          <p className="mt-2 text-sm font-semibold text-muted">
            XP is paid when an admin accepts your work — not when you file it.
          </p>
          {/* Values come from `beta/config.ts`, the same module the triage action
              pays from, so this table cannot promise a number the server will not
              honour. */}
          <dl className="mt-4 space-y-1.5">
            {[
              ["Bug that breaks the game", BUG_XP.blocker],
              ["Bug that spoils it", BUG_XP.major],
              ["Small bug", BUG_XP.minor],
              ["Cosmetic nitpick", BUG_XP.cosmetic],
              ["Idea we build", FEATURE_XP],
              ["Screenshot we use", SHOT_XP],
            ].map(([label, amount]) => (
              <div
                key={label as string}
                className="flex items-center justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0"
              >
                <dt className="text-sm font-semibold text-muted">{label}</dt>
                <dd className="shrink-0 text-sm font-black tabular-nums text-brand">
                  +{amount as number}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
