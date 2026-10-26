/**
 * HallPass dashboard — the championship desk (`/dashboard/championship`).
 *
 * Everything staff need to run Fright Fest, on one page, in the order it is
 * needed: where the event is, which boards are open, the runs waiting for a
 * human, every run with the server's evidence, the provisional table and who it
 * would reward, and the audit trail.
 *
 * PRIVACY. Players appear by public name and public id only; the store selects
 * nothing else. `meta` and `checks` are rendered as TEXT (they are partly
 * game-supplied), never as HTML. The emails in the audit log are staff
 * dashboard accounts, which is the point of an audit log.
 *
 * Every control states its precondition. A disallowed action shows WHY (from
 * `eventActionAllowed`, with the database clock) instead of a button that would
 * fail, and the action re-checks anyway: the page can be stale.
 *
 * Failure modes follow `moderation/page.tsx`: an unconfigured database or a
 * missing migration render a notice; any other error is rethrown, because "no
 * runs" must never be a disguised outage.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { isMissingColumnError, isUnconfiguredDbError } from "@/app/lib/db";
import { championshipStore, computeStandings } from "@/app/lib/championship";
import { eventActionAllowed, graceEndsAtMs } from "@/app/lib/championship/admin";
import { awardsFrom, type Award } from "@/app/lib/championship/awards";
import { CHAMPIONSHIPS, championshipById } from "@/app/lib/championship/config";
import { formatInstant, formatScore, formatTiebreak, ordinal } from "@/app/lib/championship/format";
import { championshipPhase, closeAtMs } from "@/app/lib/championship/phase";
import type { Standings } from "@/app/lib/championship/standings";
import {
  GAME_TRANSITIONS,
  type AdminRun,
  type EventAction,
  type EventSnapshot,
  type GameAction,
  type LogEntry,
} from "@/app/lib/championship/store";
import type { ChampionshipConfig, ChampionshipGame, GameState, RunStatus } from "@/app/lib/championship/types";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { eventAction, finaliseAction, gameAction, reviewAction } from "./actions";

export const metadata: Metadata = {
  title: "Championship",
  description: "Run Fright Fest: lineup, review queue, standings, finalisation.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const RUN_STATUSES: RunStatus[] = ["accepted", "flagged", "rejected", "disqualified"];

const BTN = "rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-40";
const BTN_PRIMARY = `${BTN} bg-brand text-white hover:bg-brand-600`;
const BTN_QUIET = `${BTN} border border-border bg-surface hover:bg-surface-2`;
const BTN_DANGER = `${BTN} bg-red-600 text-white hover:bg-red-700`;
const INPUT = "w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs";

function Chip({ tone, children }: { tone: "green" | "amber" | "red" | "zinc" | "brand"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    red: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
    zinc: "bg-surface-2 text-foreground-2",
    brand: "bg-brand/15 text-brand",
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

const RUN_TONE: Record<RunStatus, "green" | "amber" | "red" | "zinc"> = {
  issued: "zinc",
  accepted: "green",
  flagged: "amber",
  rejected: "red",
  disqualified: "red",
};

function Hidden({ c, fields }: { c: ChampionshipConfig; fields: Record<string, string | number> }) {
  return (
    <>
      <input type="hidden" name="championship" value={c.id} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
    </>
  );
}

function Banner({ tone, children }: { tone: "ok" | "error" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200"
      : tone === "error"
        ? "border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200"
        : "border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200";
  return <div role={tone === "error" ? "alert" : "status"} className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

export default async function ChampionshipDeskPage({ searchParams }: { searchParams: SearchParams }) {
  const { playerId: myPlayerId } = await requireRole(SITE_WRITE_ROLE);
  const params = await searchParams;
  const c = championshipById(one(params.c) ?? "") ?? CHAMPIONSHIPS[0];
  const ok = one(params.ok);
  const error = one(params.error);
  const statusFilter = RUN_STATUSES.find((s) => s === one(params.status)) ?? null;
  const gameFilter = c.games.find((g) => g.slug === one(params.game))?.slug ?? null;

  let snap: EventSnapshot | null = null;
  let counts: Record<RunStatus, number> = { issued: 0, accepted: 0, flagged: 0, rejected: 0, disqualified: 0 };
  let queue: AdminRun[] = [];
  let runs: AdminRun[] = [];
  let log: LogEntry[] = [];
  let standings: Standings | null = null;
  let unavailable: "unconfigured" | "schema" | null = null;
  try {
    snap = await championshipStore.readEvent(c.id);
    if (!snap) {
      unavailable = "schema";
    } else {
      [counts, queue, runs, log, standings] = await Promise.all([
        championshipStore.runCounts(c.id),
        championshipStore.listRuns(c.id, { status: "flagged", limit: 100, ownPlayerId: myPlayerId ?? null }),
        championshipStore.listRuns(c.id, { status: statusFilter, gameSlug: gameFilter, limit: 100, ownPlayerId: myPlayerId ?? null }),
        championshipStore.readLog(c.id, 60),
        computeStandings(c, snap),
      ]);
    }
  } catch (err) {
    if (isUnconfiguredDbError(err)) unavailable = "unconfigured";
    else if (isMissingColumnError(err)) unavailable = "schema";
    else throw err;
  }

  const tz = c.timeZone;
  return (
    <div className="mx-auto max-w-6xl">
      <DashHeader
        title={c.title}
        subtitle={`Opens ${formatInstant(c.opensAt, tz)} · closes ${formatInstant(c.closesAt, tz)} UK time · results by ${formatInstant(c.resultsBy, tz)}`}
        action={
          <Link href="/fright-fest" className="text-sm font-bold text-brand hover:text-brand-600">
            Public page →
          </Link>
        }
      />
      {ok && <Banner tone="ok">{ok}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {!c.enabled && <Banner tone="warn">This championship is switched off in code (`enabled: false`). Nothing here reaches players.</Banner>}
      {unavailable === "unconfigured" && <Banner tone="warn">No database is configured (`DATABASE_URL`).</Banner>}
      {unavailable === "schema" && (
        <Banner tone="warn">
          The championship tables are missing. Apply migration <code>048_championship.sql</code> (see{" "}
          <code>scripts/migrate-prod.sh</code>); until then no runs are accepted and the public page says standings are unavailable.
        </Banner>
      )}
      {snap && standings && (
        <div className="space-y-6">
          <EventPanel c={c} snap={snap} counts={counts} />
          <LineupPanel c={c} games={snap.games} />
          <ReviewQueue c={c} runs={queue} />
          <StandingsPanel c={c} standings={standings} final={snap.state.status === "finalised" || snap.state.status === "archived"} />
          <RunsPanel c={c} runs={runs} statusFilter={statusFilter} gameFilter={gameFilter} />
          <LogPanel c={c} log={log} />
        </div>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  off: "Off",
  upcoming: "Upcoming",
  live: "Live",
  closed: "Closed: finishing grace, then verification",
  verification: "Verification",
  finalised: "Final",
  archived: "Archived",
  suspended: "Suspended",
};

const EVENT_CONTROLS: { action: EventAction; label: string; tone: "primary" | "quiet" | "danger"; reason: "required" | "optional" | "none"; help: string }[] = [
  { action: "suspend", label: "Suspend", tone: "danger", reason: "required", help: "Stops every run start and submission; the public page shows a notice. The Halloween skin is not affected." },
  { action: "resume", label: "Resume", tone: "primary", reason: "optional", help: "Takes runs again, inside the window." },
  { action: "close-early", label: "Close early", tone: "danger", reason: "required", help: "Ends submissions now. Runs already started keep the finishing grace." },
  { action: "reopen", label: "Undo early close", tone: "quiet", reason: "optional", help: "Only before the scheduled close." },
  { action: "start-verification", label: "Start verification", tone: "primary", reason: "optional", help: "After the close and its grace: no more runs; review flagged runs, then finalise." },
  { action: "archive", label: "Archive", tone: "quiet", reason: "optional", help: "After finalisation. The public page keeps the final result." },
];

function EventPanel({ c, snap, counts }: { c: ChampionshipConfig; snap: EventSnapshot; counts: Record<RunStatus, number> }) {
  const phase = championshipPhase(c, snap.state, snap.nowMs);
  const tz = c.timeZone;
  const close = closeAtMs(c, snap.state);
  const finalise = eventActionAllowed(c, snap.state, snap.nowMs, "finalise", counts.flagged);
  return (
    <Section title="Event" subtitle={`Database clock: ${formatInstant(new Date(snap.nowMs).toISOString(), tz)} UK`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Chip tone={phase === "live" ? "green" : phase === "suspended" ? "red" : phase === "finalised" ? "brand" : "zinc"}>{PHASE_LABEL[phase] ?? phase}</Chip>
        {snap.state.suspended && snap.state.suspendedReason && <span className="text-foreground-2">Reason: {snap.state.suspendedReason}</span>}
        {snap.state.closedEarlyAt && <span className="text-foreground-2">Closed early at {formatInstant(snap.state.closedEarlyAt, tz)}</span>}
        <span className="text-muted">
          Submissions close {formatInstant(new Date(close).toISOString(), tz)}; grace ends{" "}
          {formatInstant(new Date(graceEndsAtMs(c, snap.state)).toISOString(), tz)}.
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["accepted", "flagged", "rejected", "disqualified", "issued"] as RunStatus[]).map((s) => (
          <div key={s} className="rounded-lg bg-surface-2 px-3 py-2">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">{s === "issued" ? "unfinished" : s}</dt>
            <dd className="text-xl font-black tabular-nums">{counts[s]}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-5 grid gap-3 md:grid-cols-2">
        {EVENT_CONTROLS.map((ctl) => {
          const allowed = eventActionAllowed(c, snap.state, snap.nowMs, ctl.action, counts.flagged);
          return (
            <li key={ctl.action} className="rounded-lg border border-border p-3">
              <form action={eventAction} className="flex flex-col gap-2">
                <Hidden c={c} fields={{ action: ctl.action }} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{ctl.label}</span>
                  <button
                    type="submit"
                    disabled={!allowed.ok}
                    className={ctl.tone === "primary" ? BTN_PRIMARY : ctl.tone === "danger" ? BTN_DANGER : BTN_QUIET}
                  >
                    {ctl.label}
                  </button>
                </div>
                <p className="text-xs text-muted">{allowed.ok ? ctl.help : allowed.why}</p>
                {allowed.ok && ctl.reason !== "none" && (
                  <input
                    name="reason"
                    maxLength={300}
                    required={ctl.reason === "required"}
                    placeholder={ctl.reason === "required" ? "Reason (required, goes in the audit log)" : "Reason (optional)"}
                    className={INPUT}
                  />
                )}
              </form>
            </li>
          );
        })}
        <li className="rounded-lg border border-border p-3 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold">Finalise results</span>
            {!finalise.ok && <span className="text-xs text-muted">{finalise.why}</span>}
          </div>
          {finalise.ok && (
            <details className="mt-2 rounded-lg border border-border bg-surface-2 p-3">
              <summary className="cursor-pointer text-xs font-bold text-brand">Finalise…</summary>
              <p className="mt-2 text-xs text-foreground-2">
                Freezes the table shown below as the official result and decides every reward. After this no run can be
                approved, disqualified or reinstated. Rewards are paid out by Collectibles and can be re-run safely.
              </p>
              <form action={finaliseAction} className="mt-2">
                <Hidden c={c} fields={{}} />
                <button type="submit" className={BTN_PRIMARY}>
                  Finalise now
                </button>
              </form>
            </details>
          )}
        </li>
      </ul>
    </Section>
  );
}

const GAME_TONE: Record<string, "green" | "amber" | "red" | "zinc"> = { open: "green", paused: "amber", withdrawn: "red", pending: "zinc" };
const GAME_LABEL: Record<GameAction, string> = { "open-game": "Open board", "pause-game": "Pause", "resume-game": "Resume", "withdraw-game": "Withdraw" };

function LineupPanel({ c, games }: { c: ChampionshipConfig; games: GameState[] }) {
  return (
    <Section title="Lineup" subtitle="A board counts for Fright Points from the moment it opens">
      <ul className="divide-y divide-border">
        {c.games.map((g) => {
          const state = games.find((s) => s.slug === g.slug) ?? { slug: g.slug, status: "pending" as const, openedAt: null };
          const actions = (Object.keys(GAME_TRANSITIONS) as GameAction[]).filter((a) => GAME_TRANSITIONS[a].from.includes(state.status));
          return (
            <li key={g.slug} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{g.title}</span>
                  <span className="text-sm text-foreground-2">{g.mode}</span>
                  <Chip tone={GAME_TONE[state.status]}>{state.status}</Chip>
                  <Chip tone={g.rules === "verified" ? "green" : "amber"}>{g.rules === "verified" ? "rules verified" : "rules proposed"}</Chip>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Board <code>{g.board}</code> · {g.metric.label} ({g.metric.sort === "desc" ? "higher wins" : "lower wins"}), ties on {g.metric.tiebreakLabel}
                  {state.openedAt ? ` · opened ${formatInstant(state.openedAt, c.timeZone)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {actions.map((a) =>
                  a === "pause-game" || a === "withdraw-game" || (a === "open-game" && g.rules !== "verified") ? (
                    <details key={a} className="rounded-lg border border-border bg-surface-2 p-2">
                      <summary className="cursor-pointer text-xs font-bold">{GAME_LABEL[a]}…</summary>
                      <form action={gameAction} className="mt-2 flex w-64 flex-col gap-2">
                        <Hidden c={c} fields={{ action: a, game: g.slug }} />
                        {a === "open-game" && (
                          <p className="text-xs text-amber-800 dark:text-amber-200">
                            These rules are proposed. Open only after the mode passes the checklist in{" "}
                            <code>docs/championship-integration.md</code>. Runs count from the moment it opens.
                          </p>
                        )}
                        {a === "withdraw-game" && (
                          <p className="text-xs text-foreground-2">The board stops counting: its results leave the overall table and eligibility.</p>
                        )}
                        <input name="reason" maxLength={300} required={a !== "open-game"} placeholder="Reason" className={INPUT} />
                        <button type="submit" className={a === "open-game" ? BTN_PRIMARY : BTN_DANGER}>
                          {GAME_LABEL[a]}
                        </button>
                      </form>
                    </details>
                  ) : (
                    <form key={a} action={gameAction}>
                      <Hidden c={c} fields={{ action: a, game: g.slug }} />
                      <button type="submit" className={a === "open-game" || a === "resume-game" ? BTN_PRIMARY : BTN_QUIET}>
                        {GAME_LABEL[a]}
                      </button>
                    </form>
                  ),
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function gameOf(c: ChampionshipConfig, slug: string): ChampionshipGame | undefined {
  return c.games.find((g) => g.slug === slug);
}

function RunFacts({ c, run }: { c: ChampionshipConfig; run: AdminRun }) {
  const g = gameOf(c, run.gameSlug);
  const tb = g && run.tiebreak !== null ? formatTiebreak(g.metric, run.tiebreak) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-bold">{run.name}</span>
      <code className="text-[11px] text-muted">{run.publicId}</code>
      <span className="text-foreground-2">{g?.title ?? run.gameSlug}</span>
      {run.score !== null && g && (
        <span className="font-mono">
          {g.metric.label}: {formatScore(g.metric, run.score)}
          {tb ? ` · ${g.metric.tiebreakLabel}: ${tb}` : ""}
        </span>
      )}
      {run.elapsedSec !== null && <span className="text-xs text-muted">server-timed {Math.round(run.elapsedSec)} s</span>}
      {run.submittedAt && <span className="text-xs text-muted">{formatInstant(run.submittedAt, c.timeZone)}</span>}
    </div>
  );
}

function Evidence({ run }: { run: AdminRun }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-bold text-muted">Server checks and game data</summary>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 text-[11px]">{json(run.checks)}</pre>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 text-[11px]">{json(run.meta)}</pre>
      </div>
    </details>
  );
}

function ReviewQueue({ c, runs }: { c: ChampionshipConfig; runs: AdminRun[] }) {
  return (
    <Section title="Waiting for review" subtitle="Held runs do not rank until approved">
      {runs.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">Nothing is waiting for review.</p>
      ) : (
        <ul className="space-y-3">
          {runs.map((run) => (
            <li key={run.id} className="rounded-lg border border-amber-300 p-3 dark:border-amber-900">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="amber">#{run.id} held</Chip>
                {run.flags.map((f) => (
                  <Chip key={f} tone="zinc">{f}</Chip>
                ))}
              </div>
              <div className="mt-2">
                <RunFacts c={c} run={run} />
              </div>
              <Evidence run={run} />
              {run.isOwn ? (
                <p className="mt-2 text-xs font-bold text-muted">This is your own run: another admin must review it.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-3">
                  <form action={reviewAction}>
                    <Hidden c={c} fields={{ action: "approve-run", runId: run.id }} />
                    <button type="submit" className={BTN_PRIMARY}>Approve</button>
                  </form>
                  <form action={reviewAction} className="flex flex-1 items-center gap-2">
                    <Hidden c={c} fields={{ action: "disqualify-run", runId: run.id }} />
                    <input name="reason" required maxLength={300} placeholder="Why disqualify (required)" className={INPUT} />
                    <button type="submit" className={BTN_DANGER}>Disqualify</button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function StandingsPanel({ c, standings, final }: { c: ChampionshipConfig; standings: Standings; final: boolean }) {
  const awards = awardsFrom(c, standings);
  const nameOf = new Map(standings.overall.map((o) => [o.publicId, o.name]));
  const label = (a: Award) =>
    a.kind === "overall-champion" ? "Overall Champion Pack" : a.kind === "game-champion" ? `${gameOf(c, a.gameSlug!)?.title} Champion Pack` : "Participation Pack";
  return (
    <Section title={final ? "Live table (the frozen result is on the public page)" : "Provisional standings"} subtitle="Accepted runs only">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Overall (Fright Points)</h3>
          {standings.overall.length === 0 ? (
            <p className="text-sm text-muted">No accepted runs yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {standings.overall.slice(0, 20).map((o) => (
                <li key={o.publicId} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="inline-block w-10 tabular-nums text-muted">{ordinal(o.rank)}</span>
                    {o.name}
                    {!o.eligible && <span className="ml-2 text-xs text-muted">(missing {o.missing.length} board{o.missing.length === 1 ? "" : "s"})</span>}
                  </span>
                  <span className="font-mono tabular-nums">{o.points}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Rewards these standings decide</h3>
          {awards.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {awards.map((a) => (
                <li key={a.grantKey} className="flex items-center justify-between gap-2">
                  <span>{label(a)}</span>
                  <span className="text-foreground-2">{nameOf.get(a.publicId) ?? a.publicId}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {standings.boards.map((b) => (
          <div key={b.slug}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              {b.title} {b.counting ? "" : `(${b.status}, not counting)`}
            </h3>
            {b.entries.length === 0 ? (
              <p className="text-sm text-muted">No results.</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {b.entries.slice(0, 10).map((e) => (
                  <li key={e.publicId} className="flex justify-between gap-2">
                    <span>
                      <span className="inline-block w-9 tabular-nums text-muted">{ordinal(e.rank)}</span>
                      {e.name}
                    </span>
                    <span className="font-mono">{formatScore(b.metric, e.score)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function RunsPanel({ c, runs, statusFilter, gameFilter }: { c: ChampionshipConfig; runs: AdminRun[]; statusFilter: RunStatus | null; gameFilter: string | null }) {
  const href = (status: string | null, game: string | null) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (game) q.set("game", game);
    const s = q.toString();
    return `/dashboard/championship${s ? `?${s}` : ""}#runs`;
  };
  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-bold ${active ? "bg-brand text-white" : "border border-border hover:bg-surface-2"}`;
  return (
    <Section title="Every run" subtitle="Newest first, 100 at a time">
      <div id="runs" className="mb-3 flex flex-wrap gap-2">
        <Link href={href(null, gameFilter)} className={pill(statusFilter === null)}>All</Link>
        {RUN_STATUSES.map((s) => (
          <Link key={s} href={href(s, gameFilter)} className={pill(statusFilter === s)}>{s}</Link>
        ))}
        <span className="mx-1 border-l border-border" />
        <Link href={href(statusFilter, null)} className={pill(gameFilter === null)}>All games</Link>
        {c.games.map((g) => (
          <Link key={g.slug} href={href(statusFilter, g.slug)} className={pill(gameFilter === g.slug)}>{g.modeShort}</Link>
        ))}
      </div>
      {runs.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No runs match.</p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((run) => (
            <li key={run.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={RUN_TONE[run.status]}>#{run.id} {run.status}</Chip>
                {run.reason && <span className="text-xs text-foreground-2">{run.reason}</span>}
                {run.reviewedBy && <span className="text-xs text-muted">reviewed by {run.reviewedBy}</span>}
              </div>
              <div className="mt-1">
                <RunFacts c={c} run={run} />
              </div>
              <Evidence run={run} />
              {!run.isOwn && (run.status === "accepted" || run.status === "disqualified") && (
                <form action={reviewAction} className="mt-2 flex max-w-xl items-center gap-2">
                  <Hidden c={c} fields={{ action: run.status === "accepted" ? "disqualify-run" : "reinstate-run", runId: run.id }} />
                  <input name="reason" required maxLength={300} placeholder="Reason (required)" className={INPUT} />
                  <button type="submit" className={run.status === "accepted" ? BTN_DANGER : BTN_QUIET}>
                    {run.status === "accepted" ? "Disqualify" : "Reinstate"}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function LogPanel({ c, log }: { c: ChampionshipConfig; log: LogEntry[] }) {
  return (
    <Section title="Audit log" subtitle="Every staff action, newest first">
      {log.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No actions yet.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {log.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-2">
              <span className="tabular-nums text-muted">{formatInstant(l.createdAt, c.timeZone)}</span>
              <span className="font-bold">{l.actorEmail}</span>
              <span>{l.action}</span>
              {l.gameSlug && <span className="text-foreground-2">{gameOf(c, l.gameSlug)?.title ?? l.gameSlug}</span>}
              {l.runId !== null && <span className="text-foreground-2">run #{l.runId}</span>}
              {l.reason && <span className="text-foreground-2">“{l.reason}”</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
