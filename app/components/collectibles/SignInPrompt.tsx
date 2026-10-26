"use client";

import { startSignIn } from "@/app/lib/auth-actions";

/** Shown to a signed-out visitor on a personal collectibles page. */
export function SignInPrompt({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-6">
      <p className="max-w-prose text-sm text-foreground-2">{children}</p>
      <form action={startSignIn}>
        <button type="submit" className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600">
          Sign in
        </button>
      </form>
    </div>
  );
}
