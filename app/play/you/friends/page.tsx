/**
 * `/play/you/friends` — the FRIENDS tab.
 *
 * A server shell around `FriendsIsland`, which fetches everything about every
 * actual person from `/api/v1/me/friends` client-side. This file reads no
 * session of its own — it does not need to, because `layout.tsx` has already
 * gated the subtree — and it renders no personal data itself.
 *
 * WHAT CHANGED FROM `/play/friends`, AND WHY THE OLD ARGUMENT NO LONGER HOLDS.
 * That page reasoned, correctly at the time, that it could be left OUT of the
 * service worker's never-intercept list precisely BECAUSE it read no session:
 * `sw.js` caches HTML navigations into `hp-runtime`, which is shared across
 * everyone using the browser profile and survives deploys, so a page is only
 * safe to precache if its HTML contains nobody's data. That page's did not, so
 * it was precachable and worked offline, with the island rendering nothing until
 * it could reach the network.
 *
 * Under this layout the shell is no longer the whole story. The layout above
 * calls `auth()` and prints the owner's avatar, display name and EMAIL into the
 * HTML of every tab, this one included. So:
 *
 *   * the route is dynamic and can never be prerendered or precached;
 *   * `/play/you` must be in the never-intercept list, for the same reason
 *     `/play/account` was;
 *   * this tab consequently does NOT work offline, which the old `/play/friends`
 *     shell technically did. That is a real, accepted cost of the merge: the
 *     island had no data offline anyway, so what is lost is an empty frame.
 *
 * The island itself is untouched — it still owns the friends list, the incoming
 * and outgoing requests, challenges and the add flow, and its credentialed
 * writes keep passing `isTrustedOrigin` because that allowlist matches on the
 * `/play/` prefix, which `/play/you/friends` still satisfies.
 */

import type { Metadata } from "next";
import { FriendsIsland } from "@/app/components/friends/FriendsIsland";

export const metadata: Metadata = {
  title: "Friends",
  // Never index a personal surface. Repeated from the layout deliberately — see
  // the long note there, and the `/u/[username]` docblock for why this codebase
  // treats it as a child-safety requirement rather than SEO hygiene.
  robots: { index: false, follow: false },
};

export default function YouFriendsPage() {
  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-2xl font-black tracking-tight text-zinc-900">
          Friends
        </h2>
        <p className="mt-2 text-[15px] font-semibold text-muted">
          Add friends to see what they&rsquo;re playing.
        </p>
      </section>

      <FriendsIsland />
    </div>
  );
}
