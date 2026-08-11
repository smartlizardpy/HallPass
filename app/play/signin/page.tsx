/**
 * Public PLAYER sign-in page.
 *
 * Distinct from `/dashboard/signin`: that page is the gateway to the admin
 * surface, this one only gives a game player a VERIFIED identity so their
 * leaderboard scores can be tagged (handle + avatar + verified flag). Sign-in is
 * OPEN — any Google account is accepted (the `signIn` callback no longer denies
 * non-admins); a player simply never gains a dashboard role.
 *
 * Open-redirect guard: `callbackUrl` is attacker-influenceable (it rides in the
 * query string), so it is validated to a SAME-ORIGIN RELATIVE path before it is
 * ever fed to a redirect or to `signIn({ redirectTo })`. We accept only a single
 * leading slash and reject protocol-relative (`//host`) and backslash-tricked
 * (`/\host`) forms that browsers would resolve to a foreign origin. Anything that
 * fails falls back to a known-safe default.
 *
 * Already-a-player visitors have nothing to do here, so they are bounced to the
 * validated `callbackUrl` (default "/"). `redirect()` throws its control signal
 * and is therefore kept outside any try/catch (there is none here).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/app/lib/auth";
import { safeRelativePath } from "@/app/lib/safe-redirect";
import { Wordmark } from "@/app/components/Wordmark";

export const metadata: Metadata = {
  title: "Sign in to save your scores · HallPass",
  robots: { index: false, follow: false },
};

export default async function PlaySignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;

  // Already a verified player — nothing to do; head to where they were going.
  // `safeRelativePath` (shared) hardens against control-char open-redirect tricks.
  if (session?.user?.playerId) {
    redirect(safeRelativePath(callbackUrl, "/"));
  }

  // Where Google sends them back after a successful sign-in.
  const redirectTo = safeRelativePath(callbackUrl, "/play/you");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-3 text-2xl font-black tracking-tight">
          Sign in to save your scores
        </h1>
        <p className="mt-3 text-sm text-muted">
          Sign in with Google to tag your leaderboard scores with a verified
          name and avatar. You can keep playing anonymously without signing in.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
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
      </div>
    </main>
  );
}
