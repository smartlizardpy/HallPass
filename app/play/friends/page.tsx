/**
 * `/play/friends` — kept alive only to forward to `/play/you/friends`.
 *
 * The friends UI is now a tab of the `/play/you` set, next to the profile and
 * settings tabs, so the island and its headings have moved there. As with
 * `/play/account`, the route is NOT deleted: it is linked from the tab bar, the
 * account surfaces and the challenge push notifications (`app/lib/push/payload.ts`
 * and `sw.js` both fall back to `/play/friends` as a notification target), and it
 * has been shareable long enough to be bookmarked. Forwarding costs one hop;
 * deleting costs a 404 on a notification tap.
 *
 * `redirect()` (307) rather than `permanentRedirect()` (308), for the reason
 * spelled out in `app/play/account/page.tsx`: a 308 is cached in the browser's
 * HTTP cache and outlives the server's willingness to send it.
 *
 * WHAT THIS CHANGE GIVES UP, stated plainly because the docblock this replaces
 * promised the opposite. This page used to be a server shell that read no
 * session: headings plus a client island, no byte of anyone's data in the HTML.
 * That was load-bearing — it kept the route static, which put it in the service
 * worker's precache and let it be excluded from `sw.js`'s never-intercept list
 * while `/play/account` had to be in it. NONE OF THAT IS TRUE ANY MORE. The
 * destination is dynamic and owner-only, so this route now leads somewhere that
 * must never be cached, and `/play/friends` has been added to `isPrivatePath()`
 * in `public/sw.js` — see the comment there for why forwarding to a private page
 * makes the forwarder itself unsafe to cache, even though a 307 carries no PII.
 *
 * The offline capability lost with it was a shell and not much more: the island
 * rendered nothing at all until it could reach `/api/v1/me/friends`, so an
 * offline visitor got headings over an empty box. Trading that for a single
 * friends surface is the deliberate call.
 *
 * No `metadata` export, for the same reason as `/play/account`: a redirect emits
 * no document, so a `robots` directive here could never reach a crawler. The
 * `/play/` disallow in `app/robots.ts` and the destination's own noindex are what
 * actually do the work.
 */

import { redirect } from "next/navigation";

export default function FriendsPage(): never {
  redirect("/play/you/friends");
}
