"use client";

import { useEffect, useState } from "react";
import {
  buildGameBoards,
  isPodium,
  shouldNameBoards,
  type GameBoardPayload,
  type GameBoardRow,
} from "../lib/scoreboard/game-board";
import type { MeResponse } from "@/sdk/src/contract";
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
 * ── TWO FETCHES, AND WHY THAT IS THE POINT ─────────────────────────────────
 *
 * The board comes from a shared, CDN-cached endpoint whose body is identical for
 * everybody; who the reader is comes from `/api/v1/me`, which is `no-store` and
 * credentialed. Joining them HERE is what lets the reader's own row be
 * highlighted without the board itself becoming per-viewer — the trick
 * `/api/v1/games/[slug]/reviews` documents for its "did I vote" flag.
 *
 * The identity fetch is deliberately not awaited before the board renders: the
 * rows are the same either way, so the panel paints as soon as it has them and
 * the highlight lands when the second response does.
 *
 * A reader who is signed out, or whose identity call fails, gets the board with
 * nothing highlighted — the guest view, which is a complete and correct panel
 * rather than a degraded one.
 *
 * ── WHAT IT SHOWS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 *
 * The top of the board, as far down as the endpoint serves it (`GAME_BOARD_ROWS`
 * in `lib/scoreboard/config.ts`), with the reader's own row marked when they are
 * on it. NOT their standing when they are NOT on it: that is `FriendsBoard`'s
 * job directly above, which already prints the viewer's rank on the whole board
 * beside their friends.
 *
 * Names here are PUBLIC names — chosen handle, else `@username`, else a stable
 * generated name like `AuraFarmer#0417` — resolved in `getTopScores`, which does not
 * select the Google account name at all. A leaderboard is the most public surface
 * this site has and a real name must never reach it. The friends panel above
 * publishes the same name for the same player, deliberately; see
 * `lib/scoreboard/display-name.ts`.
 *
 * Nothing is cached client-side. This is a page that may be open on a shared
 * school computer, and it must not outlive the session.
 */
export function GameLeaderboard({ slug }: { slug: string }) {
  const [payloads, setPayloads] = useState<GameBoardPayload[] | null>(null);
  /** The reader's own `public_id`, or null until known / when signed out. */
  const [viewerId, setViewerId] = useState<string | null>(null);

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
        if (!ignore) setPayloads(body.boards ?? []);
      } catch {
        // Offline, or the API is down. Stay null — see the module docblock.
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug]);

  /**
   * Who the reader is. Its OWN effect with an empty dependency list, not folded
   * into the one above: the answer does not change when the visitor moves between
   * game pages, so re-fetching it per slug would be a credentialed round trip
   * bought for nothing. `credentials: "include"` is what makes the session cookie
   * ride along, as every other `/api/v1/me` caller in this repo does it.
   */
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/me", { credentials: "include" });
        if (!res.ok || ignore) return;
        const body = (await res.json()) as MeResponse;
        if (!ignore) setViewerId(body.publicId ?? null);
      } catch {
        // Signed out, offline, or the endpoint is down: no highlight, which is
        // the guest view and a complete panel in its own right.
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // Numbering, the empty-board filter and the "is this row me" match all live in
  // the pure model, so what this panel prints is under test — see
  // `lib/scoreboard/game-board.ts`. Derived rather than stored, so the highlight
  // appears the moment the identity lands without the rows being refetched.
  const boards = payloads === null ? null : buildGameBoards(payloads, viewerId);

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
            {board.rows.map((row, index) => (
              // KEYED BY INDEX WITHIN THE BOARD, which is the honest key here:
              // nothing on a row is unique. Two verified players may share a
              // display handle, a tie means two rows legitimately share a
              // position, and the wire carries no player id (the body is
              // identity-free on purpose — see the route's docblock). The list is
              // replaced wholesale by one fetch and never reordered in place, so
              // an index key cannot mis-associate state; the board id prefixes it
              // because a game may render several boards at once.
              <BoardRow
                key={`${board.boardId}:${index}`}
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
 * THE PODIUM IS THE NUMERAL, THE READER IS THE ROW. `bg-brand-50` means "this row
 * is you" in `FriendsBoard` directly above, so it means exactly that here and
 * nothing else; a tint that meant "first place" in one panel and "you" in the one
 * above it would mean neither. First, second and third are told apart by a
 * brand-coloured numeral instead, which survives being the reader's row too — the
 * two facts are independent and a reader in first place is owed both.
 *
 * The "You" tag is not decoration on top of the tint: on a board of fifteen
 * strangers the tint alone is a colour difference, and colour alone is not an
 * accessible way to carry meaning. `FriendsBoard` prints the same word for the
 * same reason.
 *
 * The avatar is the one `FriendsBoard` renders, fallback included, so a player
 * looks the same in both panels. An anonymous submission has no avatar and lands
 * on the initial-letter fallback — which is honest: a guest handle is not a person
 * this site can vouch for, and drawing a placeholder face for one would imply
 * otherwise.
 */
function BoardRow({ row, scoreLabel }: { row: GameBoardRow; scoreLabel: string }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${
        row.isYou ? "bg-brand-50" : "bg-surface-2"
      }`}
    >
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
        {row.isYou && (
          <span className="ml-1.5 text-[11px] font-black uppercase tracking-wide text-brand">
            You
          </span>
        )}
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
