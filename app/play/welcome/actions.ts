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
import { social } from "@/app/lib/social";
import { validateUsernameFormat } from "@/app/lib/username";
import { containsBlockedTerm } from "@/app/lib/username-wordlist";

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


// ---------------------------------------------------------------------------
// Step two: claim a username
// ---------------------------------------------------------------------------

/**
 * Claim the player's `@username` during sign-up.
 *
 * SEPARATE FROM THE HANDLE, and asked second, because they are different things
 * that fail differently. A handle is a display name: it is COERCED and can never
 * fail. A username is a claim on a globally unique namespace, so it CAN fail —
 * taken, reserved, badly formatted — and the player has to be able to try again.
 * Folding them into one form would mean a rejected username silently discarding
 * an accepted handle.
 *
 * SKIPPABLE, AND THAT IS NOT NEGOTIABLE. Sign-in must never be a dead end. If
 * every name a player tries is taken, or the database is having a bad minute,
 * they still have to be able to reach the site — so {@link skipUsernameAction}
 * exists and the page always offers it. A username stays claimable forever from
 * the account page, and the promo nudges anyone who skipped.
 *
 * The same validation the API route runs, in the same order, because a second
 * spelling of these rules is a second thing to keep in sync: format first, then
 * the slur list (server-only, never shipped to a browser), then the claim, whose
 * unique-violation is the only correct resolution of the check-then-claim race.
 */
export async function setInitialUsernameAction(formData: FormData): Promise<void> {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/welcome");

  const next =
    safeRelativePath(String(formData.get("next") ?? "")) ?? DEFAULT_NEXT;
  const back = (code: string) =>
    `/play/welcome?next=${encodeURIComponent(next)}&uerror=${code}`;

  const raw = String(formData.get("username") ?? "");
  const format = validateUsernameFormat(raw);
  if (!format.ok) redirect(back(format.reason));

  // Server-only list: shipping it to the browser would let it be scraped into an
  // offline evasion dictionary.
  if (containsBlockedTerm(format.username)) redirect(back("reserved"));

  let outcome: "claimed" | "taken" | "held" | "error" = "error";
  try {
    const result = await social.claimUsername(playerId, format.username);
    if (result.claimed) outcome = "claimed";
    else if (result.tombstoned) outcome = "held";
    else outcome = "taken";
  } catch (error) {
    // A unique violation means somebody claimed it between the check and the
    // write. That is expected under any concurrency and reads as "taken".
    outcome =
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "23505"
        ? "taken"
        : "error";
  }

  if (outcome === "claimed") redirect(next);
  redirect(back(outcome));
}

/**
 * Skip the username step and carry on to wherever the player was heading.
 *
 * An action rather than a plain link so it is a POST: a crawler, a link
 * prefetcher, or an over-eager browser cannot "skip" on the player's behalf by
 * fetching a URL.
 */
export async function skipUsernameAction(formData: FormData): Promise<void> {
  const next =
    safeRelativePath(String(formData.get("next") ?? "")) ?? DEFAULT_NEXT;
  redirect(next);
}
