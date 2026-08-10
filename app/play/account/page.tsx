/**
 * `/play/account` — kept alive only to forward to `/play/you`.
 *
 * Everything this route used to render — the verified identity and email, the
 * handle form, cross-board standings, badges, the friend-code card and the
 * self-delete danger zone — now lives in the `/play/you` tab set. What is left
 * here is the forwarding.
 *
 * THE ROUTE IS DELIBERATELY NOT DELETED. Something over twenty places in the app
 * link to `/play/account` (the tab bar, the account menu, the back button, the
 * sign-in `callbackUrl`, the sign-out page, the server actions in `./actions.ts`),
 * and beyond the code there are real bookmarks and installed-PWA entry points
 * that no refactor can reach. A 404 would break every one of them; a redirect
 * turns them all into a single hop.
 *
 * `redirect()` (307), NOT `permanentRedirect()` (308). Both are legal in a server
 * component, but a 308 is cached by the browser's HTTP cache and keeps being
 * honoured long after the server stops sending it — on a shared school machine
 * that is effectively unrecallable. A temporary redirect keeps this reversible
 * while the new tab set beds in, and costs nothing: the hop is invisible.
 *
 * THERE IS NO `metadata` EXPORT ANY MORE, and that is the honest outcome rather
 * than an oversight. The old one carried `robots: { index: false, follow: false }`,
 * which meant something while this route returned a document. It does not now:
 * `redirect()` terminates the render, so Next answers with a bodyless 307 and no
 * `<meta name="robots">` is ever emitted. Keeping the export would be a claim the
 * response cannot make. The protection itself is unchanged in substance — the
 * crawl rules in `app/robots.ts` disallow `/play/`, and a crawler that follows
 * this hop lands on `/play/you`, which carries its own noindex.
 *
 * The query string is NOT forwarded. `?ok=1` and `?error=…` are banner codes
 * belonging to the page this file used to be (see `./actions.ts`); the tab that
 * now owns those forms defines its own, so replaying the old vocabulary at it
 * would only produce banners nobody agreed to render.
 */

import { redirect } from "next/navigation";

export default function PlayAccountPage(): never {
  redirect("/play/you");
}
