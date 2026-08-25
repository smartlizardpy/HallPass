/**
 * Dashboard overview — the admin landing screen.
 *
 * A server component: it gates on `requireRole("admin")`, fetches the PostHog
 * traffic picture (`getDashboardStats`) and the first-party Neon community
 * picture (`getCommunityStats`) in parallel, then hands plain serializable data
 * to the client chart components in `./_charts`. The page itself stays free of
 * `<main>`/`max-w` — the `(app)` layout owns the page container — and leans on
 * the shared `DashHeader` + `Section` primitives so it reads like the rest of
 * the shell. All visualizations are Recharts (interactive, themed to the brand
 * tokens); KPI cards keep their delta badges and gain trailing sparklines.
 *
 * THE PAGE READS TOP TO BOTTOM AS FOUR QUESTIONS, and panels are ordered to
 * answer them in that order rather than grouped by where their data comes from:
 *
 *   1. Is the arcade busy?      KPI row, plays & visitors, top games.
 *   2. Is the community growing? Community growth, player engagement — the
 *      first-party series, sitting next to the traffic ones deliberately, since
 *      "lots of plays" and "more players" are different claims and the page used
 *      to invite reading one as the other.
 *   3. When and what do they play? Daily rhythm, weekday split, comments,
 *      category/device/country mix.
 *   4. What should we do about it? Searches that found nothing, boards nobody
 *      uses, reported comments — the rows that name an action.
 *
 * Every first-party panel degrades on its own: `getCommunityStats` fails soft to
 * zeros with `available: false`, so an unconfigured database renders notices in
 * those panels while the PostHog half of the page keeps working, and vice versa.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { resolveGames } from "@/app/lib/games-store";
import { getDashboardStats, type Delta } from "@/app/lib/stats";
import {
  getCommunityStats,
  WINDOW_DAYS,
  type ActiveBoard,
} from "@/app/lib/overview";
import { agoLabel, hourLabel, peak, share } from "@/app/lib/insights";
import { DashHeader } from "./_ui/DashHeader";
import { Section } from "./_ui/Section";
import { CommunityTrend } from "./_charts/CommunityTrend";
import { HourlyBars } from "./_charts/HourlyBars";
import { PlaysVisitorsArea } from "./_charts/PlaysVisitorsArea";
import { TopGamesBar } from "./_charts/TopGamesBar";
import { CategoryDonut } from "./_charts/CategoryDonut";
import { SplitBars } from "./_charts/SplitBars";
import { Sparkline } from "./_charts/Sparkline";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "HALLPASS live analytics — plays, players, and engagement.",
  robots: { index: false, follow: false },
};

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);
function compact(n: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

const C = {
  plays: "#7c2eef",
  visitors: "#ff4f8b",
  cyan: "#00cfd6",
  yellow: "#ffc700",
};

export default async function DashboardPage() {
  // Layout gates this subtree, but a layout and page render concurrently — guard
  // here too so no data is fetched for an unauthorized request. Re-checks live role.
  await requireRole("admin");

  const [stats, community, games] = await Promise.all([
    getDashboardStats(),
    getCommunityStats(),
    resolveGames(),
  ]);

  // One clock for the whole render, so two chips a millisecond apart cannot
  // disagree about what "today" is.
  const now = new Date();

  const playsPeak = Math.max(1, ...stats.daily.map((d) => d.plays));
  const playsSeries = stats.daily.map((d) => d.plays);
  const visitorsSeries = stats.daily.map((d) => d.visitors);
  const searchesSeries = stats.daily.map((d) => d.searches);

  // Resolve slugs → titles for the bar chart (server-side; charts stay dumb).
  // Use override-aware titles so renamed games show their curated label.
  const titleBySlug = new Map(games.map((g) => [g.slug, g.title]));
  const topGames = stats.topGames.map((g) => ({
    label: titleBySlug.get(g.slug) ?? g.slug,
    value: g.plays,
  }));

  // The rhythm panel's headline. `hourly` is dense (24 buckets, mostly zeros on
  // a quiet project), so an empty picture has to be detected from the TOTAL —
  // `hourly.length` is 24 either way and would render an all-zero chart.
  const playsByHourTotal = stats.hourly.reduce((sum, h) => sum + h.value, 0);
  const busiestHour = peak(stats.hourly, (h) => h.value);

  // Recommend rate over the visible comments. `recommended` is NOT NULL, so the
  // remainder is exactly the not-recommended half.
  const recommendRate = share(community.recommended, community.comments);
  const notRecommended = community.comments - community.recommended;

  // Most-commented games — first-party (reviews live in our Neon DB, not PostHog).
  // Resolve slugs → curated titles here so the chart stays presentational.
  const topCommented = community.topCommented.map((g) => ({
    label: titleBySlug.get(g.slug) ?? g.slug,
    value: g.count,
  }));

  return (
    <>
      <DashHeader
        title="Dashboard"
        subtitle="Live analytics · last 30 days vs. prior 30 days"
        action={
          <Link
            href="/"
            className="text-sm font-semibold text-brand hover:text-brand-600"
          >
            ← Back to arcade
          </Link>
        }
      />

      {!stats.configured && (
        <Notice tone="amber">
          PostHog server credentials missing. Set{" "}
          <code className="font-mono">POSTHOG_PERSONAL_API_KEY</code> (scope{" "}
          <code className="font-mono">query:read</code>) and{" "}
          <code className="font-mono">POSTHOG_PROJECT_ID</code> to see live traffic.
        </Notice>
      )}
      {stats.unavailable && (
        <Notice tone="rose">
          Live analytics are temporarily unavailable.
          {process.env.NODE_ENV !== "production" && stats.unavailableReason && (
            <div className="mt-2 break-words font-mono text-xs">
              {stats.unavailableReason}
            </div>
          )}
        </Notice>
      )}

      {/* KPI row — each card keeps its delta badge; three gain a sparkline. */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Plays"
          value={fmt(stats.totalPlays)}
          delta={stats.playsDelta}
          spark={playsSeries}
          sparkColor={C.plays}
        />
        <StatCard
          label="Unique visitors"
          value={fmt(stats.uniqueVisitors)}
          delta={stats.visitorsDelta}
          spark={visitorsSeries}
          sparkColor={C.visitors}
        />
        <StatCard
          label="Plays / visitor"
          value={
            stats.uniqueVisitors
              ? (stats.totalPlays / stats.uniqueVisitors).toFixed(1)
              : "—"
          }
          hint="Engagement depth"
        />
        <StatCard
          label="Searches"
          value={fmt(stats.searches)}
          delta={stats.searchesDelta}
          spark={searchesSeries}
          sparkColor={C.cyan}
        />
      </section>

      {/* Trend + top games */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section
          title="Plays & visitors"
          subtitle="last 30 days"
          className="lg:col-span-2"
        >
          {stats.daily.length === 0 ? (
            <Empty />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-5 text-xs font-semibold text-muted">
                <LegendDot color={C.plays} label="Plays" />
                <LegendDot color={C.visitors} label="Unique visitors" />
                <span className="ml-auto tabular-nums">
                  Peak {fmt(playsPeak)}/day
                </span>
              </div>
              <PlaysVisitorsArea data={stats.daily} />
              <div className="mt-2 flex justify-between text-xs text-muted">
                <span>{stats.daily[0]?.date}</span>
                <span>{stats.daily[stats.daily.length - 1]?.date}</span>
              </div>
            </>
          )}
        </Section>

        <Section title="Top games" subtitle="by plays">
          {topGames.length === 0 ? <Empty /> : <TopGamesBar data={topGames} />}
        </Section>
      </div>

      {/*
        The first-party half of the trend. PostHog above counts anonymous plays;
        this counts the things that only exist in our own database — accounts,
        scores, comments — so the two questions "is the arcade busy?" and "is the
        community growing?" sit next to each other instead of being conflated.
      */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section
          title="Community growth"
          subtitle={`sign-ups, scores & comments · ${WINDOW_DAYS} days`}
          className="lg:col-span-2"
        >
          {!community.available ? (
            <Empty hint="Database not configured." />
          ) : community.daily.length === 0 ? (
            <Empty />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-semibold text-muted">
                <LegendDot color={C.plays} label="New players" />
                <LegendDot color={C.cyan} label="Scores" />
                <LegendDot color={C.visitors} label="Comments" />
              </div>
              <CommunityTrend data={community.daily} />
              <div className="mt-2 flex justify-between text-xs text-muted">
                <span>{community.daily[0]?.date}</span>
                <span>{community.daily[community.daily.length - 1]?.date}</span>
              </div>
            </>
          )}
        </Section>

        <Section title="Player engagement" subtitle="of everyone signed up">
          {!community.available ? (
            <Empty hint="Database not configured." />
          ) : community.players === 0 ? (
            <Empty hint="No players have signed in yet." />
          ) : (
            <div className="grid grid-cols-2 gap-5">
              <Insight
                value={fmt(community.activePlayers7)}
                label="Active"
                note="signed in this week"
              />
              <Insight
                value={fmt(community.returningPlayers)}
                label="Came back"
                note={pctNote(community.returningPlayers, community.players, "of players")}
              />
              <Insight
                value={fmt(community.scoringPlayers)}
                label="Have scored"
                note={pctNote(community.scoringPlayers, community.players, "of players")}
              />
              <Insight
                value={fmt(community.identifiedScores)}
                label="Named scores"
                note={pctNote(community.identifiedScores, community.scores, "of all scores")}
              />
            </div>
          )}
        </Section>
      </div>

      {/*
        WHEN the arcade is busy. The audience is at school, so its traffic has a
        timetable — and a chart of it answers a scheduling question no total can:
        when a new game should land, and when a deploy is least rude.
      */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section
          title="Daily rhythm"
          subtitle="plays by hour · project time"
          className="lg:col-span-2"
        >
          {playsByHourTotal === 0 ? (
            <Empty hint="No plays in range." />
          ) : (
            <>
              {busiestHour && (
                <div className="mb-3 text-xs font-semibold text-muted">
                  Busiest at {hourLabel(busiestHour.hour)} —{" "}
                  <span className="tabular-nums">{fmt(busiestHour.value)}</span> plays
                </div>
              )}
              <HourlyBars data={stats.hourly} />
            </>
          )}
        </Section>
        <Section title="By weekday" subtitle="plays, last 30 days">
          {playsByHourTotal === 0 ? (
            <Empty hint="No plays in range." />
          ) : (
            <SplitBars data={stats.weekdays} color={C.plays} />
          )}
        </Section>
      </div>

      {/* Most commented games — first-party review counts, mirrors "Top games". */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section
          title="Most commented games"
          subtitle="by player comments"
          className="lg:col-span-2"
        >
          {!community.available ? (
            <Empty hint="Database not configured." />
          ) : topCommented.length === 0 ? (
            <Empty hint="No comments yet." />
          ) : (
            <TopGamesBar
              data={topCommented}
              barName="Comments"
              color={C.visitors}
            />
          )}
        </Section>
        {/*
          Was a single 6xl total. The count was already the first MiniStat in the
          Community panel, so the panel's whole job was repetition; what nothing
          on the page said was whether those comments are POSITIVE, whether any
          of them have been reported, and whether people are still writing them.
        */}
        <Section title="Comments" subtitle="what players said">
          {!community.available ? (
            <Empty hint="Database not configured." />
          ) : community.comments === 0 ? (
            <Empty hint="No comments yet." />
          ) : (
            <div className="flex h-64 flex-col justify-center gap-5">
              <div>
                <div className="flex items-end gap-2">
                  <div className="text-5xl font-black tabular-nums">
                    {recommendRate === null ? "—" : `${Math.round(recommendRate)}%`}
                  </div>
                  <DeltaBadge delta={community.commentsDelta} />
                </div>
                <div className="mt-1 text-sm font-medium text-muted">
                  recommend the game they played
                </div>
              </div>

              {/* The split as one bar — the ratio is the point, not the pixels. */}
              <div>
                <div
                  className="flex h-2.5 overflow-hidden rounded-full bg-surface-2"
                  role="img"
                  aria-label={`${fmt(community.recommended)} recommended, ${fmt(notRecommended)} not`}
                >
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${recommendRate ?? 0}%` }}
                  />
                  <div className="flex-1 bg-rose-400" />
                </div>
                <div className="mt-2 flex justify-between text-xs font-semibold text-muted">
                  <span>{fmt(community.recommended)} recommended</span>
                  <span>{fmt(notRecommended)} not</span>
                </div>
              </div>

              {community.flaggedComments > 0 ? (
                <Link
                  href="/dashboard/moderation"
                  className="text-sm font-semibold text-amber-700 hover:text-amber-800"
                >
                  {fmt(community.flaggedComments)} reported — review →
                </Link>
              ) : (
                <div className="text-sm text-muted">Nothing reported.</div>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Breakdown row */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Section title="Category mix" subtitle="plays by category">
          {stats.categories.length === 0 ? (
            <Empty hint="No category data." />
          ) : (
            <CategoryDonut data={stats.categories} />
          )}
        </Section>
        <Section title="Devices" subtitle="by plays">
          {stats.devices.length === 0 ? (
            <Empty hint="No device data." />
          ) : (
            <SplitBars data={stats.devices} color={C.cyan} />
          )}
        </Section>
        <Section title="Top countries" subtitle="by visitors">
          {stats.countries.length === 0 ? (
            <Empty hint="No geography data." />
          ) : (
            <SplitBars data={stats.countries} color={C.yellow} />
          )}
        </Section>
      </div>

      {/* Searches + community */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section title="Top searches" subtitle="people, last 30 days">
          {stats.searchTerms.length === 0 ? (
            <Empty hint="No searches in range." />
          ) : (
            <ul className="space-y-2.5">
              {stats.searchTerms.map((t) => (
                <li
                  key={t.label}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate">
                    <span className="text-muted">“</span>
                    <span className="font-semibold">{t.label}</span>
                    <span className="text-muted">”</span>
                  </span>
                  <span className="font-mono tabular-nums text-muted">
                    {fmt(t.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/*
          The one search panel that is directly actionable: every row is a game
          somebody wanted and could not find, which is a shortlist of what to add
          next. Counted in PEOPLE, and prefix chains are collapsed upstream, so a
          row of 11 is eleven players rather than one player's eleven keystrokes.
        */}
        <Section title="Found nothing" subtitle="searches with no match">
          {stats.zeroResultTerms.length === 0 ? (
            <Empty hint="Every search matched a game." />
          ) : (
            <ul className="space-y-2.5">
              {stats.zeroResultTerms.map((t) => (
                <li
                  key={t.label}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate">
                    <span className="text-muted">“</span>
                    <span className="font-semibold">{t.label}</span>
                    <span className="text-muted">”</span>
                  </span>
                  <span className="font-mono tabular-nums text-amber-700">
                    {fmt(t.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/*
          The other half of the leaderboard question. "15 boards" says how many
          exist; this says which ones anybody uses — and names the ones that have
          never received a score, which is the actionable end of the list.
        */}
        <Section title="Busiest boards" subtitle="by scores submitted">
          {!community.available ? (
            <Empty hint="Database not configured." />
          ) : community.topBoards.length === 0 ? (
            <Empty hint="No boards yet." />
          ) : (
            <>
              <ul className="space-y-2.5">
                {community.topBoards.map((board) => (
                  <li
                    key={board.id}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/boards/${board.id}`}
                        className="block truncate font-semibold hover:text-brand"
                      >
                        {board.title}
                      </Link>
                      <div className="text-xs text-muted">{boardNote(board)}</div>
                    </div>
                    <span className="shrink-0 font-mono tabular-nums text-muted">
                      {fmt(board.scores)}
                    </span>
                  </li>
                ))}
              </ul>
              {community.emptyBoards > 0 && (
                <p className="mt-4 text-xs text-muted">
                  {fmt(community.emptyBoards)} of {fmt(community.boards)} boards
                  have never received a score.
                </p>
              )}
            </>
          )}
        </Section>
      </div>

      {/* Community — the roll-up, full width under the panels that break it down. */}
      <div className="mt-6">
        <Section title="Community" subtitle="leaderboards & verified players">
          {!community.available ? (
            <Empty hint="Database not configured." />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-8">
                <MiniStat
                  label="Players"
                  value={compact(community.players)}
                  delta={community.playersDelta}
                />
                <MiniStat label="Boards" value={compact(community.boards)} />
                <MiniStat
                  label="Scores"
                  value={compact(community.scores)}
                  delta={community.scoresDelta}
                />
                <MiniStat
                  label="Comments"
                  value={compact(community.comments)}
                  delta={community.commentsDelta}
                />
              </div>
              <div className="lg:border-l lg:border-border lg:pl-6">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
                  Newest players
                </div>
                {community.recentPlayers.length === 0 ? (
                  <p className="text-sm text-muted">No players have signed in yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {community.recentPlayers.map((p, i) => (
                      <div
                        key={`${p.name}-${i}`}
                        className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3"
                      >
                        {p.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.image}
                            alt=""
                            width={24}
                            height={24}
                            referrerPolicy="no-referrer"
                            className="h-6 w-6 rounded-full object-cover"
                          />
                        ) : (
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-[11px] font-black text-brand">
                            {p.name[0]?.toUpperCase()}
                          </span>
                        )}
                        <span className="max-w-[10rem] truncate text-sm font-semibold">
                          {p.name}
                        </span>
                        {/*
                          When they joined, not just that they are recent: eight
                          names with no dates read the same whether the last one
                          arrived yesterday or in March.
                        */}
                        {agoLabel(p.joinedAt, now) && (
                          <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                            {agoLabel(p.joinedAt, now)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- components */

function StatCard({
  label,
  value,
  delta,
  spark,
  sparkColor,
  hint,
}: {
  label: string;
  value: string;
  delta?: Delta;
  spark?: number[];
  sparkColor?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="text-3xl font-black tabular-nums">{value}</div>
        {delta && <DeltaBadge delta={delta} />}
      </div>
      {spark && spark.length > 0 ? (
        <div className="mt-3">
          <Sparkline data={spark} color={sparkColor ?? "#7c2eef"} />
        </div>
      ) : hint ? (
        <div className="mt-auto pt-3 text-xs font-medium text-muted">{hint}</div>
      ) : null}
    </div>
  );
}

function DeltaBadge({ delta }: { delta: Delta }) {
  if (delta.pct === null) {
    return <span className="mb-1 text-xs font-semibold text-muted">— new</span>;
  }
  const up = delta.pct >= 0;
  const rounded =
    Math.abs(delta.pct) >= 100 ? Math.round(delta.pct) : delta.pct.toFixed(1);
  return (
    <span
      className={`mb-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
      title={`Previous period: ${fmt(delta.prev)}`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(Number(rounded))}%
    </span>
  );
}

/**
 * A number over a label, four to a row in the community panel.
 *
 * `min-w-0` + `truncate` are load-bearing, not decoration. Tailwind's
 * `grid-cols-4` is `repeat(4, minmax(0, 1fr))`, so a track is free to be
 * narrower than its content — and an uppercase single word like "LEADERBOARDS"
 * has no wrap opportunity, so it overflowed its cell and printed straight
 * THROUGH the neighbouring stat on a narrow viewport. Clipping is the honest
 * failure mode for a label that will not fit; overlapping two labels is not.
 * The labels themselves are kept short (`Boards`, not `Leaderboards`) so it
 * never comes to that at any width the dashboard actually renders at, and the
 * four-across split now waits for `sm` instead of starting at 380px.
 */
function MiniStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  /** Last 30 days vs. the 30 before. Omitted where the count has no window. */
  delta?: Delta;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-end gap-1.5">
        <div className="text-3xl font-black tabular-nums">{value}</div>
        {delta && <DeltaBadge delta={delta} />}
      </div>
      <div
        title={label}
        className="mt-0.5 truncate text-xs font-semibold uppercase tracking-wide text-muted"
      >
        {label}
      </div>
    </div>
  );
}

/**
 * A number with a label and a line of context under it.
 *
 * The context line is the point: "48 came back" is a number, "48 — 61% of
 * players" is an answer. {@link pctNote} writes it, and says "no baseline yet"
 * rather than "0%" when there is nothing to divide by, because a fresh database
 * reporting 0% engagement would be a lie about the players rather than a fact
 * about the data.
 */
function Insight({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div
        title={label}
        className="mt-0.5 truncate text-xs font-semibold uppercase tracking-wide text-muted"
      >
        {label}
      </div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}

/**
 * The line under a board's title. Three different states, because a count of
 * scores alone cannot tell them apart: a board nobody has ever written to, one
 * carrying only anonymous handles (working, but the sign-in prompt is not
 * landing on it), and one with verified players on it.
 */
function boardNote(board: ActiveBoard): string {
  if (board.scores === 0) return "never used";
  if (board.players === 0) return "anonymous scores only";
  return `${fmt(board.players)} verified ${board.players === 1 ? "player" : "players"}`;
}

function pctNote(part: number, whole: number, suffix: string): string {
  const pct = share(part, whole);
  return pct === null ? "no baseline yet" : `${pct}% ${suffix}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "amber" | "rose";
  children: React.ReactNode;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-rose-300 bg-rose-50 text-rose-900";
  return (
    <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function Empty({ hint = "No data yet." }: { hint?: string }) {
  return <div className="py-8 text-center text-sm text-muted">{hint}</div>;
}
