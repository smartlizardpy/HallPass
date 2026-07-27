/**
 * The one-time "pick a name" step after a first sign-in.
 *
 * Reached from `/auth/landing`, which routes here instead of home whenever the
 * signed-in player has no handle yet. Self-guarding: if a handle is already set
 * (someone bookmarked this, or two tabs raced) it redirects straight on, so the
 * step can never be seen twice.
 *
 * Gating on `handle IS NULL` rather than "is this their first login" is
 * deliberate — it also catches existing players who never chose one, which is
 * exactly the population whose real Google name is on the leaderboards today.
 * They get asked once, on their next sign-in, and are then fixed for good.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { HandleChooser } from "@/app/components/HandleChooser";
import { Wordmark } from "@/app/components/Wordmark";
import { HANDLE_REJECTION_MESSAGES, suggestHandleFromName } from "@/app/lib/handle";
import { getPlayerById } from "@/app/lib/players";
import { safeRelativePath } from "@/app/lib/safe-redirect";
import { setInitialHandleAction } from "./actions";

export const metadata: Metadata = {
  title: "Pick a name · HallPass",
  robots: { index: false, follow: false },
};

// Reads the session cookie, so it is inherently per-request.
export const dynamic = "force-dynamic";

/** Fixed copy per error CODE — never reflects the querystring back. */
function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "db") return "Something went wrong — try again.";
  return HANDLE_REJECTION_MESSAGES[code as keyof typeof HANDLE_REJECTION_MESSAGES] ?? null;
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/welcome");

  const { next: rawNext, error } = await searchParams;
  const next = safeRelativePath(String(rawNext ?? "")) ?? "/";

  const player = await getPlayerById(playerId).catch(() => null);
  // Already chosen — nothing to ask. Also covers a double submit.
  if (player?.handle) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900">
          You&rsquo;re in!
        </h1>
        <p className="mt-2 text-sm font-semibold text-muted">
          Pick the name other players will see.
        </p>

        <HandleChooser
          action={setInitialHandleAction}
          // First name only, never the full Google name — see the note in
          // `suggestHandleFromName`.
          suggestion={suggestHandleFromName(player?.name)}
          error={errorMessage(error)}
          next={next}
        />
      </div>
    </main>
  );
}
