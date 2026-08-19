"use client";

import { useEffect, useState } from "react";
import type { FriendStanding } from "../../lib/scoreboard/store";
import Link from "next/link";
import {
  groupFriendStandings,
  promptFor,
  shouldNameBoards,
  type FriendBoardPrompt,
  type FriendBoardRow,
} from "../../lib/scoreboard/friend-board";
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
 * cases where it has nothing to say are the COMMON ones — signed out, nobody in
 * the friend set has scored on this game, the game has no board at all — and a
 * "You and your friends" heading over an empty box on a page whose job is to get
 * somebody playing is worse than silence.
 *
 * The ONE empty case that does render is a player alone on their own board: they
 * have a score, so the panel exists, and {@link Prompt} spends that moment on the
 * only ask this site can make honestly there. Which sentence — and why a player
 * with no score of their own never sees either — is decided in
 * `lib/scoreboard/friend-board.ts`, not here.
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
  const [friends, setFriends] = useState(0);

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
        const body = (await res.json()) as {
          standings?: FriendStanding[];
          friends?: number;
        };
        if (!ignore) {
          setStandings(body.standings ?? []);
          setFriends(body.friends ?? 0);
        }
      } catch {
        // Offline, or the API is down. Stay null — see the module docblock.
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug]);

  if (!standings || standings.length === 0) return null;

  // Grouping, competition numbering and tie detection all live in the pure
  // model — see `lib/scoreboard/friend-board.ts`. Nothing about them is decided
  // here, so all of it is under test.
  const groups = groupFriendStandings(standings);
  const named = shouldNameBoards(groups);
  const prompt = promptFor(groups, friends);

  return (
    <section className="mt-5 max-w-3xl rounded-3xl bg-white p-5 sm:p-6">
      <h2 className="text-lg font-black tracking-tight text-zinc-900">
        You and your friends
      </h2>

      {groups.map((group) => (
        <div key={group.boardId} className="mt-4 first:mt-3">
          {named && (
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-muted">
              {group.title}
            </h3>
          )}
          <ol className="space-y-2">
            {group.rows.map((row) => (
              <StandingRow key={row.player.id} row={row} />
            ))}
          </ol>
        </div>
      ))}

      <Prompt prompt={prompt} />
    </section>
  );
}

/**
 * The one line under a board nobody else is on yet.
 *
 * It is a LINK, not a button with a dialog: both destinations already exist and
 * do the job properly, and a second friend-adding surface would be a second
 * place for the friend-code rules to be implemented. Renders nothing for
 * `none`, which is the case on every board that has a race on it.
 */
function Prompt({ prompt }: { prompt: FriendBoardPrompt }) {
  if (prompt === "none") return null;

  return (
    <Link
      href="/play/you/friends"
      className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-[13px] font-bold text-zinc-700 transition hover:bg-brand-50"
    >
      <span className="min-w-0">
        {prompt === "add-friends"
          ? "Nobody to race yet — add a friend and this becomes a leaderboard."
          : "None of your friends have scored here. Challenge one of them."}
      </span>
      <span aria-hidden className="shrink-0 font-black text-brand">
        →
      </span>
    </Link>
  );
}

/** One player's row: their place among friends, who they are, and their best. */
function StandingRow({ row }: { row: FriendBoardRow }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${
        row.isYou ? "bg-brand-50" : "bg-surface-2"
      }`}
    >
      {/* "=1" on a tie. Two friends holding the same best have no order between
          them, and numbering them 1 and 2 would render a coin flip as a fact. */}
      <span className="w-6 shrink-0 text-center text-[13px] font-black tabular-nums text-muted">
        {row.tied ? "=" : ""}
        {row.position}
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
