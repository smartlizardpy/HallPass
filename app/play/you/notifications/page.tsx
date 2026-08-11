/**
 * `/play/you/notifications` — the NOTIFICATIONS tab.
 *
 * The page that did not exist. Before it, the site could send a push but offered
 * nowhere to switch one on, nothing to choose between, and no record of what had
 * already been sent — a player who dismissed one promo modal had no route back
 * to the feature at all.
 *
 * Three sections, in the order somebody actually needs them:
 *
 *   1. THIS DEVICE. The permission and subscription, which is the thing that was
 *      missing and the only control here that is per-browser rather than
 *      per-account.
 *   2. WHAT YOU WANT TO HEAR ABOUT. One three-way switch per kind. This is the
 *      page's real subject.
 *   3. RECENT. The history, so "See all" from the bell lands somewhere that
 *      shows more than the bell does.
 *
 * Settings before history, deliberately, even though the bell's link says "See
 * all": the bell ALREADY shows the recent list, so a page that opened with a
 * longer copy of it would bury the only thing the bell cannot do. The history is
 * capped and short in practice, so it costs a signed-in player one scroll.
 *
 * ── EVERY SECTION DEGRADES ON ITS OWN ──────────────────────────────────────
 * The same posture as the Settings tab next door, and for the same reason: these
 * reads touch tables that migration 024 creates, and a deploy where it has not
 * run yet must cost a section rather than the page. `getInbox` and
 * `getResolvedPrefs` are both fail-soft in the barrel, and the audience read
 * fails closed to `player`.
 *
 * ── `robots` IS SET HERE, NOT INHERITED ────────────────────────────────────
 * The layout's docblock predicted this exact page: metadata merges SHALLOWLY, so
 * a tab setting its own `robots` replaces the layout's wholesale and a tab
 * setting none inherits it "only by luck". This subtree carries a school-age
 * player's notification history — who challenged them, what they play, who their
 * friends are — so the directive is repeated here rather than relied upon.
 */

import type { Metadata } from "next";
import { NotificationPrefs } from "@/app/components/notifications/NotificationPrefs";
import { PushDeviceCard } from "@/app/components/notifications/PushDeviceCard";
import { getInbox, getResolvedPrefs } from "@/app/lib/notifications";
import { audienceFor } from "@/app/lib/notifications/admins";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_LIST_LIMIT,
  isNotificationKind,
  kindsForAudience,
} from "@/app/lib/notifications/config";
import { readPlayer, readPlayerId } from "../_data";

export const metadata: Metadata = {
  title: "Notifications",
  // Repeated from the layout on purpose — see the note above and the long one in
  // `layout.tsx`. This page renders what a player has been told, by name.
  robots: { index: false, follow: false },
};

/**
 * "3 Feb" / "3 Feb 2025" — server-rendered with a FIXED locale.
 *
 * `toLocaleDateString` with no locale resolves against the runtime's, which
 * differs between the server and the browser and would be a hydration mismatch.
 * The bell can use a relative "2h" because it never renders on the server; this
 * page does, so it uses an absolute date instead of reaching for a clock.
 */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function YouNotificationsPage() {
  const [playerId, player] = await Promise.all([readPlayerId(), readPlayer()]);
  // The layout does not render `children` without a player; this narrows the
  // type and keeps the page honest if that ever changes.
  if (!playerId || !player) return null;

  // Fails closed to `player`, so a database blip cannot reveal that the
  // moderation kinds exist to somebody who is not an admin.
  const audience = await audienceFor(player.email);
  const kinds = kindsForAudience(audience);

  const [prefs, inbox] = await Promise.all([
    getResolvedPrefs(playerId, kinds),
    getInbox(playerId, NOTIFICATION_LIST_LIMIT),
  ]);

  return (
    <div className="space-y-8">
      {/* THIS DEVICE ------------------------------------------------------- */}
      <section aria-labelledby="notif-device" className="space-y-4">
        <h2
          id="notif-device"
          className="px-1 text-xs font-black uppercase tracking-wider text-muted"
        >
          This device
        </h2>
        <PushDeviceCard />
      </section>

      {/* WHAT YOU GET ------------------------------------------------------ */}
      <section aria-labelledby="notif-prefs" className="space-y-4">
        <h2
          id="notif-prefs"
          className="px-1 text-xs font-black uppercase tracking-wider text-muted"
        >
          What you get
        </h2>
        <NotificationPrefs kinds={kinds} initial={prefs} />
      </section>

      {/* RECENT ------------------------------------------------------------ */}
      <section aria-labelledby="notif-recent" className="space-y-4">
        <h2
          id="notif-recent"
          className="px-1 text-xs font-black uppercase tracking-wider text-muted"
        >
          Recent
        </h2>

        {inbox.items.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="text-sm text-muted">
              Nothing yet. Challenges, new games and what you unlock will show up
              here — and in the bell at the top of every page.
            </p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-border bg-surface">
            {inbox.items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.url}
                  className={`flex gap-3 border-b border-border p-4 transition last:border-b-0 hover:bg-surface-2 ${
                    item.isNew ? "bg-brand-50/60" : ""
                  }`}
                >
                  <span aria-hidden className="mt-0.5 shrink-0 text-base">
                    {/* The barrel already drops rows this deploy has no kind
                        for, so the fallback is unreachable — it is here so the
                        narrowing is explicit rather than an assertion. */}
                    {isNotificationKind(item.kind)
                      ? NOTIFICATION_KINDS[item.kind].icon
                      : "🔔"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-black text-foreground">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-xs font-bold text-muted">
                        {formatWhen(item.createdAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {item.body}
                    </span>
                  </span>
                  {item.isNew && (
                    <span
                      aria-label="New"
                      role="img"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand"
                    />
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
