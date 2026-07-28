/**
 * Post-auth completion page — the Scoreboard SDK popup's landing spot.
 *
 * The SDK opens player sign-in in a popup; after Google returns and the session
 * cookie is set, the popup is redirected here. `<AuthCompleteClient/>` then
 * broadcasts the auth signal to the opener and closes the popup.
 *
 * ONE THING HAPPENS BEFORE THAT: a player with no handle is asked to pick one,
 * right here in the popup. It is the same one-time step as `/play/welcome`, and
 * this is the better moment to ask than any later prompt would be — the player
 * is mid-game and about to submit a score, so the name they choose is the name
 * that lands on the leaderboard they are already looking at. Without it, their
 * Google account name (usually their full real name) is what gets published.
 *
 * The popup is 480x680, hence `compact`. The completion client is NOT rendered
 * while the chooser is up: broadcasting and closing the window mid-question would
 * throw the step away and leave the handle unset.
 */

import type { Metadata } from "next";
import { auth } from "@/app/lib/auth";
import { HandleChooser } from "@/app/components/HandleChooser";
import { Wordmark } from "@/app/components/Wordmark";
import { HANDLE_REJECTION_MESSAGES, suggestHandleFromName } from "@/app/lib/handle";
import { getPlayerById } from "@/app/lib/players";
import { setInitialHandleAction } from "@/app/play/welcome/actions";
import AuthCompleteClient from "./AuthCompleteClient";

export const metadata: Metadata = {
  title: "Signed in · HallPass",
  robots: { index: false, follow: false },
};

// Reads the session cookie to decide whether the handle step is needed.
export const dynamic = "force-dynamic";

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "db") return "Something went wrong — try again.";
  return HANDLE_REJECTION_MESSAGES[code as keyof typeof HANDLE_REJECTION_MESSAGES] ?? null;
}

export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Fail-soft: if the identity read hiccups we simply skip the question and let
  // the popup complete. A missed handle prompt is a far better outcome than a
  // popup that never closes and strands the player mid-game.
  let needsHandle = false;
  let suggestion = "";
  try {
    const session = await auth();
    const playerId = session?.user?.playerId;
    if (playerId) {
      const player = await getPlayerById(playerId);
      if (player && !player.handle) {
        needsHandle = true;
        suggestion = suggestHandleFromName(player.name);
      }
    }
  } catch {
    needsHandle = false;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-3 text-2xl font-black tracking-tight">
          {needsHandle ? "You're in!" : "You're signed in"}
        </h1>

        {needsHandle ? (
          <>
            <p className="mt-2 text-sm font-semibold text-muted">
              Pick the name other players will see.
            </p>
            <HandleChooser
              action={setInitialHandleAction}
              suggestion={suggestion}
              error={errorMessage(error)}
              // Back to this same page once saved; the branch above then falls
              // through to AuthCompleteClient, which closes the popup.
              next="/play/auth/complete"
              compact
            />
          </>
        ) : (
          <AuthCompleteClient />
        )}
      </div>
    </main>
  );
}
