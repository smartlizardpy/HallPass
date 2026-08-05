/**
 * Dashboard — the beta programme control room.
 *
 * Four panels in the order an admin actually works them:
 *   1. Triage queue — the only panel with pending work, so it leads.
 *   2. Image review — the other queue.
 *   3. Assign a game — the routine action.
 *   4. Roster — reference, plus invite/revoke.
 *
 * Gated with `requireRole("admin")`, the same guard every action in
 * `actions.ts` enforces independently. Hiding a page is UX; the guard is the
 * security boundary, and it lives in both places on purpose.
 *
 * Every read is fail-soft (see `beta/index.ts`), and they are resolved together
 * rather than sequentially so one slow query does not serialise the others.
 *
 * NO EMAILS ARE RENDERED. `roster()` and `reportQueue()` cannot even select
 * `players.email` — an admin identifies a tester by username, and a query that
 * cannot return an address cannot leak one into this component's serialised
 * props. `store.test.ts` asserts the absence rather than trusting review.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { resolveGames } from "@/app/lib/games-store";
import {
  getAllAssignments,
  getReportQueue,
  getRoster,
  getShotQueue,
} from "@/app/lib/beta";
import { BUG_SEVERITIES } from "@/app/lib/beta/config";
import { rankFor } from "@/app/lib/beta/xp";
import {
  AssignmentStatusChip,
  KindChip,
  ReportStatusChip,
  SeverityChip,
  ShotStatusChip,
} from "@/app/beta/_ui/Chips";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import {
  assignGameAction,
  inviteTesterAction,
  revokeTesterAction,
  reviewShotAction,
  triageReportAction,
  unassignAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Beta testers",
  description: "Invite testers, assign games, and triage what they find.",
  robots: { index: false, follow: false },
};

/** Fixed locale — a dashboard rendered on the server must not drift on hydrate. */
function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** How a tester is named on screen. Never the email — see the module docblock. */
function testerLabel(entry: {
  username: string | null;
  handle: string | null;
  name: string | null;
}): string {
  return entry.username
    ? `@${entry.username}`
    : (entry.handle ?? entry.name ?? "Player");
}

const INPUT =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30";
const BTN_PRIMARY =
  "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600";
const BTN_QUIET =
  "rounded-full border border-border bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 transition hover:bg-surface-2";

export default async function DashboardBetaPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("admin");

  const [{ ok, error }, roster, reports, shots, assignments, games] =
    await Promise.all([
      searchParams,
      getRoster(),
      getReportQueue(),
      getShotQueue(),
      getAllAssignments(),
      resolveGames(),
    ]);

  const titleFor = new Map(games.map((g) => [g.slug, g.title]));
  const nameFor = new Map(roster.map((r) => [r.playerId, testerLabel(r)]));
  const active = roster.filter((r) => r.revokedAt == null);
  const openReports = reports.filter((r) => r.status === "open");
  const pendingShots = shots.filter((s) => s.status === "pending");

  return (
    <>
      <DashHeader
        title="Beta testers"
        subtitle={`${active.length} active · ${openReports.length} report${
          openReports.length === 1 ? "" : "s"
        } waiting`}
        action={
          <Link href="/beta" className={BTN_QUIET}>
            View tester page ↗
          </Link>
        }
      />

      {ok && (
        <div className="mb-5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}
      {error && (
        <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {/* TRIAGE ---------------------------------------------------------- */}
        <Section
          title="Triage queue"
          subtitle={`${openReports.length} open of ${reports.length}`}
        >
          {reports.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-muted">
              Nothing filed yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {reports.map((report) => (
                <li
                  key={report.id}
                  className="rounded-lg border border-border bg-surface-2 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-bold text-zinc-900">
                      {report.title}
                    </p>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <KindChip kind={report.kind} />
                      {report.severity && (
                        <SeverityChip severity={report.severity} />
                      )}
                      <ReportStatusChip status={report.status} />
                    </div>
                  </div>

                  <p className="mt-1 text-xs font-semibold text-muted">
                    {titleFor.get(report.slug) ?? report.slug} ·{" "}
                    {report.authorUsername
                      ? `@${report.authorUsername}`
                      : (report.authorHandle ??
                        report.authorName ??
                        "deleted player")}{" "}
                    · {formatDay(report.createdAt)}
                  </p>

                  {/* Tester-authored text. Rendered as a plain string child, so
                      React escapes it — never dangerouslySetInnerHTML here. */}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                    {report.body}
                  </p>

                  {report.clipBlobPath && (
                    <p className="mt-2 text-xs font-bold text-brand">
                      📹 {Math.round(report.clipMs / 1000)}s replay attached
                    </p>
                  )}

                  {report.status === "open" ? (
                    <form
                      action={triageReportAction}
                      className="mt-3 flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="id" value={report.id} />
                      {report.kind === "bug" && (
                        <select
                          name="severity"
                          defaultValue={report.severity ?? "minor"}
                          aria-label="Severity"
                          className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-bold text-zinc-700"
                        >
                          {BUG_SEVERITIES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                      {/* Three submit buttons sharing one form: the clicked
                          button's name/value is what the browser sends, so the
                          decision travels without any client JS. */}
                      <button
                        type="submit"
                        name="status"
                        value="accepted"
                        className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-extrabold text-white transition hover:bg-emerald-700"
                      >
                        Accept
                      </button>
                      <button
                        type="submit"
                        name="status"
                        value="duplicate"
                        className={BTN_QUIET}
                      >
                        Duplicate
                      </button>
                      <button
                        type="submit"
                        name="status"
                        value="rejected"
                        className={BTN_QUIET}
                      >
                        Reject
                      </button>
                    </form>
                  ) : (
                    <p className="mt-3 text-xs font-semibold text-muted">
                      {report.status} by {report.resolvedBy ?? "—"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* IMAGE REVIEW ---------------------------------------------------- */}
        <Section
          title="Image review"
          subtitle={`${pendingShots.length} pending of ${shots.length}`}
        >
          {shots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-muted">
              No submissions yet.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shots.map((shot) => (
                <li
                  key={shot.id}
                  className="overflow-hidden rounded-lg border border-border bg-surface-2"
                >
                  <div className="relative aspect-video bg-zinc-900">
                    {shot.blobUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={shot.blobUrl}
                        alt={`Submitted for ${titleFor.get(shot.slug) ?? shot.slug}`}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-bold text-zinc-900">
                        {titleFor.get(shot.slug) ?? shot.slug}
                      </span>
                      <ShotStatusChip status={shot.status} />
                    </div>
                    {shot.status === "pending" && (
                      <form action={reviewShotAction} className="mt-2 flex gap-1.5">
                        <input type="hidden" name="id" value={shot.id} />
                        <button
                          type="submit"
                          name="status"
                          value="accepted"
                          className="flex-1 rounded-full bg-emerald-600 px-2 py-1 text-[11px] font-extrabold text-white transition hover:bg-emerald-700"
                        >
                          Accept
                        </button>
                        <button
                          type="submit"
                          name="status"
                          value="rejected"
                          className="flex-1 rounded-full border border-border bg-white px-2 py-1 text-[11px] font-bold text-zinc-700 transition hover:bg-surface-2"
                        >
                          Reject
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ASSIGN ---------------------------------------------------------- */}
        <Section title="Assign a game" subtitle="Lands in the tester's queue">
          {active.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-muted">
              Invite a tester first.
            </p>
          ) : (
            <form
              action={assignGameAction}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <label className="text-xs font-black uppercase tracking-wide text-muted">
                Tester
                <select name="playerId" className={`mt-1 ${INPUT}`} required>
                  {active.map((entry) => (
                    <option key={entry.playerId} value={entry.playerId}>
                      {testerLabel(entry)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-black uppercase tracking-wide text-muted">
                Game
                <select name="slug" className={`mt-1 ${INPUT}`} required>
                  {games.map((game) => (
                    <option key={game.slug} value={game.slug}>
                      {game.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button type="submit" className={BTN_PRIMARY}>
                  Assign
                </button>
              </div>
              <label className="text-xs font-black uppercase tracking-wide text-muted sm:col-span-3">
                Brief <span className="font-semibold normal-case">(optional)</span>
                <input
                  name="brief"
                  type="text"
                  maxLength={500}
                  placeholder="What should they look at? e.g. touch controls on a phone"
                  className={`mt-1 ${INPUT}`}
                />
              </label>
            </form>
          )}

          {assignments.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {assignments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-bold text-zinc-900">
                      {titleFor.get(a.slug) ?? a.slug}
                    </span>{" "}
                    <span className="font-semibold text-muted">
                      → {nameFor.get(a.playerId) ?? "unknown"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <AssignmentStatusChip status={a.status} />
                    <form action={unassignAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" className={BTN_QUIET}>
                        Remove
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ROSTER ---------------------------------------------------------- */}
        <Section title="Roster" subtitle={`${active.length} active`}>
          <form
            action={inviteTesterAction}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="min-w-0 flex-1 text-xs font-black uppercase tracking-wide text-muted">
              Invite by username
              <input
                name="username"
                type="text"
                placeholder="adatester"
                autoComplete="off"
                className={`mt-1 ${INPUT}`}
              />
            </label>
            <button type="submit" className={BTN_PRIMARY}>
              Invite
            </button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Players are invited by username, not email — a tester is someone who
            already has an account.
          </p>

          {roster.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-muted">
              No testers yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {roster.map((entry) => {
                const rank = rankFor(entry.xp);
                return (
                  <li
                    key={entry.playerId}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                      entry.revokedAt
                        ? "border-border bg-transparent opacity-60"
                        : "border-border bg-surface-2"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-bold text-zinc-900">
                        {testerLabel(entry)}
                        {entry.revokedAt && (
                          <span className="ml-2 text-xs font-black uppercase text-muted">
                            revoked
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-muted">
                        {rank.name} · {entry.xp.toLocaleString("en-US")} XP ·{" "}
                        {entry.reportsAccepted}/{entry.reportsFiled} accepted ·{" "}
                        {entry.openAssignments} open
                      </div>
                    </div>
                    {!entry.revokedAt && (
                      <form action={revokeTesterAction} className="shrink-0">
                        <input
                          type="hidden"
                          name="playerId"
                          value={entry.playerId}
                        />
                        <button type="submit" className={BTN_QUIET}>
                          Revoke
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
