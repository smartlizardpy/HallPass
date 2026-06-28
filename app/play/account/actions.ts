/**
 * Server actions for the player account page.
 *
 * Identity is NEVER taken from the form — a hidden `playerId` field would be
 * trivially forgeable, letting one player rewrite another's handle. The action
 * instead re-reads the session with `auth()` and uses `session.user.playerId`
 * (the verified Google subject id) as the only source of truth for WHO is acting.
 * The form supplies only the new handle string.
 *
 * `setPlayerHandle` sanitises/caps the handle and reverts to NULL when nothing
 * usable remains (see `app/lib/players.ts`), so no validation is duplicated here.
 *
 * Errors travel as fixed CODES, never free text: a write failure redirects with
 * `?error=db` and a failed confirmation with `?error=confirm`. The account page
 * maps each code to a server-defined banner message, so nothing the client puts
 * in the querystring is ever reflected back into the UI.
 *
 * Write hardening: every store write is wrapped in a try/catch so a Neon outage
 * (or unconfigured `DATABASE_URL`) bounces back to the form with `?error=db`
 * instead of throwing a 500. `redirect()` (and `signOut`'s redirect) signals via
 * a thrown control object, so every recovery redirect lives OUTSIDE the try —
 * a catch-all would otherwise swallow it.
 */

"use server";

import { redirect } from "next/navigation";
import { auth, signOut } from "@/app/lib/auth";
import { deletePlayer, setPlayerHandle } from "@/app/lib/players";

export async function setHandleAction(formData: FormData): Promise<void> {
  const session = await auth();
  const playerId = session?.user?.playerId;

  // No verified identity → cannot edit a handle. Send them to sign in.
  if (!playerId) redirect("/play/signin?callbackUrl=/play/account");

  const handle = String(formData.get("handle") ?? "");

  // A write failure (Neon down / unconfigured) must not 500: flag it inside the
  // try and bounce OUTSIDE with the `db` error code (redirect throws).
  let saveFailed = false;
  try {
    await setPlayerHandle(playerId, handle);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect("/play/account?error=db");

  // Back to the account page with a success marker for the banner.
  redirect("/play/account?ok=1");
}

/**
 * Self-delete the signed-in player's identity, then end the session.
 *
 * Identity comes ONLY from `auth()` — the form supplies a typed CONFIRMATION,
 * never a `playerId`, so one account can never delete another's. The player must
 * type the literal word `DELETE`; anything else bounces back with `?error=confirm`
 * (mapped to a fixed banner message on the page) and no write happens.
 *
 * `deletePlayer` removes the `players` row; the `scores.player_id` FK is
 * `ON DELETE SET NULL`, so the player's historical scores DE-TAG (revert to
 * anonymous) rather than being destroyed. `signOut({ redirectTo })` both clears
 * the now-orphaned session cookie and redirects home; like `redirect()` it
 * throws a control-flow signal, so it is the last statement and is never caught.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const session = await auth();
  const playerId = session?.user?.playerId;

  // No verified identity → nothing to delete. Bounce home.
  if (!playerId) redirect("/");

  // Typed confirmation gate — never trust a field for WHO, only for INTENT.
  if (String(formData.get("confirm") ?? "") !== "DELETE") {
    redirect("/play/account?error=confirm");
  }

  // A write failure (Neon down / unconfigured) must not 500: flag it inside the
  // try and bounce OUTSIDE with the `db` error code. `signOut`'s redirect is the
  // last statement and likewise stays outside the try so its thrown control
  // signal is never caught.
  let deleteFailed = false;
  try {
    await deletePlayer(playerId);
  } catch {
    deleteFailed = true;
  }
  if (deleteFailed) redirect("/play/account?error=db");

  await signOut({ redirectTo: "/" });
}
