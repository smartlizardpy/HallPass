/**
 * HallPass dashboard — the referrals desk (`/dashboard/referrals`), SUPER ADMIN only.
 *
 * Friend referrals pay candy (docs/referrals-design.md). This page shows how the
 * share loop is doing (copies, visits, friends attributed, qualified, candy paid,
 * visit → qualified conversion), lets a super admin switch the feature off or change
 * the bonus and the per-player cap, lists every referral with the suspicious-activity
 * flags, and revokes a payout with a reason. The window is the championship's own
 * and is not edited here.
 *
 * PRIVACY. Players appear by public name and public id only (the store selects
 * nothing else). The referrer sees counts only; this page is the only place the
 * pairing is visible.
 *
 * Failure modes follow the Candy desk: an unconfigured database or a missing
 * migration render a notice; any other error is rethrown.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { isMissingColumnError, isUnconfiguredDbError } from "@/app/lib/db";
import { REFERRALS, referralStore } from "@/app/lib/referrals";
import type { AdminReferral, ReferralStats } from "@/app/lib/referrals/store";
import type { ReferralRules } from "@/app/lib/referrals/config";
import { formatInstant } from "@/app/lib/championship/format";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { revokeReferralAction, saveReferralSettingsAction } from "./actions";

export const metadata: Metadata = {
  title: "Referrals",
  description: "Friend referrals for Fright Fest: settings, payouts, suspicious activity.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const when = (iso: string | null) => (iso ? formatInstant(iso, "Europe/London") : "");

const BTN = "rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-40";
const BTN_PRIMARY = `${BTN} bg-brand text-white hover:bg-brand-600`;
const BTN_DANGER = `${BTN} bg-red-600 text-white hover:bg-red-700`;
const INPUT = "rounded-lg border border-border bg-surface px-2 py-1 text-xs";

const TONE: Record<string, string> = {
  rewarded: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  capped: "bg-surface-2 text-foreground-2",
  ineligible: "bg-surface-2 text-foreground-2",
  revoked: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

function Banner({ tone, children }: { tone: "ok" | "error" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200"
      : tone === "error"
        ? "border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200"
        : "border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "–";
}

export default async function ReferralsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("super_admin");
  const params = await searchParams;
  const ok = one(params.ok);
  const error = one(params.error);

  let stats: ReferralStats | null = null;
  let rows: AdminReferral[] = [];
  let rules: ReferralRules = { enabled: REFERRALS.enabled, bonus: REFERRALS.bonus, cap: REFERRALS.cap };
  let unavailable: "unconfigured" | "schema" | null = null;
  try {
    [stats, rows, rules] = await Promise.all([referralStore.stats(), referralStore.listReferrals(150), referralStore.rules()]);
  } catch (err) {
    if (isUnconfiguredDbError(err)) unavailable = "unconfigured";
    else if (isMissingColumnError(err) || /relation "referral/.test(String((err as Error)?.message))) unavailable = "schema";
    else throw err;
  }
  const flagged = rows.filter((r) => r.flags.length > 0);

  const cell = (label: string, value: number | string) => (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-xl font-black">{value}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <DashHeader
        title="Referrals"
        subtitle={`Friend invites for ${REFERRALS.eventId.replace(/-/g, " ")}, paid in candy. ${when(REFERRALS.opensAt)} to ${when(REFERRALS.closesAt)}. Super admins only.`}
      />
      {ok && <Banner tone="ok">{ok}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {unavailable === "unconfigured" && <Banner tone="warn">No database is configured (`DATABASE_URL`).</Banner>}
      {unavailable === "schema" && (
        <Banner tone="warn">
          The referral tables are missing. Apply migration <code>052_referrals.sql</code> (see <code>scripts/migrate-prod.sh</code>). Until
          then the panel on /fright-fest says invites are unavailable and nothing is paid.
        </Banner>
      )}

      {!unavailable && stats && (
        <div className="space-y-6">
          <Section title="At a glance" subtitle="Our own database: exact, unaffected by ad blockers">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {cell("Invite links made", stats.codes)}
              {cell("Link visits", stats.visits)}
              {cell("Friends attributed", stats.attributed)}
              {cell("Qualified (played)", stats.qualified)}
              {cell("Visit → qualified", pct(stats.qualified, stats.visits))}
              {cell("Candy paid", stats.candyAwarded)}
              {cell("Rewarded", stats.rewarded)}
              {cell("Capped (no candy)", stats.capped)}
              {cell("Returning (no reward)", stats.ineligible)}
              {cell("Revoked", stats.revoked)}
              {cell("Posts copied", stats.counters.post_copy)}
              {cell("Comments copied", stats.counters.comment_copy)}
              {cell("Invite links copied", stats.counters.link_copy)}
              {cell("Invite messages copied", stats.counters.message_copy)}
              {cell("Invite dialogs opened", stats.counters.invite_open)}
            </div>
            <p className="mt-3 text-xs text-muted">
              A visit is one landing on a link in a browser; a refresh is not counted again. Nothing is paid for copies, visits or
              attributions: only for a new friend&apos;s first accepted ranked run.
            </p>
          </Section>

          <Section title="Settings" subtitle="Applies at once to every payout still to be made; payouts already made keep their amount">
            <form action={saveReferralSettingsAction} className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input type="checkbox" name="enabled" defaultChecked={rules.enabled} />
                Referrals on
              </label>
              <label className="text-xs font-bold">
                Candy per friend
                <input name="bonus" type="number" min={0} max={100} defaultValue={rules.bonus} className={`${INPUT} ml-2 w-20`} />
              </label>
              <label className="text-xs font-bold">
                Max rewarded friends per player
                <input name="cap" type="number" min={0} max={20} defaultValue={rules.cap} className={`${INPUT} ml-2 w-20`} />
              </label>
              <button type="submit" className={BTN_PRIMARY}>
                Save
              </button>
            </form>
            <p className="mt-2 text-xs text-muted">
              Code defaults: {REFERRALS.bonus} candy, cap {REFERRALS.cap}. The maximum a player can earn is bonus × cap ({rules.bonus * rules.cap}).
              Turning referrals off stops new attributions and payouts; the share buttons still copy.
            </p>
          </Section>

          <Section title={`Suspicious activity (${flagged.length})`} subtitle="Flags are signals for a human, never automatic blocks. Schools share IPs, so IPs are not used">
            {flagged.length === 0 ? (
              <p className="text-sm text-muted">Nothing flagged.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {flagged.map((r) => (
                  <li key={r.id}>
                    #{r.id} <strong>{r.referrer.name}</strong> → {r.referred.name}:{" "}
                    {r.flags.map((f) => (f === "burst" ? "3+ friends' accounts created within 10 minutes" : "referrer's account was under an hour old")).join("; ")}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Referrals" subtitle="Newest first. Names are public names; the referrer never sees who">
            {rows.length === 0 ? (
              <p className="text-sm text-muted">No referrals yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-muted">#{r.id}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[r.status]}`}>{r.status}</span>
                      <strong>{r.referrer.name}</strong> invited <strong>{r.referred.name}</strong>
                      {r.amount > 0 && <span className="text-xs">· {r.amount} candy</span>}
                      {r.flags.length > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">· flagged: {r.flags.join(", ")}</span>}
                    </div>
                    <div className="text-xs text-muted">
                      Joined {when(r.attributedAt)}
                      {r.qualifiedAt ? ` · qualified ${when(r.qualifiedAt)}` : ""}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </div>
                    {r.status === "rewarded" && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-bold text-red-700 dark:text-red-300">Revoke…</summary>
                        <form action={revokeReferralAction} className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="referralId" value={r.id} />
                          <input name="reason" required maxLength={500} placeholder="Reason (audit log)" autoComplete="off" className={`${INPUT} min-w-64 flex-1`} />
                          <button type="submit" className={BTN_DANGER}>
                            Revoke payout
                          </button>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
