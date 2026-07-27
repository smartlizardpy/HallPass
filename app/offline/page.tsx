/**
 * The offline fallback document.
 *
 * This page exists FOR THE SERVICE WORKER, not for navigation — nothing links to
 * it. `public/sw.js`'s `networkFirst` serves it when a navigation cannot be
 * satisfied from the network or any cache, and `scripts/build-sw-manifest.mjs`
 * precaches `/offline` explicitly so it is always available.
 *
 * Why it had to exist: the SW previously fell back to the cached `/` document
 * for ANY unsatisfiable navigation, which rendered the arcade catalog underneath
 * whatever URL the user had opened (`/u/someone`, `/game/silence/` — the
 * trailing-slash form that `skipTrailingSlashRedirect: true` keeps alive and
 * never precaches). That shows a confidently wrong page and leaves the client
 * router holding an RSC payload for a different route.
 *
 * It must be fully self-contained: no DB reads, no session, no client
 * components, no images that are not already precached. It is rendered at a
 * moment when, by definition, the network is unavailable.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "../components/Wordmark";

export const metadata: Metadata = {
  title: "Offline",
  // Never index a page whose whole purpose is a failure state.
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <Wordmark size="text-3xl" dotClass="h-2 w-2" />

      <h1 className="mt-8 text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
        You&rsquo;re offline
      </h1>
      <p className="mt-3 max-w-sm text-[15px] font-semibold leading-relaxed text-muted">
        This page isn&rsquo;t saved on your device. Games you&rsquo;ve already
        opened still work — head back to the arcade and pick one.
      </p>

      <Link
        href="/"
        className="mt-8 rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white transition hover:bg-brand-600"
      >
        Back to the arcade
      </Link>

      <p className="mt-10 text-xs font-bold uppercase tracking-wider text-muted">
        Reconnect and reload to see everything
      </p>
    </main>
  );
}
