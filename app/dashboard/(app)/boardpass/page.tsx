/**
 * `/dashboard/boardpass` — the rollout switch and live counts for BoardPass
 * (PIN sign-in on shared school boards). Any dashboard role may look; only a
 * super admin may change the mode.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { DASHBOARD_MIN_ROLE } from "@/app/lib/permissions";
import { BOARDPASS_MODES, type BoardPassMode } from "@/app/lib/boardpass/config";
import { getBoardPassMode } from "@/app/lib/boardpass/mode";
import { isPinConfigured } from "@/app/lib/boardpass/pin";
import { getBoardPassStats, type BoardPassStats } from "@/app/lib/boardpass/stats";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { setBoardPassModeAction } from "./actions";

export const metadata: Metadata = { title: "BoardPass · Dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const LABEL: Record<BoardPassMode, string> = { off: "Off", staff: "Staff only", on: "On for everyone" };
const HINT: Record<BoardPassMode, string> = {
  off: "Kill switch. Every BoardPass route answers 404, the settings card is hidden, and open board sessions stop crediting scores.",
  staff: "Dashboard users and beta testers can create a PIN and sign in on a board. Use this to try it on a real whiteboard.",
  on: "Any player with a username can create a PIN and sign in on a board.",
};

export default async function BoardPassPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { role } = await requireRole(DASHBOARD_MIN_ROLE);
  const { ok, error } = await searchParams;
  const mode = await getBoardPassMode();
  const pepper = isPinConfigured();
  let stats: BoardPassStats | null = null;
  try {
    stats = await getBoardPassStats();
  } catch (e) {
    console.error("boardpass stats failed:", e);
  }

  return (
    <>
      <DashHeader title="BoardPass" subtitle="PIN sign-in for shared school boards." />
      {ok && <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{ok}</div>}
      {error && <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {!pepper && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-bold">BoardPass cannot sign anyone in yet</p>
          <p className="mt-1">
            <code>BOARDPASS_PIN_PEPPER</code> (32+ random characters) is not set, or this Node version has no
            built-in Argon2 (needs Node 24.7+). Until both are fixed every BoardPass route fails closed.
          </p>
        </div>
      )}

      <div className="space-y-6">
        <Section title="Rollout">
          <form action={setBoardPassModeAction} className="space-y-3">
            <fieldset className="space-y-2">
              <legend className="sr-only">BoardPass mode</legend>
              {BOARDPASS_MODES.map((m) => (
                <label key={m} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${m === mode ? "border-brand bg-brand-50" : "border-border bg-surface hover:bg-surface-2"}`}>
                  <input type="radio" name="mode" value={m} defaultChecked={m === mode} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">
                      {LABEL[m]}
                      {m === mode && <span className="ml-2 text-xs font-semibold text-brand">current</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{HINT[m]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {role === "super_admin" ? (
              <button type="submit" className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600">Save</button>
            ) : (
              <p className="text-xs text-muted">Only a super admin can change this.</p>
            )}
          </form>
        </Section>

        <Section title="Right now" subtitle="aggregates only">
          {stats ? (
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
              {[
                ["PINs set", stats.credentials],
                ["Live boards", stats.liveSessions],
                ["Players on boards", stats.livePlayers],
                ["Wrong PINs (24h)", stats.recentFailures],
                ["Locked accounts", stats.lockedAccounts],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="text-2xl font-black tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted">Counts are unavailable (is migration 051 applied?).</p>
          )}
        </Section>
      </div>
    </>
  );
}
