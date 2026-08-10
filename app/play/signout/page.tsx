/**
 * Public player sign-out confirmation.
 *
 * A server component cannot auto-submit a form (there is no client JS here), so
 * sign-out is a deliberate one-click confirm rather than an automatic action —
 * which also avoids a drive-by URL silently ending someone's session. The button
 * posts an inline server action that clears the session and lands back where the
 * caller asked via `?callbackUrl=` (default the home page) — the SDK popup uses
 * this to return to "/play/auth/complete". As with sign-in, `callbackUrl` is
 * attacker-influenceable, so it is validated to a same-origin relative path.
 *
 * BACKING OUT HONOURS THE SAME DESTINATION. "Stay signed in" used to be a fixed
 * link to the account page, so declining a sign-out left the player somewhere
 * they had never asked to be — and in the SDK popup it parked a full profile
 * page in a 480x680 window instead of returning to "/play/auth/complete", which
 * broadcasts to the opener and closes. Both paths now read the one validated
 * value; only the fallback differs, for the reason given at `cancelTo`.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/lib/auth";
import { safeRelativePath } from "@/app/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Sign out · HallPass",
  robots: { index: false, follow: false },
};

export default async function PlaySignOutPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  // `callbackUrl` rides in the query string — harden it to a same-origin
  // relative path before handing it to `signOut({ redirectTo })`.
  const redirectTo = safeRelativePath(callbackUrl, "/");
  // The same asked-for destination, validated the same way — with a different
  // fallback when nothing was asked for. A player who just signed out has no
  // account page to land on, so that path defaults to the home page; a player
  // who is staying does, so this one defaults to `/play/you`.
  const cancelTo = safeRelativePath(callbackUrl, "/play/you");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <span className="text-xs font-black uppercase tracking-widest text-brand">
          HALLPASS
        </span>
        <h1 className="mt-2 text-2xl font-black tracking-tight">Sign out?</h1>
        <p className="mt-3 text-sm text-muted">
          You can sign back in any time to keep tagging your scores.
        </p>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo });
          }}
          className="mt-6"
        >
          <button
            type="submit"
            className="w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Sign out
          </button>
        </form>

        <Link
          href={cancelTo}
          className="mt-4 inline-block text-sm font-semibold text-brand hover:text-brand-600"
        >
          Stay signed in
        </Link>
      </div>
    </main>
  );
}
