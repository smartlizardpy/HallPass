/**
 * Public PLAYER profile page.
 *
 * The signed-in player's home: their verified identity, the display handle that
 * overrides their Google name on leaderboards, every board they've climbed, and
 * the account controls (sign out + a guarded self-delete). Three states:
 *   1. No `playerId` on the session — not signed in: a card linking to sign-in.
 *   2. `playerId` but no player row (vanished/never provisioned) — treated like
 *      (1): the safe, non-throwing fallback is "go sign in again".
 *   3. Signed in with an identity — the full profile below.
 *
 * PRIVACY: the email is rendered ONLY here, ONLY to the player themselves — the
 * page is gated by their own `playerId`, so the address never crosses to another
 * viewer. We read the server-side {@link Player} (which carries `email`) rather
 * than the public projection precisely because the owner is allowed to see it.
 *
 * Both forms (handle edit, account delete) re-derive identity from the session
 * server-side; no field on this page is trusted for WHO is acting. Avatars are
 * remote Google URLs rendered with a plain `<img>` (matching the repo's GameCard
 * / Arcade convention) plus `referrerPolicy="no-referrer"` so Google serves them.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/app/lib/auth";
import { BackButton } from "@/app/components/BackButton";
import { Wordmark } from "@/app/components/Wordmark";
import { getPlayerById, effectiveHandle } from "@/app/lib/players";
import { store } from "@/app/lib/scoreboard";
import { social } from "@/app/lib/social";
import { UsernameCard } from "@/app/components/friends/UsernameCard";
import { BadgeShelf } from "@/app/components/BadgeShelf";
import { earnedBadges, lockedBadges, type BadgeStats } from "@/app/lib/badges";
import { setHandleAction, deleteAccountAction } from "./actions";

export const metadata: Metadata = {
  title: "Your profile · HallPass",
  robots: { index: false, follow: false },
};

/** The shared "you are not signed in" card (states 1 and 2 above). */
function NotSignedInCard() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6 py-10">
      {/* The signed-out state is just as much a dead end as the signed-in one. */}
      <div className="absolute left-6 top-6">
        <BackButton />
      </div>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-3 text-2xl font-black tracking-tight">Not signed in</h1>
        <p className="mt-3 text-sm text-muted">
          Sign in to choose a display name and tag your scores.
        </p>
        <Link
          href="/play/signin?callbackUrl=/play/account"
          className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}

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

/** Server-only formatter for the "member since" line — fixed locale, no hydration drift. */
function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

/**
 * Rank badge classes. #1 gets a gold-ish amber treatment (the podium spot);
 * everyone else gets the brand tint.
 */
function rankBadgeClasses(rank: number): string {
  return rank === 1
    ? "border border-amber-300 bg-amber-100 text-amber-800"
    : "border border-brand/20 bg-brand-50 text-brand";
}

export default async function PlayAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await auth();
  const playerId = session?.user?.playerId;

  if (!playerId) return <NotSignedInCard />;

  // Owner-only view: the server-side Player (carries `email`) and the player's
  // cross-board standings, resolved together to avoid a request waterfall. The
  // standings read is guarded — a transient Neon hiccup must NOT 500 this
  // owner-only page, so on failure it degrades to [] and the empty state renders
  // (mirroring the resilient public leaderboard route).
  const [player, standings, own, stats] = await Promise.all([
    getPlayerById(playerId),
    store.getPlayerStandings(playerId).catch((error) => {
      console.error(`account standings read failed for ${playerId}:`, error);
      return [];
    }),
    // Guarded separately: if migration 007 has not been applied yet, the social
    // columns do not exist. That must degrade the username card, not 500 the
    // whole account page.
    social.getOwnSocial(playerId).catch(() => null),
    // Guarded on its own: badges are derived from tables that may not exist yet
    // if 007/008 have not been applied. A missing badge shelf must not 500 the
    // account page.
    social.badgeStats(playerId).catch(() => null),
  ]);
  if (!player) return <NotSignedInCard />;

  const { ok, error } = await searchParams;
  const errorBanner = errorMessage(error);
  const display = effectiveHandle(player);
  const memberSince = formatMonthYear(player.createdAt);

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-5">
        {/* This page has no header and no sidebar, so without this there is no
            way out of it except the browser's own back button — which on an
            installed PWA is not always on screen. */}
        <BackButton />

        <div className="text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-3 text-2xl font-black tracking-tight">Your profile</h1>
        </div>

        {ok && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900">
            Display name saved.
          </div>
        )}
        {errorBanner && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-center text-sm text-red-900">
            {errorBanner}
          </div>
        )}

        {/* PROFILE ---------------------------------------------------------- */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-4">
            {player.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={player.image}
                alt=""
                width={64}
                height={64}
                referrerPolicy="no-referrer"
                className="h-16 w-16 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-2xl font-black text-muted">
                {display.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-xl font-black text-foreground">
                {display}
              </div>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand">
                Verified player
              </span>
              {memberSince && (
                <p className="mt-1.5 text-xs text-muted">Member since {memberSince}</p>
              )}
              {/* Owner-only: shown to the signed-in player and no one else. */}
              <p className="truncate text-xs text-muted">{player.email}</p>
            </div>
          </div>

          <form action={setHandleAction} className="mt-6">
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
        </section>

        {/* YOUR LEADERBOARDS ------------------------------------------------ */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
            Your leaderboards
          </h2>
          {standings.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-muted">
              Play a game while signed in to climb the boards.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {standings.map((s) => (
                <li
                  key={s.boardId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    {s.gameSlug ? (
                      <Link
                        href={`/game/${s.gameSlug}`}
                        className="truncate font-bold text-foreground hover:text-brand"
                      >
                        {s.title}
                      </Link>
                    ) : (
                      <span className="block truncate font-bold text-foreground">
                        {s.title}
                      </span>
                    )}
                    <div className="mt-0.5 text-xs text-muted">
                      Best {s.best.toLocaleString("en-US")}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-sm font-black tabular-nums ${rankBadgeClasses(
                      s.rank,
                    )}`}
                  >
                    #{s.rank}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ACCOUNT ---------------------------------------------------------- */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
            Account
          </h2>
          <form
            action={async () => {
              "use server";
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
        </section>

        {/* BADGES ----------------------------------------------------------- */}
        {stats && (
          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
              Badges
            </h2>
            <p className="mt-2 text-sm text-muted">
              Earned automatically from what you play, score and write.
            </p>
            <div className="mt-4">
              <BadgeShelf
                earned={earnedBadges(stats as BadgeStats)}
                // Owner-only view, so the locked list is fine to show here.
                locked={lockedBadges(stats as BadgeStats)}
                emptyLabel="No badges yet — play a few games and they'll show up here."
              />
            </div>
          </section>
        )}

        {/* USERNAME + FRIEND CODE ------------------------------------------- */}
        {own && <UsernameCard initialUsername={own.username} />}

        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
            Friends
          </h2>
          <p className="mt-2 text-sm text-muted">
            See what your friends are playing, and manage your requests.
          </p>
          <Link
            href="/play/friends"
            className="mt-4 inline-block rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2"
          >
            Manage friends
          </Link>
        </section>

        {/* DANGER ZONE ------------------------------------------------------ */}
        <section className="rounded-xl border border-red-300 bg-red-50 p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-red-900">
            Danger zone
          </h2>
          <p className="mt-2 text-sm text-red-900/80">
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
        </section>
      </div>
    </main>
  );
}
