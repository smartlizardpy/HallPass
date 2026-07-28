"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicProfile } from "../../lib/social/store";
import { Avatar } from "./Avatar";

/**
 * "N friends play this" — the store page's social chip.
 *
 * A CLIENT ISLAND, and it has to be. `/game/[slug]` must stay statically
 * prerendered: a single `auth()` on that page makes the route dynamic, drops it
 * from `prerender-manifest.json`, and therefore drops every `/game/<slug>` URL
 * from the service-worker precache — silently breaking offline play with no
 * error anywhere. Per-viewer data can only arrive from `/api/`, which the SW
 * never intercepts.
 *
 * Renders `null` in every uninteresting case — loading, signed out, no friends
 * play this, offline — rather than a placeholder. The app has no Suspense
 * boundaries and no skeletons on public pages, and a "0 friends" row would be a
 * worse thing to show a new player than nothing at all.
 */
export function FriendsWhoPlay({ slug }: { slug: string }) {
  const [friends, setFriends] = useState<PublicProfile[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/me/friends/activity?slugs=${encodeURIComponent(slug)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { bySlug?: Record<string, PublicProfile[]> } | null) => {
        if (!active) return;
        setFriends(data?.bySlug?.[slug] ?? []);
      })
      // Offline, or the schema is behind the deploy: stay silent.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [slug]);

  if (!friends || friends.length === 0) return null;

  const names = friends.map((f) => f.displayName);
  const summary =
    names.length === 1
      ? `${names[0]} plays this`
      : names.length === 2
        ? `${names[0]} and ${names[1]} play this`
        : `${names[0]}, ${names[1]} and ${names.length - 2} more play this`;

  return (
    <Link
      href="/play/friends"
      className="mt-4 flex items-center gap-3 rounded-2xl bg-white p-3 transition hover:bg-surface-2"
    >
      {/* Stacked avatars, most-recent first. Negative margin overlaps them; the
          ring separates each from the one beneath. */}
      <span className="flex shrink-0 -space-x-2">
        {friends.slice(0, 4).map((friend) => (
          <span key={friend.id} className="rounded-full ring-2 ring-white">
            <Avatar person={friend} size={28} />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-zinc-700">
        {summary}
      </span>
    </Link>
  );
}
