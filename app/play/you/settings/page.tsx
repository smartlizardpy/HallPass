/**
 * `/play/you/settings` — the SETTINGS tab.
 *
 * Everything that CHANGES something, grouped by what is at stake rather than
 * stacked flat: Identity (what you are called), Account (the doors out of this
 * page, and the preferences that do not belong in the tab bar), and a Danger
 * zone fenced off on its own. The old account page ran these seven cards
 * together in one column, which made "Save" and "Delete my account" look like
 * peers.
 *
 * Identity, the email and the signed-out state are handled once by `layout.tsx`;
 * this component only runs for a signed-in owner.
 *
 * NOTHING ON THIS PAGE IS TRUSTED FOR *WHO* IS ACTING. Both forms post to server
 * actions that re-derive the player from `auth()` themselves — no hidden
 * `playerId` field exists to forge, and the delete form supplies only a typed
 * CONFIRMATION, i.e. intent, never identity. See `app/play/account/actions.ts`.
 *
 * WHERE THE READS ARE GUARDED, and where they are not. The username card, the
 * beta card and the admin card each degrade to absent on their own, so an
 * unmigrated or briefly unreachable database costs one card rather than the
 * page. That matters more here than anywhere else on the site: this tab owns
 * SIGN OUT and DELETE MY ACCOUNT, and a failed lookup that 500'd the page would
 * lock somebody out of the only controls they have over their own account.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/lib/auth";
import { isBetaTester } from "@/app/lib/beta";
import { getUserRole } from "@/app/lib/dashboard-users";
import { UsernameCard } from "@/app/components/friends/UsernameCard";
import {
  setHandleAction,
  deleteAccountAction,
} from "@/app/play/account/actions";
import { readOwnSocial, readPlayer, readPlayerId } from "../_data";
import { StealthSettingsRow } from "../_ui/StealthSettingsRow";

export const metadata: Metadata = {
  title: "Settings",
  // Repeated from the layout on purpose — see the long note there. This is the
  // segment that renders the owner's controls beneath a header carrying their
  // email; it must never enter a search index.
  robots: { index: false, follow: false },
};

/**
 * Map a known `?error` CODE to a fixed, server-defined banner message. The CODE
 * is the only thing read from the querystring — never free text — so a crafted
 * `?error=...` can't reflect attacker-chosen copy into the styled red banner
 * (the spoofing vector this guards against). An unknown/absent code collapses to
 * `null` (no banner) or the generic message.
 */
const GENERIC_ERROR = "Something went wrong — try again.";
const ERROR_MESSAGES: Record<string, string> = {
  confirm: "Type DELETE to confirm.",
  db: GENERIC_ERROR,
};

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? GENERIC_ERROR;
}

/** The heading that opens each group. */
function GroupHeading({ id, tone, children }: {
  id: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className={`px-1 text-xs font-black uppercase tracking-wider ${
        tone === "danger" ? "text-red-900" : "text-muted"
      }`}
    >
      {children}
    </h2>
  );
}

export default async function YouSettingsPage({
  searchParams,
}: {
  // A Promise in this version of Next — see `03-file-conventions/page.md`.
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [playerId, player] = await Promise.all([readPlayerId(), readPlayer()]);
  // The layout does not render `children` without a player; this narrows the
  // type and keeps the page honest if that ever changes.
  if (!playerId || !player) return null;

  const [own, isTester, adminRole, params] = await Promise.all([
    readOwnSocial(),
    // Programme membership, for the beta card. Fail-soft to `false` inside the
    // wrapper, so an unmigrated or unreachable database hides the card rather
    // than 500ing a page whose other sections are fine.
    isBetaTester(playerId),
    // Effective role from the owner's OWN email (env allow-list +
    // dashboard_users). Guarded here, unlike on the old account page: the link
    // is a convenience and `/dashboard` re-checks the role itself, so hiding it
    // during an outage costs an admin one tap — whereas throwing would take
    // sign-out and account deletion down with it. Logged, not swallowed.
    getUserRole(player.email).catch((error) => {
      console.error(`settings role read failed for ${playerId}:`, error);
      return null;
    }),
    searchParams,
  ]);

  const errorBanner = errorMessage(params.error);

  return (
    <div className="space-y-8">
      {params.ok && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900">
          Display name saved.
        </div>
      )}
      {errorBanner && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-center text-sm text-red-900">
          {errorBanner}
        </div>
      )}

      {/* IDENTITY ---------------------------------------------------------- */}
      <section aria-labelledby="settings-identity" className="space-y-4">
        <GroupHeading id="settings-identity">Identity</GroupHeading>

        <div className="rounded-xl border border-border bg-surface p-6">
          <form action={setHandleAction}>
            <label className="block text-sm font-semibold text-foreground">
              Display name
              <input
                name="handle"
                type="text"
                maxLength={24}
                defaultValue={player.handle ?? ""}
                placeholder="Your handle"
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <p className="mt-2 text-xs text-muted">
              Shown on leaderboards. Leave blank to use your Google name.
            </p>
            <button
              type="submit"
              className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Save
            </button>
          </form>
        </div>

        {/* Absent rather than broken when the social columns are not there. */}
        {own && <UsernameCard initialUsername={own.username} />}
      </section>

      {/* ACCOUNT ----------------------------------------------------------- */}
      <section aria-labelledby="settings-account" className="space-y-4">
        <GroupHeading id="settings-account">Account</GroupHeading>

        {/* The mobile tab bar is losing its Stealth tab — the bar is for things
            every visitor uses, and this is a preference. This is its home now. */}
        <StealthSettingsRow />

        {/* BETA — the mobile way into the programme, mirroring the admin card
            below. `MobileTabBar` has no beta tab and should not grow one: the
            bar is for things every visitor uses, and this is for a handful of
            people who already come here to find "things that are mine". */}
        {isTester && (
          <Link
            href="/beta"
            className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-50 p-6 transition hover:border-brand"
          >
            <div className="min-w-0">
              <div className="text-sm font-black uppercase tracking-wide text-brand">
                Beta testing
              </div>
              <p className="mt-1 text-xs font-semibold text-muted">
                Your assigned games, the bugs you&rsquo;ve filed, and your XP.
              </p>
            </div>
            <span aria-hidden className="shrink-0 text-xl font-black text-brand">
              →
            </span>
          </Link>
        )}

        {/* ADMIN — only for a signed-in admin, the mobile way into the
            dashboard. With no header or sidebar on this page, a role-gated link
            here is how "check the overview on the go" works. `/dashboard`
            re-checks the role itself, so this is a convenience, not the gate. */}
        {adminRole && (
          <Link
            href="/dashboard"
            className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-50 p-6 transition hover:border-brand"
          >
            <div className="min-w-0">
              <div className="text-sm font-black uppercase tracking-wide text-brand">
                {adminRole === "super_admin" ? "Super admin" : "Admin"} · Dashboard
              </div>
              <p className="mt-1 text-xs font-semibold text-muted">
                Overview, games, moderation and analytics.
              </p>
            </div>
            <span aria-hidden className="shrink-0 text-xl font-black text-brand">
              →
            </span>
          </Link>
        )}

        <div className="rounded-xl border border-border bg-surface p-6">
          <h3 className="text-sm font-black uppercase tracking-wide text-foreground">
            Sign out
          </h3>
          <p className="mt-2 text-sm text-muted">
            Your scores stay tagged to your account. Sign back in any time.
          </p>
          <form
            action={async () => {
              "use server";
              // `signOut`'s redirect throws a control-flow signal, so it is the
              // last statement and is never wrapped in a try/catch.
              await signOut({ redirectTo: "/play/signin" });
            }}
            className="mt-4"
          >
            <button
              type="submit"
              className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </section>

      {/* DANGER ZONE -------------------------------------------------------- */}
      <section aria-labelledby="settings-danger" className="space-y-4">
        <GroupHeading id="settings-danger" tone="danger">
          Danger zone
        </GroupHeading>

        <div className="rounded-xl border border-red-300 bg-red-50 p-6">
          <p className="text-sm text-red-900/80">
            Delete your account permanently. Your scores stay on the leaderboards
            but are <span className="font-bold">no longer tagged</span> to your
            account, and the name shown on them is replaced with
            &ldquo;Deleted&rdquo;.
          </p>
          <form action={deleteAccountAction} className="mt-4">
            <label className="block text-sm font-semibold text-red-900">
              Type <span className="font-black">DELETE</span> to confirm
              <input
                name="confirm"
                type="text"
                autoComplete="off"
                placeholder="DELETE"
                className="mt-2 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </label>
            <button
              type="submit"
              className="mt-4 rounded-full bg-red-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-red-700"
            >
              Delete my account
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
