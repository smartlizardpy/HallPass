/**
 * HallPass dashboard — the Candy Hunt desk (`/dashboard/candy`), SUPER ADMIN only.
 *
 * Rate every achievement across games (the owner's rubric as presets, or any
 * number from 0 to 40), filter by game, see how many still pay nothing, watch the
 * newest credits and spends, revoke a credit with a reason, and read the audit
 * log. Rules and amounts live in `app/lib/candy/fright-fest-2026.ts` and change
 * by commit; only the per-achievement values are edited here.
 *
 * "UNRATED" MEANS 0. The column defaults to 0 and 0 is also a legitimate rating
 * (the rubric's "Launch a game"), so the two cannot be told apart; the count is
 * of achievements that pay nothing, and the panel says so.
 *
 * PRIVACY. Players appear by public name and public id only; the store selects
 * nothing else. The emails in the audit log are staff dashboard accounts, which
 * is the point of an audit log.
 *
 * Failure modes follow `collectibles/page.tsx`: an unconfigured database or a
 * missing migration render a notice; any other error is rethrown, because "no
 * credits" must never be a disguised outage.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { isMissingColumnError, isUnconfiguredDbError } from "@/app/lib/db";
import { CANDY, candyStore } from "@/app/lib/candy";
import type { AdminAchievement, AdminLedgerRow, CandyLogEntry, CandyStats } from "@/app/lib/candy/store";
import { formatInstant } from "@/app/lib/championship/format";
import { resolveGamesIncludingStaged } from "@/app/lib/games-store";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { revokeCreditAction, setCandyValueAction } from "./actions";

export const metadata: Metadata = {
  title: "Candy",
  description: "Rate achievements in candy, revoke credits, read the audit log.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const TZ = "Europe/London";
const when = (iso: string | null) => (iso ? formatInstant(iso, TZ) : "");
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const BTN = "rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-40";
const BTN_PRIMARY = `${BTN} bg-brand text-white hover:bg-brand-600`;
const BTN_DANGER = `${BTN} bg-red-600 text-white hover:bg-red-700`;
const INPUT = "rounded-lg border border-border bg-surface px-2 py-1 text-xs";

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

function Banner({ tone, children }: { tone: "ok" | "error" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200"
      : tone === "error"
        ? "border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200"
        : "border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200";
  return <div role={tone === "error" ? "alert" : "status"} className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

const KIND_TONE = { achievement: "brand", ranked_run: "green", all_boards: "green", placing: "amber", spend: "zinc" } as const;

export default async function CandyDeskPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("super_admin");
  const params = await searchParams;
  const ok = one(params.ok);
  const error = one(params.error);
  const gameParam = one(params.game);
  const game = gameParam && SLUG_RE.test(gameParam) ? gameParam : null;

  let all: AdminAchievement[] = [];
  let recent: AdminLedgerRow[] = [];
  let log: CandyLogEntry[] = [];
  let stats: CandyStats | null = null;
  let unavailable: "unconfigured" | "schema" | null = null;
  try {
    [all, recent, log, stats] = await Promise.all([
      candyStore.listAchievements(null),
      candyStore.listRecent(50),
      candyStore.readLog(100),
      candyStore.stats(),
    ]);
  } catch (err) {
    if (isUnconfiguredDbError(err)) unavailable = "unconfigured";
    else if (isMissingColumnError(err)) unavailable = "schema";
    else throw err;
  }

  const titles = new Map<string, string>();
  for (const g of await resolveGamesIncludingStaged()) titles.set(g.slug, g.title);
  const title = (slug: string) => titles.get(slug) ?? slug;

  const slugs = [...new Set(all.map((a) => a.slug))].sort((a, b) => title(a).localeCompare(title(b)));
  const shown = game ? all.filter((a) => a.slug === game) : all;
  const unrated = all.filter((a) => a.candy === 0);
  const unratedShown = shown.filter((a) => a.candy === 0);
  const unratedWithUnlocks = unrated.filter((a) => a.unlockedInWindow > 0).length;

  return (
    <div className="mx-auto max-w-6xl">
      <DashHeader
        title="Candy"
        subtitle={`${CANDY.title}: Halloween Candy for ${CANDY.id.replace(/-/g, " ")}. Spend by ${CANDY.spendUntilLabel}. Super admins only.`}
      />
      {ok && <Banner tone="ok">{ok}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {unavailable === "unconfigured" && <Banner tone="warn">No database is configured (`DATABASE_URL`).</Banner>}
      {unavailable === "schema" && (
        <Banner tone="warn">
          The candy tables are missing. Apply migration <code>050_candy.sql</code> (see <code>scripts/migrate-prod.sh</code>). Ratings,
          credits and the audit log are unavailable until then.
        </Banner>
      )}
      <div className="space-y-6">
        {!unavailable && (
          <>
            <StatsPanel stats={stats} total={all.length} unrated={unrated.length} unratedWithUnlocks={unratedWithUnlocks} />
            <RubricPanel />
            <RatingsPanel
              rows={shown}
              slugs={slugs}
              game={game}
              title={title}
              unratedShown={unratedShown.length}
            />
            <RecentPanel rows={recent} game={game} />
            <LogPanel log={log} />
          </>
        )}
      </div>
    </div>
  );
}

function StatsPanel({ stats, total, unrated, unratedWithUnlocks }: { stats: CandyStats | null; total: number; unrated: number; unratedWithUnlocks: number }) {
  const cell = (label: string, value: number | string) => (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-xl font-black">{value}</div>
    </div>
  );
  return (
    <Section title="At a glance" subtitle={`Earning ${when(CANDY.opensAt)} to ${when(CANDY.closesAt)}; spending until ${CANDY.spendUntilLabel}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {cell("Players paid", stats?.players ?? 0)}
        {cell("Candy credited", stats?.credited ?? 0)}
        {cell("Candy spent", stats?.spent ?? 0)}
        {cell("Candy revoked", stats?.revoked ?? 0)}
        {cell("Achievements", total)}
        {cell("Paying nothing (0)", unrated)}
      </div>
      {unratedWithUnlocks > 0 && (
        <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
          {unratedWithUnlocks} achievement{unratedWithUnlocks === 1 ? " that pays" : "s that pay"} nothing {unratedWithUnlocks === 1 ? "has" : "have"} already been
          unlocked in the window. Rating {unratedWithUnlocks === 1 ? "it pays" : "them pays"} those players at their next sync.
        </p>
      )}
    </Section>
  );
}

function RubricPanel() {
  return (
    <Section title="The rubric" subtitle="Difficulty, effort, skill and farmability. Pick a band's value from the dropdown on a row, or type a number from 0 to 40">
      <ul className="grid gap-2 sm:grid-cols-2">
        {CANDY.rubric.map((t) => (
          <li key={t.label} className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs">
            <span className="font-bold">{t.label}</span>
            <span className="text-muted">{t.presets.join(" / ")}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        A game launch is 0. Changing a value never re-prices credits already made. Run {CANDY.rankedRun}, all boards {CANDY.allBoards} and placing{" "}
        {CANDY.placing.map((t) => `${t.from === t.to ? t.from : `${t.from}-${t.to}`}: ${t.amount}`).join(", ")} are set in code.
      </p>
    </Section>
  );
}

function RatingsPanel({
  rows,
  slugs,
  game,
  title,
  unratedShown,
}: {
  rows: AdminAchievement[];
  slugs: string[];
  game: string | null;
  title: (slug: string) => string;
  unratedShown: number;
}) {
  return (
    <Section
      title="Achievement values"
      subtitle={`${rows.length} shown · ${unratedShown} paying nothing (0 is both "not rated yet" and "rated 0")`}
    >
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-bold" htmlFor="candy-game">
          Game
        </label>
        <select id="candy-game" name="game" defaultValue={game ?? ""} className={INPUT}>
          <option value="">All games</option>
          {slugs.map((s) => (
            <option key={s} value={s}>
              {title(s)}
            </option>
          ))}
        </select>
        <button type="submit" className={BTN_PRIMARY}>
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No achievements{game ? " for this game" : ""} yet. Games provision them on their own dashboard page.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{a.name}</span>
                  {a.secret && <Chip tone="zinc">secret</Chip>}
                  {a.candy === 0 ? <Chip tone="amber">pays 0</Chip> : <Chip tone="green">{a.candy} candy</Chip>}
                </div>
                <div className="text-xs text-muted">
                  {title(a.slug)} · <code>{a.slug}/{a.key}</code> · {a.unlockedInWindow} unlocked in the window
                </div>
              </div>
              <form action={setCandyValueAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="achievementId" value={a.id} />
                <input type="hidden" name="game" value={game ?? ""} />
                <select name="preset" defaultValue="" aria-label={`Rubric value for ${a.name}`} className={INPUT}>
                  <option value="">Rubric…</option>
                  {CANDY.rubric.flatMap((t) => t.presets.map((p) => (
                    <option key={`${t.label}-${p}`} value={p}>
                      {t.label}: {p}
                    </option>
                  )))}
                </select>
                <input
                  name="candy"
                  type="number"
                  min={0}
                  max={CANDY.maxAchievementCandy}
                  step={1}
                  inputMode="numeric"
                  placeholder={`${a.candy}`}
                  aria-label={`Candy for ${a.name}`}
                  className={`${INPUT} w-20`}
                />
                <button type="submit" className={BTN_PRIMARY}>
                  Set
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RecentPanel({ rows, game }: { rows: AdminLedgerRow[]; game: string | null }) {
  return (
    <Section title="Recent credits and spends" subtitle={`Newest ${rows.length}, all players, UK time`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing has been credited yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const revoked = r.revokedAt !== null;
            return (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={KIND_TONE[r.kind]}>{r.kind}</Chip>
                  <span className={`font-bold ${revoked ? "line-through opacity-60" : ""}`}>
                    {r.amount > 0 ? "+" : ""}
                    {r.amount}
                  </span>
                  {r.ref && <code className="text-xs text-muted">{r.ref}</code>}
                  <span>
                    {r.player.name} <code className="text-xs text-muted">{r.player.publicId}</code>
                  </span>
                  <span className="text-xs text-muted">
                    #{r.id} · {when(r.createdAt)}
                  </span>
                  {revoked && <Chip tone="red">revoked{r.revokedBy === "system" ? " by system" : ""}</Chip>}
                </div>
                {revoked && r.revokedReason && <div className="mt-1 text-xs text-foreground-2">{r.revokedReason}</div>}
                {!revoked && r.kind !== "spend" && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-bold text-red-700 dark:text-red-300">Revoke…</summary>
                    <form action={revokeCreditAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="ledgerId" value={r.id} />
                      <input type="hidden" name="game" value={game ?? ""} />
                      <input name="reason" required maxLength={500} placeholder="Reason (audit log)" autoComplete="off" className={`${INPUT} min-w-64 flex-1`} />
                      <button type="submit" className={BTN_DANGER}>
                        Revoke credit
                      </button>
                    </form>
                    <p className="mt-1 text-xs text-muted">The credit stops counting. If it was already spent, the player&apos;s balance goes negative and blocks spending until it is positive.</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function LogPanel({ log }: { log: CandyLogEntry[] }) {
  return (
    <Section title="Audit log" subtitle={`Newest ${log.length}`}>
      {log.length === 0 ? (
        <p className="text-sm text-muted">No admin changes yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {log.map((l) => (
            <li key={l.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={l.action === "set-value" ? "green" : "red"}>{l.action}</Chip>
                <span className="text-xs text-muted">{when(l.createdAt)}</span>
                <span className="text-xs">{l.actorEmail}</span>
                {l.name && (
                  <span className="text-xs">
                    → {l.name} <code className="text-muted">{l.publicId}</code>
                  </span>
                )}
              </div>
              {l.reason && <div className="mt-1 text-xs text-foreground-2">{l.reason}</div>}
              {l.data != null && <pre className="mt-1 overflow-x-auto text-[11px] text-muted">{safeJson(l.data)}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
