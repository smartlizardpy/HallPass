/**
 * Public dashboard sign-in page.
 *
 * This page deliberately lives OUTSIDE the `(app)` route group so it is NOT behind
 * the guard in `app/dashboard/(app)/layout.tsx`. If it were gated, an unauthenticated
 * visitor would be redirected here, only to be redirected away again — an infinite
 * loop. Keeping it public is the seam that breaks that cycle.
 *
 * Three states are handled:
 *   1. No session — the normal first visit: show the Google sign-in card.
 *   2. Signed in as a PLAYER (a session exists but carries no dashboard role).
 *      Player sign-in is now open, so a verified-but-unprivileged visitor is no
 *      longer a hard "access denied" — it is the expected state for anyone who
 *      signed in to tag their scores. We say so plainly and point them at their
 *      player account, with a sign-out escape hatch.
 *   3. `?error=AccessDenied` without a session — Auth.js rejected the sign-in
 *      itself (e.g. no verified email): show the sign-in card with a short note.
 *
 * A fully authorized visitor (session + role) never needs this page, so we redirect
 * them straight to the dashboard overview. The admin gate is unchanged.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/app/lib/auth";
import { Wordmark } from "@/app/components/Wordmark";

export const metadata: Metadata = {
  title: "Sign in · Dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();

  // Already authorized — nothing to do here.
  if (session?.user?.role) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;

  // A session with no role is a signed-in PLAYER, not a rejection: greet them as
  // such and point them at their account. Only a true sign-in failure with no
  // session keeps the (now rare) error note.
  const signedInAsPlayer = Boolean(session?.user);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-3 text-xl font-black tracking-tight text-muted">
          Admin dashboard
        </h1>

        {signedInAsPlayer ? (
          <>
            <p className="mt-3 text-sm text-muted">
              You&apos;re signed in as a player, but this dashboard is for admins.
            </p>
            {session?.user?.email && (
              <p className="mt-2 text-xs text-muted">
                Signed in as{" "}
                <span className="font-semibold text-foreground">
                  {session.user.email}
                </span>
              </p>
            )}
            <Link
              href="/play/you"
              className="mt-6 inline-block w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Go to your account
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/dashboard/signin" });
              }}
              className="mt-3"
            >
              <button
                type="submit"
                className="w-full rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">
              Sign in to manage games and leaderboards
            </p>
            {error === "AccessDenied" && (
              <p className="mt-2 text-xs text-red-700">
                We couldn&apos;t sign you in. Please try again.
              </p>
            )}
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/dashboard" });
              }}
              className="mt-6"
            >
              <button
                type="submit"
                className="w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
              >
                Continue with Google
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
