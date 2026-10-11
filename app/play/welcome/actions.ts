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

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { parseAvatarChoice } from "@/app/lib/avatars";
import { AVATAR_SKIP_COOKIE, AVATAR_SKIP_MAX_AGE_S } from "@/app/lib/onboarding";
import { creditedSlugsFor, expireTesterCredits } from "@/app/lib/beta";
import { validateHandle } from "@/app/lib/handle";
import { setAvatarChoice, setPlayerHandle } from "@/app/lib/players";
import { hasBlockedDisplayTerm } from "@/app/lib/reviews/wordlist";
import { safeRelativePath } from "@/app/lib/safe-redirect";
import { social } from "@/app/lib/social";
import { validateUsernameFormat } from "@/app/lib/username";
import { containsBlockedTerm } from "@/app/lib/username-wordlist";

/** Where to land after choosing, if the form did not say. */
const DEFAULT_NEXT = "/";

/** The welcome page, carrying the final destination: it picks the next step. */
const onward = (next: string) => `/play/welcome?next=${encodeURIComponent(next)}`;

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

  // Almost always `[]` this early; checked anyway because the handle is the
  // name a credited beta tester's game page prints.
  expireTesterCredits(await creditedSlugsFor(playerId), "action");

  // Hand back to the welcome page, which decides the next step (username, then
  // avatar). Going straight to `next` skipped every step after this one.
  redirect(onward(next));
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

  if (outcome === "claimed") {
    // A credit with no handle prints `@username`.
    expireTesterCredits(await creditedSlugsFor(playerId), "action");
    // Back to the welcome page for the avatar step; it redirects on to `next`
    // itself when there is nothing left to ask.
    redirect(onward(next));
  }
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
  // Back to the welcome page, not straight to `next`, so the avatar step still
  // follows. `su=1` tells the page the username was skipped on purpose; without
  // it the page would ask for the username again.
  redirect(`/play/welcome?next=${encodeURIComponent(next)}&su=1`);
}

// ---------------------------------------------------------------------------
// Step three: pick your look (skippable)
// ---------------------------------------------------------------------------

/**
 * Save the avatar chosen during sign-up.
 *
 * Identity comes ONLY from `auth()`. The form supplies `meme`, `colour` and a
 * destination, and the first two are re-validated by `parseAvatarChoice`, the
 * same strict check the Settings card uses. A rejected pick or a write error
 * does not block anything: the player lands on `next` and can choose again from
 * Settings, so this step can never strand a sign-in.
 */
export async function setInitialAvatarAction(formData: FormData): Promise<void> {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) redirect("/play/signin?callbackUrl=/play/welcome");

  const next =
    safeRelativePath(String(formData.get("next") ?? "")) ?? DEFAULT_NEXT;
  const choice = parseAvatarChoice({
    meme: formData.get("meme"),
    colour: formData.get("colour"),
  });
  if (choice) {
    try {
      await setAvatarChoice(playerId, choice);
    } catch (error) {
      console.error("onboarding avatar save failed:", error);
    }
  }
  redirect(next);
}

/**
 * Skip the avatar step. Remembered in a 30-day cookie (no migration) so the
 * landing router and the gate stop asking; the avatar stays on its generated
 * default and can be chosen any time in Settings. A POST, like the username
 * skip, so a prefetcher cannot skip on the player's behalf.
 */
export async function skipAvatarAction(formData: FormData): Promise<void> {
  const next =
    safeRelativePath(String(formData.get("next") ?? "")) ?? DEFAULT_NEXT;
  (await cookies()).set(AVATAR_SKIP_COOKIE, "1", {
    maxAge: AVATAR_SKIP_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  redirect(next);
}
