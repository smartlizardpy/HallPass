"use client";

import { useEffect, useState } from "react";
import type { FriendStanding } from "../../lib/scoreboard/store";
import { Avatar } from "./Avatar";

/**
 * "You and your friends" — the store page's friends leaderboard.
 *
 * A CLIENT ISLAND, and it has to be: `/game/[slug]` must stay statically
 * prerendered or every game page falls out of the service-worker precache. The
 * constraint, and why it is fatal rather than untidy, is written out in full in
 * `GameAchievements` and `friends/activity`. Nothing here may become a server
 * read.
 *
 * IT DECIDES FOR ITSELF WHETHER TO EXIST, like the achievements shelf and the
 * friends chip beside it. There is no heading until there are rows, because the
 * cases where it has nothing to say are the COMMON ones — signed out, no friends
 * added, nobody in the friend set has scored on this game, the game has no board
 * at all — and a "You and your friends" heading over an empty box on a page
 * whose job is to get somebody playing is worse than silence.
 *
 * NO SPINNER, NO OFFLINE BANNER, for the reason the sibling islands give: the
 * service worker never intercepts `/api/`, so offline this fetch simply rejects,
 * a spinner would spin forever, and a banner would appear on every game page
 * including the ones that have no leaderboard to be missing.
 *
 * WHAT THE TWO NUMBERS MEAN, and why both are here: the ORDER of the rows is
 * where you stand among your friends, and the `#n` on the right is where that
 * score stands on the whole board. The first is the race; the second is what
 * winning it is worth. See `friends-leaderboard-design.md` §2a for the rank's
 * exact semantics — it is inherited from `/play/you` deliberately, imprecision
 * included, so the two surfaces cannot print different ranks for one person.
 *
 * Nothing is cached client-side. This is a friend list on a page that may be
 * open on a shared school computer; it must not outlive the session.
 */
export function FriendsBoard({ slug }: { slug: string }) {
  const [standings, setStandings] = useState<FriendStanding[] | null>(null);

  useEffect(() => {
    // `ignore` rather than an AbortController, matching `GameAchievements`: the
    // only thing that can change is `slug`, and the single failure worth
    // preventing is a stale response overwriting a newer one.
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/me/friends/scores?slug=${encodeURIComponent(slug)}`,
          { credentials: "include" },
        );
        if (!res.ok || ignore) return;
        const body = (await res.json()) as { standings?: FriendStanding[] };
        if (!ignore) setStandings(body.standings ?? []);
      } catch {
        // Offline, or the API is down. Stay null — see the module docblock.
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug]);

  if (!standings || standings.length === 0) return null;

  // Group in render order. The endpoint already returns boards in their stable
  // `created_at ASC, id ASC` order with each board's rows together, so a Map
  // keyed by board preserves exactly that without a second sort.
  const boards = new Map<string, FriendStanding[]>();
  for (const row of standings) {
    const rows = boards.get(row.boardId);
    if (rows) rows.push(row);
    else boards.set(row.boardId, [row]);
  }

  // A single board's title is nearly always the game's own name, so printing it
  // under a heading that already names the game says the same word twice. It
  // earns its place only when there is more than one board to tell apart.
  const named = boards.size > 1;

  return (
    <section className="mt-5 max-w-3xl rounded-3xl bg-white p-5 sm:p-6">
      <h2 className="text-lg font-black tracking-tight text-zinc-900">
        You and your friends
      </h2>

      {[...boards.entries()].map(([boardId, rows]) => (
        <div key={boardId} className="mt-4 first:mt-3">
          {named && (
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-muted">
              {rows[0].boardTitle}
            </h3>
          )}
          <ol className="space-y-2">
            {rows.map((row, index) => (
              <StandingRow key={row.player.id} row={row} position={index + 1} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

/** One player's row: their place among friends, who they are, and their best. */
function StandingRow({ row, position }: { row: FriendStanding; position: number }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${
        row.isYou ? "bg-brand-50" : "bg-surface-2"
      }`}
    >
      <span className="w-5 shrink-0 text-center text-[13px] font-black text-muted">
        {position}
      </span>
      <Avatar person={row.player} size={28} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-zinc-700">
        {row.player.displayName}
        {row.isYou && (
          <span className="ml-1.5 text-[11px] font-black uppercase tracking-wide text-brand">
            You
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-black tabular-nums text-zinc-900">
          {row.best.toLocaleString()}
        </span>
        {/* The board's own word for what the number is — "Voltage", "Seconds" —
            not a generic "score", because the game chose it and the leaderboard
            inside the game already uses it. */}
        <span className="block text-[10px] font-black uppercase tracking-wide text-muted">
          {row.scoreLabel}
        </span>
      </span>
      <span
        className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-black tabular-nums text-zinc-700"
        title="Rank on the whole leaderboard"
      >
        #{row.rank.toLocaleString()}
      </span>
    </li>
  );
}
