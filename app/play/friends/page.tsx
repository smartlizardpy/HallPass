/**
 * The friends page.
 *
 * A SERVER SHELL THAT READS NO SESSION. It renders headings and an island, and
 * nothing else — every byte about any actual person arrives client-side from
 * `/api/v1/me/friends`.
 *
 * That is not incidental. It is why this page can be left OUT of the service
 * worker's never-intercept list while `/play/account` had to go in: `sw.js`
 * caches HTML navigations into `hp-runtime`, which is shared across everyone
 * using the browser profile and survives deploys, so any page whose HTML
 * contains one person's data is a leak waiting for the next user of a shared
 * school machine. This page's HTML contains nobody's data, so it can be
 * precached and still work offline — the island just renders nothing until it
 * can reach the network.
 *
 * Calling `auth()` here would also make the route dynamic and drop it from the
 * precache entirely.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { FriendsIsland } from "../../components/friends/FriendsIsland";

export const metadata: Metadata = {
  title: "Friends",
  // Never index a personal surface. See the /u/[username] note for why this is a
  // header + meta rather than a robots.txt Disallow.
  robots: { index: false, follow: false },
};

export default function FriendsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/"
        className="inline-block text-sm font-bold text-brand hover:text-brand-600"
      >
        ← Back to games
      </Link>

      <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
        Friends
      </h1>
      <p className="mt-2 text-[15px] font-semibold text-muted">
        Add friends to see what they&rsquo;re playing.
      </p>

      <div className="mt-6">
        <FriendsIsland />
      </div>
    </main>
  );
}
