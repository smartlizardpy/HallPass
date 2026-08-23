/**
 * The offline answer for the player's OWN pages — `/play/you` and its tabs.
 *
 * WHY THE SUBTREE NEEDS ITS OWN DOCUMENT, when `/offline` already exists.
 * `/offline` says "this page isn't saved on your device — go and pick a game",
 * which is the right answer for a page that COULD have been cached and simply
 * was not. These pages are the other kind: `public/sw.js` refuses to cache the
 * `/play/you` subtree on purpose (`hp-runtime` is shared by everyone using the
 * browser profile, so a cached copy is one pupil's email and standings waiting
 * for the next one), so there is no version of "come back when it's cached" that
 * will ever come true. The honest message is the connection, not the cache.
 *
 * WHAT ACTUALLY HAPPENS ON A TAP, end to end, because this page only makes sense
 * as the last step of it:
 *
 *   1. `MobileTabBar`'s You tab is a `<Link>`, so the router asks for the RSC
 *      payload for `/play/you`. Offline, that fetch rejects.
 *   2. Next answers a rejected navigation fetch with a full browser navigation
 *      to the same URL — `fetch-server-response.js` logs "Falling back to
 *      browser navigation" and returns the original URL as an MPA navigation.
 *   3. That navigation reaches the service worker as a `navigate` request, the
 *      network fails again, and `privatePageFallback` serves THIS document under
 *      the `/play/you` URL the player asked for.
 *
 * Before this existed, step 3 had nowhere to go — the SW returned early for the
 * whole subtree, so the browser showed its own network error page, and the tab
 * bar just sat there lit up.
 *
 * ── CONSTRAINTS, ALL OF THEM LOAD-BEARING ──────────────────────────────────
 *
 * SELF-CONTAINED, like `/offline`: no DB reads, no `auth()`, no client
 * components, and nothing fetched at render. It is rendered exactly when the
 * network is gone.
 *
 * NO PII, EVER — a harder rule here than on `/offline`. This document is
 * PRECACHED, which means it is fetched once at install and then served to
 * whoever is holding the phone, under a URL whose real content is private. It
 * must therefore be identical for every visitor. That is why it is static and
 * says "your profile" rather than anyone's name: it is the one page in the
 * subtree that is allowed to be shared, and it is allowed only because it knows
 * nothing.
 *
 * PLAIN `<img>`, NOT `next/image`. The optimizer serves through
 * `/_next/image?url=…`, an endpoint that is not precached and cannot be reached
 * offline — the one image this page needs would be the one image that fails on
 * the only occasion it is ever shown. The raw file is precached instead; see the
 * `/offline-wifi.png` entry in `scripts/build-sw-manifest.mjs`.
 *
 * THE WAY OUT IS `/`, which IS precached, so the button works offline. Anything
 * else in the subtree would land the player back here.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline",
  // Never index a page whose whole purpose is a failure state — and this one
  // stands in for URLs that are `noindex` in their own right.
  robots: { index: false, follow: false },
};

export default function OfflineYouPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      {/* `bg-foreground` (#1c1c28) rather than a flat black: it is the ink this
          site already writes with, so the card reads as part of HallPass rather
          than as a browser error — and it matches the black offline pill in
          `PWA.tsx`, which is the other thing on screen when this appears. */}
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-foreground px-7 py-9 text-center shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/offline-wifi.png"
          alt=""
          width={50}
          height={50}
          className="mx-auto h-[50px] w-[50px]"
        />

        <h1 className="mt-5 text-xl font-black tracking-tight text-white">
          Oh no &mdash; you&rsquo;re offline
        </h1>
        <p className="mt-2.5 text-sm font-semibold leading-relaxed text-white/60">
          Connect to wifi to open your You page. Your profile, badges, friends
          and settings all live on our servers, so they need a connection.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
        >
          Back to games
        </Link>

        <p className="mt-6 text-xs font-bold uppercase tracking-wider text-white/40">
          Games you&rsquo;ve opened still play offline
        </p>
      </div>
    </main>
  );
}
