"use server";

/**
 * The sign-in handle chooser's write.
 *
 * Identity comes ONLY from `auth()` — the form supplies the handle and a
 * destination, never a player id. Same rule as `setHandleAction` in
 * `app/play/account/actions.ts`.
 *
 * Errors travel as fixed CODES in the querystring, never free text, so nothing
 * the client puts in the URL is reflected into the page. `redirect()` signals by
 * throwing a control object, so every redirect lives OUTSIDE the try — a
 * catch-all would otherwise swallow it.
 */

import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { validateHandle } from "@/app/lib/handle";
import { setPlayerHandle } from "@/app/lib/players";
import { hasBlockedDisplayTerm } from "@/app/lib/reviews/wordlist";
import { safeRelativePath } from "@/app/lib/safe-redirect";

/** Where to land after choosing, if the form did not say. */
const DEFAULT_NEXT = "/";

export async function setInitialHandleAction(formData: FormData): Promise<void> {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/welcome");

  // Every attacker-influenceable destination goes through `safeRelativePath`,
  // which rejects control characters FIRST — the WHATWG URL parser strips tab/CR/
  // LF, so `/\t/evil.example` would slip past a naive prefix check.
  const next =
    safeRelativePath(String(formData.get("next") ?? "")) ?? DEFAULT_NEXT;
  const back = (code: string) =>
    `/play/welcome?next=${encodeURIComponent(next)}&error=${code}`;

  const check = validateHandle(formData.get("handle"));
  if (!check.ok) redirect(back(check.reason));

  // Server-side only: the blocklist must not ship to the browser. A handle is
  // rendered on every leaderboard the player enters, so it gets the same check a
  // review body does.
  if (hasBlockedDisplayTerm(check.handle)) redirect(back("reserved"));

  let saveFailed = false;
  try {
    await setPlayerHandle(playerId, check.handle);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(back("db"));

  redirect(next);
}
