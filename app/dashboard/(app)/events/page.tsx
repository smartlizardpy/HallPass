/**
 * `/dashboard/events` — the one switch for Halloween inside the GAMES (Last
 * Bell, SCP: Lockdown, and any game that asks the SDK `getEvent()`). Any
 * dashboard role may look; only a super admin may change it.
 *
 * The page is blunt about what each setting means, because the failure it
 * prevents is an operator believing "off" only hides a banner. Off removes the
 * event from every game, mid-event included.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { DASHBOARD_MIN_ROLE } from "@/app/lib/permissions";
import {
  GAME_EVENT_MODES,
  GAME_EVENT_THEME,
  gameEventNow,
  type GameEventMode,
} from "@/app/lib/events/game-event";
import { getGameEventMode } from "@/app/lib/events/game-event-mode";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { setGameEventModeAction } from "./actions";

export const metadata: Metadata = { title: "Halloween · Dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const LABEL: Record<GameEventMode, string> = { auto: "On, follows the dates", off: "Off, completely" };
const HINT: Record<GameEventMode, string> = {
  auto: "Games show Halloween while the event is running, and it ends by itself on the end date. Outside the dates there is no Halloween.",
  off: "Halloween does not exist. Every game drops it at once, even in the middle of the event: no menu entry, no decorations, no event board. Players see the normal game. Switch back to On to bring it back.",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { role } = await requireRole(DASHBOARD_MIN_ROLE);
  const { ok, error } = await searchParams;
  const mode = await getGameEventMode();
  const now = gameEventNow(mode);
  const t = GAME_EVENT_THEME;

  return (
    <>
      <DashHeader title="Halloween" subtitle="Turn the Fright Fest event on or off inside the games." />
      {ok && <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{ok}</div>}
      {error && <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

      <div className="space-y-6">
        <Section title="Right now">
          <p className="text-sm">
            Games are being told: <b>{now.active ? "Halloween is on." : "there is no Halloween."}</b>
          </p>
          {!now.active && (
            <p className="mt-1 text-xs text-muted">
              {mode === "off"
                ? "Because it is switched Off below."
                : !t.enabled
                  ? "Because the event config has enabled: false."
                  : now.phase === "ended"
                    ? "Because the event has ended."
                    : "Because the event has not started yet."}
            </p>
          )}
        </Section>

        <Section title="Switch">
          <form action={setGameEventModeAction} className="space-y-3">
            <fieldset className="space-y-2">
              <legend className="sr-only">Halloween in games</legend>
              {GAME_EVENT_MODES.map((m) => (
                <label key={m} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${m === mode ? "border-brand bg-brand-50" : "border-border bg-surface"}`}>
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

        <Section title="Good to know">
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>A change reaches open games within about a minute, and any game that is reloaded sees it immediately.</li>
            <li>The dates ({fmt(t.startAt)} to {fmt(t.endAt)}) come from the event config, the same one the site uses. Moving them is a code change.</li>
            <li>This controls the <b>games</b> only. The haunted look of the site itself follows the config dates, and only <code>enabled: false</code> in the config (plus a deploy) turns that off.</li>
            <li>If a game cannot reach HallPass at all (offline, or no SDK), it falls back to normal play, never to Halloween.</li>
          </ul>
        </Section>
      </div>
    </>
  );
}
