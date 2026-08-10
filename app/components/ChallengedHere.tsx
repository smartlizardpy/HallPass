"use client";

/**
 * "Ozan challenged you here" — the store page's challenge chip.
 *
 * A CLIENT ISLAND, and it has to be, for exactly the reason `FriendsWhoPlay`
 * spells out: `/game/[slug]` must stay statically prerendered, because a single
 * `auth()` on that page makes the route dynamic, drops it from
 * `prerender-manifest.json`, and therefore drops every `/game/<slug>` URL from
 * the service-worker precache — silently breaking offline play with no error
 * anywhere. Per-viewer data can only arrive from `/api/`, which the SW never
 * intercepts.
 *
 * Renders `null` in every uninteresting case — loading, signed out, nobody has
 * challenged you here, offline — rather than a placeholder. The app has no
 * Suspense boundaries and no skeletons on public pages, and "0 challenges" is a
 * worse thing to show than nothing.
 *
 * It shows the goal rather than the score to beat: "get 4,201 to win" is the
 * number a player can act on, and it comes from `scoreToBeat()` so the screen
 * cannot promise a value the server would reject.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { IncomingChallenge } from "@/app/lib/challenges/store";
import { scoreToBeat } from "@/app/lib/challenges/resolve";
import { Avatar } from "./friends/Avatar";

export function ChallengedHere({ slug }: { slug: string }) {
  const [challenges, setChallenges] = useState<IncomingChallenge[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/me/challenges?game=${encodeURIComponent(slug)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { incoming?: IncomingChallenge[] } | null) => {
        if (!active) return;
        setChallenges(data?.incoming ?? []);
      })
      // Offline, or the schema is behind the deploy: stay silent.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [slug]);

  if (!challenges || challenges.length === 0) return null;

  const [first] = challenges;
  const others = challenges.length - 1;
  const goal = scoreToBeat(first.targetScore, first.sort);

  return (
    <Link
      href="/play/friends"
      className="mt-4 flex items-center gap-3 rounded-2xl bg-amber-50 p-3 transition hover:bg-amber-100"
    >
      <span className="shrink-0 rounded-full ring-2 ring-white">
        <Avatar person={first.from} size={28} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-amber-900">
        {others > 0
          ? `${first.from.displayName} and ${others} more challenged you here`
          : `${first.from.displayName} challenged you — get ${goal.toLocaleString()} to win`}
      </span>
    </Link>
  );
}
