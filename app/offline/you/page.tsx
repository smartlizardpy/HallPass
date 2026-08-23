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
 * WHEN THIS DOCUMENT IS WHAT THE PLAYER SEES. It answers a NAVIGATION that
 * reached the network and failed: a hard reload, a shared link, an installed app
 * launched cold on one of these URLs, or the browser navigation Next falls back
 * to when its RSC fetch rejects (`fetch-server-response.js` logs "Falling back to
 * browser navigation"). A TAP on the tab bar of a device that already knows it is
 * offline is answered sooner, by `MobileTabBar`'s overlay, without waiting for a
 * navigation to fail first — same card, drawn by `OfflineNotice` for both.
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
 * THE WAY OUT IS `/`, which IS precached, so the button works offline. Anything
 * else in the subtree would land the player back here.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OfflineNotice } from "@/app/components/offline/OfflineNotice";

export const metadata: Metadata = {
  title: "Offline",
  // Never index a page whose whole purpose is a failure state — and this one
  // stands in for URLs that are `noindex` in their own right.
  robots: { index: false, follow: false },
};

export default function OfflineYouPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <OfflineNotice message="Connect to wifi to open your You page. Your profile, badges, friends and settings all live on our servers, so they need a connection.">
        <Link
          href="/"
          className="inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
        >
          Back to games
        </Link>
      </OfflineNotice>
    </main>
  );
}
