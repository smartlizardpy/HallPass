/**
 * Public player sign-out confirmation.
 *
 * A server component cannot auto-submit a form (there is no client JS here), so
 * sign-out is a deliberate one-click confirm rather than an automatic action —
 * which also avoids a drive-by URL silently ending someone's session. The button
 * posts an inline server action that clears the session and lands back on the
 * home page.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/lib/auth";

export const metadata: Metadata = {
  title: "Sign out · HallPass",
  robots: { index: false, follow: false },
};

export default function PlaySignOutPage() {
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
            await signOut({ redirectTo: "/" });
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
          href="/play/account"
          className="mt-4 inline-block text-sm font-semibold text-brand hover:text-brand-600"
        >
          Stay signed in
        </Link>
      </div>
    </main>
  );
}
