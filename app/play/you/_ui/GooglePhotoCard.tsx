/**
 * The Settings-tab switch for "Show my Google profile picture to friends".
 *
 * A self-contained server component: it renders the form AND owns its server
 * action, so the settings page needs one import and one JSX line. Keep it that
 * way - another card on that page is added by a different change.
 *
 * WHAT IT CONTROLS. `players.use_google_photo`, default OFF. Everyone sees a
 * meme avatar by default; with this on, ONLY accepted friends see the Google
 * photo (friends list, friend profile). Leaderboards, reviews and strangers
 * always see the meme avatar. The Google photo is often a real photograph of a
 * child, which is why the default is off.
 *
 * WHO IS ACTING comes from `auth()` inside the action, never from the form, like
 * every other action on this page (see `app/play/account/actions.ts`). The form
 * supplies only the checkbox. It works without JavaScript: an unchecked box is
 * simply absent from the form data, which reads as "off".
 *
 * Failure follows the page's convention: a write error redirects with the fixed
 * code `?error=db` (mapped to a fixed banner), outside the try because
 * `redirect()` throws a control-flow signal.
 */

import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { setUseGooglePhoto } from "@/app/lib/players";

async function saveGooglePhotoAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/you/settings");

  const enabled = formData.get("useGooglePhoto") === "on";
  let failed = false;
  try {
    await setUseGooglePhoto(playerId, enabled);
  } catch {
    failed = true;
  }
  // Redirecting (rather than returning) re-renders the layout, so the avatar in
  // the header above switches immediately.
  redirect(failed ? "/play/you/settings?error=db" : "/play/you/settings");
}

export function GooglePhotoCard({ enabled }: { enabled: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <form action={saveGooglePhotoAction}>
        <label className="flex items-start gap-3 text-sm font-semibold text-foreground">
          <input
            type="checkbox"
            name="useGooglePhoto"
            defaultChecked={enabled}
            className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
          />
          <span>Show my Google profile picture to friends</span>
        </label>
        <p className="mt-2 text-xs text-muted">
          Off by default. While it is off, everyone &mdash; including your
          friends &mdash; sees a fun meme avatar instead of your photo. Switch it
          on and only people you have accepted as friends will see your Google
          picture. Leaderboards, reviews and everyone else always see the meme
          avatar.
        </p>
        <button
          type="submit"
          className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}
