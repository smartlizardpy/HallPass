/**
 * The Settings-tab card for choosing your avatar: one meme and one background
 * colour, nothing else (placement and scale are fixed per meme).
 *
 * Self-contained like `GooglePhotoCard`: it renders the form AND owns its
 * server action, so the settings page needs one import and one JSX line.
 *
 * WHO IS ACTING comes from `auth()` inside the action, never from the form. The
 * form supplies only `meme` and `colour`, and BOTH are re-validated against the
 * catalogue and palette (`parseAvatarChoice`) - the client is never trusted, so
 * a forged post cannot store an arbitrary string. A rejected pick redirects with
 * the fixed code `?error=avatar`; a write error with `?error=db` (outside the
 * try, because `redirect()` throws a control-flow signal).
 *
 * This is independent of "Show my Google profile picture to friends": that
 * opt-in still decides whether an accepted friend sees a photo instead.
 */

import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { parseAvatarChoice, resolveAvatar } from "@/app/lib/avatars";
import { setAvatarChoice } from "@/app/lib/players";
import { AvatarPicker } from "./AvatarPicker";

async function saveAvatarAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/you/settings");

  const choice = parseAvatarChoice({
    meme: formData.get("meme"),
    colour: formData.get("colour"),
  });
  if (!choice) redirect("/play/you/settings?error=avatar");

  let failed = false;
  try {
    await setAvatarChoice(playerId, choice);
  } catch {
    failed = true;
  }
  // Redirecting re-renders the layout, so the header avatar updates at once.
  redirect(failed ? "/play/you/settings?error=db" : "/play/you/settings");
}

export function AvatarCard({
  publicId,
  meme,
  colour,
}: {
  publicId: string;
  meme: string | null;
  colour: string | null;
}) {
  // What the player currently sees, including the default when never chosen.
  const current = resolveAvatar(publicId, { meme, colour });
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <form action={saveAvatarAction}>
        <h3 className="text-sm font-semibold text-foreground">Your avatar</h3>
        <p className="mb-4 mt-1 text-xs text-muted">
          Pick a meme and a background colour. This is what other players see
          next to your name.
        </p>
        <AvatarPicker initialMeme={current.meme.id} initialColour={current.colour} />
        <button
          type="submit"
          className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
        >
          Save avatar
        </button>
      </form>
    </div>
  );
}
