import "server-only";

/**
 * HallPass — "which board is this challenge for?", answered once.
 *
 * Both challenge write paths take either an explicit `board` or a `game` and
 * have to end up with a board id: `POST /api/v1/me/challenges` (send one to a
 * friend) and `POST /api/v1/me/challenges/link` (mint a share link). The rule
 * is small but it is a RULE — "several boards is a refusal, not a guess" — and
 * two copies of it is how one surface comes to pick a board the other would
 * have declined to.
 *
 * BOARDS ARE DECOUPLED FROM GAMES (`001_decouple_boards.sql`): `game_slug` is
 * nullable and one game may own several boards. So a game name is an
 * ABBREVIATION for a board, valid only when it is unambiguous, and the
 * ambiguous case is a question only the game itself can answer — which is why
 * it refuses rather than picking the first one.
 *
 * STAGED GAMES ARE REFUSED FOR EVERYONE, TESTERS INCLUDED. A challenge or share
 * link is handed to somebody else — a recipient or whoever holds the link — who
 * may not be a beta tester, so a board on a staged (beta-only) game cannot carry
 * one however privileged the sender is. The check uses the PUBLIC resolver: a
 * board whose linked game is not in the public catalogue (staged, or unknown, or
 * removed) answers `no-board`, the same as a board that does not exist. That
 * fails closed — if the catalogue read degrades, a challenge is refused rather
 * than a staged title leaking. A standalone board (no game) is unaffected.
 */

import { resolveGame } from "@/app/lib/games-store";
import { store } from "@/app/lib/scoreboard";
import type { ChallengeReason } from "./config";

export type BoardResolution = { boardId: string } | { reason: ChallengeReason };

/**
 * An explicit `board` wins. Otherwise the game's boards are looked up: exactly
 * one is unambiguous, none means the game has no leaderboard to challenge on,
 * and several is a refusal.
 */
export async function resolveChallengeBoard(
  body: Record<string, unknown>,
): Promise<BoardResolution> {
  const board = typeof body.board === "string" ? body.board.trim() : "";
  if (board) return (await publicBoardOnly(board)) ?? { boardId: board };

  const game = typeof body.game === "string" ? body.game.trim() : "";
  if (!game) return { reason: "bad-request" };

  const boards = await store.listBoardsForGame(game);
  if (boards.length === 0) return { reason: "no-board" };
  if (boards.length > 1) return { reason: "bad-request" };
  // `BoardConfig.slug` IS `boards.id` — the field kept its name from before
  // `001_decouple_boards.sql` split a board's identity from its game's slug.
  return (await publicBoardOnly(boards[0].slug)) ?? { boardId: boards[0].slug };
}

/**
 * `{ reason: "no-board" }` when the board is linked to a game the public cannot
 * see, else `null` (carry on). A board that does not exist is left to the caller,
 * whose own statement already reports it.
 */
async function publicBoardOnly(boardId: string): Promise<BoardResolution | null> {
  const board = await store.getBoard(boardId);
  if (board?.gameSlug && !(await resolveGame(board.gameSlug))) {
    return { reason: "no-board" };
  }
  return null;
}
