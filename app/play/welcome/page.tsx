/**
 * The one-time sign-up steps: pick a display name, then claim a username.
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
 *
 * TWO STEPS, DECIDED BY STATE rather than by a wizard counter, so a refresh, a
 * back button or a double submit can never land on the wrong one: no handle asks
 * for a handle, handle-but-no-username asks for a username, both present
 * redirects on. Step one hands off to THIS page again rather than to the final
 * destination, which is what strings them together.
 *
 * THE USERNAME STEP IS SKIPPABLE and the handle step is not. A handle is coerced
 * and cannot fail, so there is nothing to escape from. A username is a claim on a
 * unique namespace and can fail repeatedly — if every name a player tries is
 * taken, a mandatory step would lock them out of the site over a nickname.
 *
 * NOT ADDED TO THE POPUP AT `/play/auth/complete`. That window opens mid-game and
 * closes the moment auth completes; a second question in it is a second chance to
 * strand somebody who is trying to submit a score. Popup players are asked for a
 * handle only, and get the username nudge later.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { HandleChooser } from "@/app/components/HandleChooser";
import { UsernameChooser } from "@/app/components/UsernameChooser";
import { Wordmark } from "@/app/components/Wordmark";
import { HANDLE_REJECTION_MESSAGES, suggestHandleFromName } from "@/app/lib/handle";
import { getPlayerById } from "@/app/lib/players";
import { safeRelativePath } from "@/app/lib/safe-redirect";
import { social } from "@/app/lib/social";
import {
  USERNAME_REJECTION_MESSAGES,
  suggestUsernameFrom,
} from "@/app/lib/username";
import {
  setInitialHandleAction,
  setInitialUsernameAction,
  skipUsernameAction,
} from "./actions";

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

/** Same rule for the username step: fixed copy, chosen by code. */
function usernameErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "taken") return "That username is already taken — try another.";
  if (code === "held") return "That username was recently released and is on hold.";
  if (code === "error") return "Something went wrong — try again.";
  return (
    USERNAME_REJECTION_MESSAGES[code as keyof typeof USERNAME_REJECTION_MESSAGES] ??
    null
  );
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; uerror?: string }>;
}) {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/welcome");

  const { next: rawNext, error, uerror } = await searchParams;
  const next = safeRelativePath(String(rawNext ?? "")) ?? "/";

  const player = await getPlayerById(playerId).catch(() => null);

  // STEP 2 — a display name exists, so ask for the username.
  if (player?.handle) {
    // Fail-soft: if we cannot tell whether they already have one, send them on
    // rather than risk asking a second time or blocking on a database blip.
    const own = await social.getOwnSocial(playerId).catch(() => null);
    if (own?.username) redirect(next);

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900">
            Claim your @username
          </h1>
          <p className="mt-2 text-sm font-semibold text-muted">
            It&rsquo;s how friends find you — first come, first served.
          </p>

          <UsernameChooser
            action={setInitialUsernameAction}
            skipAction={skipUsernameAction}
            suggestion={suggestUsernameFrom(player.handle)}
            error={usernameErrorMessage(uerror)}
            next={next}
          />
        </div>
      </main>
    );
  }

  // STEP 1 — no display name yet.
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
          // Back to THIS page, not to the final destination — that is what makes
          // the username step the next thing they see.
          next={`/play/welcome?next=${encodeURIComponent(next)}`}
        />
      </div>
    </main>
  );
}
