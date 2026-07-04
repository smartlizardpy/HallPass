/**
 * Post-auth completion page — the Scoreboard SDK popup's landing spot.
 *
 * The SDK opens player sign-in in a popup; after Google returns and the session
 * cookie is set, the popup is redirected here. This server shell is only a
 * styled, no-index frame (visually consistent with the sign-in page) — the real
 * work of broadcasting the auth signal to the opener and closing the popup
 * happens client-side in <AuthCompleteClient/>.
 */

import type { Metadata } from "next";
import { Wordmark } from "@/app/components/Wordmark";
import AuthCompleteClient from "./AuthCompleteClient";

export const metadata: Metadata = {
  title: "Signed in · HallPass",
  robots: { index: false, follow: false },
};

export default function AuthCompletePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-3 text-2xl font-black tracking-tight">
          You&apos;re signed in
        </h1>
        <AuthCompleteClient />
      </div>
    </main>
  );
}
