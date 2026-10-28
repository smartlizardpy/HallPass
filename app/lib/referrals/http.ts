/**
 * Fright Fest referrals — shared bits of the routes. Same-origin and credentialed
 * like the candy routes (`collectibles/http.ts`): `private, no-store`, cross-site
 * refused, the player always the session's.
 */

import "server-only";
import { auth } from "@/app/lib/auth";
import { upsertPlayerOnLogin } from "@/app/lib/players";
import { cookieMaxAgeSec } from "./config";
import { REFERRALS } from "./index";

export { crossSite, fail, json, NO_STORE } from "@/app/lib/collectibles/http";

/**
 * The signed-in player's id, with their `players` row guaranteed (the same upsert
 * the championship routes make: a referral row has a foreign key to it, and the
 * account's `created_at` is what decides whether they are a NEW player).
 */
export async function referralPlayer(where: string): Promise<string | null> {
  try {
    const session = await auth();
    const id = session?.user?.playerId;
    if (!id) return null;
    const email = session?.user?.email;
    if (email) {
      await upsertPlayerOnLogin({ id, email, name: session.user?.name, image: session.user?.image }).catch((error) =>
        console.error(`referrals ${where}: player upsert failed:`, error),
      );
    }
    return id;
  } catch (error) {
    console.error(`referrals ${where}: auth() failed:`, error);
    return null;
  }
}

/** `Set-Cookie` for a pending token: first-party, HttpOnly (the server is the only reader), Lax so it survives the link click. */
export function pendingCookie(reqUrl: string, token: string, nowMs: number = Date.now()): string {
  const secure = new URL(reqUrl).protocol === "https:" ? "; Secure" : "";
  return `${REFERRALS.cookie}=${encodeURIComponent(token)}; Path=/; Max-Age=${cookieMaxAgeSec(REFERRALS, nowMs)}; SameSite=Lax; HttpOnly${secure}`;
}
