/**
 * The "you're offline" card, drawn once for the two places that show it.
 *
 * WHERE IT APPEARS:
 *   1. `app/offline/you/page.tsx` — the precached document `public/sw.js` serves
 *      when a NAVIGATION into `/play/you` cannot reach the network (a hard
 *      reload, a shared link, an installed app opened cold on that URL).
 *   2. `MobileTabBar`'s overlay — the instant answer when the tab is TAPPED on a
 *      device that already knows it has no network route, where waiting for a
 *      navigation to fail first would just be a slower way to say the same
 *      thing.
 *
 * Those two arrive by completely different routes and must not look like two
 * different features, which is the entire reason this is a component rather
 * than markup in whichever file needed it first. The caller supplies the way
 * out, because that genuinely differs: the document offers a link to the
 * precached arcade, the overlay a button that simply puts it away — the player
 * never left the page they were on.
 *
 * NO `"use client"`: this is markup, so it takes the boundary of whoever imports
 * it. The page renders it on the server; the overlay renders it on the client.
 *
 * PLAIN `<img>`, NOT `next/image`, and this is load-bearing rather than a style
 * preference. The optimizer serves through `/_next/image?url=…`, an endpoint
 * that is not precached and cannot be reached offline — the one image on the one
 * screen that only ever appears without a network would be the one thing on it
 * that fails. The raw file is precached instead; see `/offline-wifi.png` in
 * `scripts/build-sw-manifest.mjs`.
 */

export function OfflineNotice({
  message,
  children,
}: {
  /** The sentence under the heading. The caller names the destination. */
  message: string;
  /** The way out — a link on the document, a dismiss button on the overlay. */
  children: React.ReactNode;
}) {
  return (
    // `bg-foreground` (#1c1c28) rather than a flat black: it is the ink this site
    // already writes with, so the card reads as part of HallPass rather than as a
    // browser error — and it matches the black offline pill in `PWA.tsx`, which
    // is the other thing on screen when this appears.
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
        {message}
      </p>

      <div className="mt-6">{children}</div>

      <p className="mt-6 text-xs font-bold uppercase tracking-wider text-white/40">
        Games you&rsquo;ve opened still play offline
      </p>
    </div>
  );
}
