"use client";

import { useEffect, useState } from "react";
import {
  buildGameBoards,
  isPodium,
  shouldNameBoards,
  type GameBoard,
  type GameBoardPayload,
  type GameBoardRow,
} from "../lib/scoreboard/game-board";
import { Avatar } from "./friends/Avatar";

/**
 * "Top players" — the public leaderboard on a game's store page.
 *
 * A CLIENT ISLAND, and it has to be, for the constraint `GameAchievements` and
 * `FriendsBoard` write out in full: `/game/[slug]` must stay statically
 * prerendered or every game page drops out of `prerender-manifest.json`, and
 * therefore out of the service-worker precache, silently breaking offline play
 * with no error anywhere. Nothing here may become a server read.
 *
 * Server rendering it would be wrong even if the route were dynamic: these rows
 * change whenever anybody plays, and a prerender would bake one afternoon's board
 * into the HTML the PWA then serves from the precache indefinitely.
 *
 * ── IT DECIDES FOR ITSELF WHETHER TO EXIST ─────────────────────────────────
 *
 * `null` until loaded, and `null` forever when the game has no board or no
 * scores. The parent renders it unconditionally because only the fetch knows:
 * boards are admin-provisioned and a game may well have none, and a "Top players"
 * heading over an empty box on every such page is worse than no section at all.
 *
 * NO SPINNER, NO OFFLINE BANNER, for the reason its two siblings give: the
 * service worker never intercepts `/api/`, so offline this fetch simply rejects.
 * A spinner would spin forever, and a banner would announce a missing leaderboard
 * on every game page including the ones that have no leaderboard to miss. A
 * failed load and an unprovisioned game are the same silence.
 *
 * ── WHAT IT SHOWS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 *
 * The top of the board, as far down as the endpoint serves it (`GAME_BOARD_ROWS`
 * in `lib/scoreboard/config.ts`) — but NOT the viewer's own standing. That
 * belongs to `FriendsBoard` directly above, which already prints the viewer's
 * rank on the whole board beside their friends. Keeping every per-viewer field
 * out of this panel is also what lets its endpoint stay publicly cacheable; see
 * that route's docblock.
 *
 * Nothing is cached client-side. This is a page that may be open on a shared
 * school computer, and it must not outlive the session.
 */
export function GameLeaderboard({ slug }: { slug: string }) {
  const [boards, setBoards] = useState<GameBoard[] | null>(null);

  useEffect(() => {
    // `ignore` rather than an AbortController, matching `GameAchievements`: the
    // only thing that can change is `slug`, and the single failure worth
    // preventing is a stale response overwriting a newer one.
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/games/${encodeURIComponent(slug)}/leaderboard`,
        );
        if (!res.ok || ignore) return;
        const body = (await res.json()) as { boards?: GameBoardPayload[] };
        // Numbering and the empty-board filter live in the pure model, so what
        // this panel prints is under test — see `lib/scoreboard/game-board.ts`.
        if (!ignore) setBoards(buildGameBoards(body.boards ?? []));
      } catch {
        // Offline, or the API is down. Stay null — see the module docblock.
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug]);

  // Not loaded, no board, or a board nobody has played. Either way there is no
  // section — never an empty heading, never a spinner.
  if (!boards || boards.length === 0) return null;

  const named = shouldNameBoards(boards);

  return (
    <section className="mt-5 max-w-3xl rounded-3xl bg-white p-5 sm:p-6">
      {/* THE SCORE LABEL IS A COLUMN HEADING, NOT A ROW FIELD — the argument
          `FriendsBoard` makes, and it applies harder here: this panel is half as
          long again, so "Voltage" repeated down it would be fifteen readings of
          a word the reader took in once. With one board it sits beside the
          section heading; with several, beside each board's own. */}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-black tracking-tight text-zinc-900">Top players</h2>
        {!named && (
          <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-muted">
            {boards[0].scoreLabel}
          </span>
        )}
      </div>

      {boards.map((board) => (
        <div key={board.boardId} className="mt-4 first:mt-3">
          {named && (
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 truncate text-[11px] font-black uppercase tracking-wider text-muted">
                {board.title}
              </h3>
              <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-muted">
                {board.scoreLabel}
              </span>
            </div>
          )}
          <ol className="space-y-2">
            {board.rows.map((row) => (
              // The board id is in the key because two boards on one game can
              // hold the same handle at the same position, and the position is
              // in it because a tie means two rows legitimately share a number.
              <BoardRow
                key={`${board.boardId}:${row.position}:${row.handle}`}
                row={row}
                scoreLabel={board.scoreLabel}
              />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

/**
 * One place on the board: position, who, and what they scored.
 *
 * THE PODIUM IS THE NUMERAL, NOT THE ROW. Tinting the top row `bg-brand-50` was
 * the obvious move and is the wrong one: on this same page `FriendsBoard` already
 * uses that exact tint to mean "this row is you", and a colour that means two
 * things within one scroll means neither.
 *
 * The avatar is the one `FriendsBoard` renders, fallback included, so a verified
 * player looks the same in both panels. An anonymous submission has no avatar and
 * lands on the initial-letter fallback — which is honest: a guest handle is not a
 * person this site can vouch for, and drawing a placeholder face for one would
 * imply otherwise.
 */
function BoardRow({ row, scoreLabel }: { row: GameBoardRow; scoreLabel: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2">
      {/* "=1" on a tie. Two players holding the same score have no order between
          them, and numbering them 1 and 2 would render the invisible
          created_at/id tie-break as a result. */}
      <span
        className={`w-7 shrink-0 text-center text-[13px] font-black tabular-nums ${
          isPodium(row.position) ? "text-brand" : "text-muted"
        }`}
      >
        {row.tied ? "=" : ""}
        {row.position}
      </span>
      <Avatar person={{ image: row.avatar ?? null, displayName: row.handle }} size={28} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-zinc-700">
        {row.handle}
      </span>
      {/* `aria-label` carries the unit the column heading shows visually, so a
          screen reader hears "9,000 Voltage" on the row rather than a bare number
          whose heading is fifteen rows away. */}
      <span
        aria-label={`${row.score.toLocaleString()} ${scoreLabel}`}
        className="shrink-0 text-[13px] font-black tabular-nums text-zinc-900"
      >
        {row.score.toLocaleString()}
      </span>
    </li>
  );
}
