/**
 * The one-time sign-up steps: pick a display name, claim a username, pick an avatar.
 *
 * Reached from `/auth/landing`, which routes here instead of home whenever the
 * signed-in player has no handle yet. Self-guarding: if a handle is already set
 * (someone bookmarked this, or two tabs raced) it redirects straight on, so the
 * step can never be seen twice.
 *
 * Gating on `handle IS NULL` rather than "is this their first login" is
 * deliberate — it also catches existing players who never chose one, the
 * population that otherwise appears on a board under a generated name rather
 * than one they picked. They get asked once, on their next sign-in, and are then
 * fixed for good.
 *
 * THREE STEPS, DECIDED BY STATE rather than by a wizard counter, so a refresh, a
 * back button or a double submit can never land on the wrong one: no handle asks
 * for a handle; handle-but-no-username asks for a username; then, while no avatar
 * was ever chosen and none was skipped, "Pick your look"; anything else redirects
 * on. Each step hands off to THIS page again rather than to the final
 * destination, which is what strings them together. The state that is not in the
 * database is `?su=1` (username deliberately skipped) and the `hp_avatar_skip`
 * cookie (avatar skipped); see `app/lib/onboarding.ts`.
 *
 * THE USERNAME AND AVATAR STEPS ARE SKIPPABLE and the handle step is not. A handle is coerced
 * and cannot fail, so there is nothing to escape from. A username is a claim on a
 * unique namespace and can fail repeatedly — if every name a player tries is
 * taken, a mandatory step would lock them out of the site over a nickname.
 *
 * NOT ADDED TO THE POPUP AT `/play/auth/complete`. That window opens mid-game and
 * closes the moment auth completes; a second question in it is a second chance to
 * strand somebody who is trying to submit a score. Popup players are asked for a
 * handle only, and get the remaining steps on their next full page load, from
 * `OnboardingGate`.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { AvatarPicker } from "@/app/play/you/_ui/AvatarPicker";
import { HandleChooser } from "@/app/components/HandleChooser";
import { UsernameChooser } from "@/app/components/UsernameChooser";
import { Wordmark } from "@/app/components/Wordmark";
import { HANDLE_REJECTION_MESSAGES, suggestHandleFromName } from "@/app/lib/handle";
import { resolveAvatar } from "@/app/lib/avatars";
import { AVATAR_SKIP_COOKIE } from "@/app/lib/onboarding";
import { getPlayerById } from "@/app/lib/players";
import { safeRelativePath } from "@/app/lib/safe-redirect";
import { social } from "@/app/lib/social";
import {
  USERNAME_REJECTION_MESSAGES,
  suggestUsernameFrom,
} from "@/app/lib/username";
import {
  setInitialAvatarAction,
  setInitialHandleAction,
  setInitialUsernameAction,
  skipAvatarAction,
  skipUsernameAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Welcome · HallPass",
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
  searchParams: Promise<{ next?: string; error?: string; uerror?: string; su?: string }>;
}) {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/welcome");

  const { next: rawNext, error, uerror, su } = await searchParams;
  const skippedUsername = su === "1";
  const next = safeRelativePath(String(rawNext ?? "")) ?? "/";

  const player = await getPlayerById(playerId).catch(() => null);

  // STEP 2 — a display name exists, so ask for the username.
  if (player?.handle) {
    // Fail-soft: if we cannot tell whether they already have one, send them on
    // rather than risk asking a second time or blocking on a database blip.
    const own = await social.getOwnSocial(playerId).catch(() => null);
    const usernameDone = Boolean(own?.username) || skippedUsername;

    // STEP 3 — handle (and username, or its skip) done: offer the avatar, but
    // only while none was ever chosen and the player has not skipped it.
    if (usernameDone) {
      const avatarSkipped = Boolean((await cookies()).get(AVATAR_SKIP_COOKIE));
      if (player.avatarMeme || avatarSkipped) redirect(next);
      const current = resolveAvatar(player.publicId, { meme: null, colour: null });
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
          <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center">
            <Wordmark size="text-3xl" dotClass="h-2 w-2" />
            <h1 className="mt-4 text-2xl font-black tracking-tight text-foreground">
              Pick your look
            </h1>
            <p className="mt-2 text-sm font-semibold text-muted">
              A meme and a colour. It&rsquo;s what other players see next to your name.
            </p>
            <form action={setInitialAvatarAction} className="mt-6 text-left">
              <input type="hidden" name="next" value={next} />
              <AvatarPicker initialMeme={current.meme.id} initialColour={current.colour} />
              <button
                type="submit"
                className="mt-5 w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
              >
                Save
              </button>
            </form>
            <form action={skipAvatarAction} className="mt-3">
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                className="w-full rounded-full px-5 py-2 text-sm font-bold text-muted hover:text-foreground"
              >
                Skip for now
              </button>
            </form>
          </div>
        </main>
      );
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
        <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-4 text-2xl font-black tracking-tight text-foreground">
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
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-4 text-2xl font-black tracking-tight text-foreground">
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
