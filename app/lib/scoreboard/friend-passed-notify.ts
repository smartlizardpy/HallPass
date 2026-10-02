import "server-only";

/**
 * HallPass — telling a friend that somebody passed their score.
 *
 * The passive sibling of `challenges/notify.ts`: that one fires when somebody
 * beats a score they were DARED to beat, this one when a friend simply passes
 * yours. Called from `POST /api/v1/leaderboard/<board>` after the score is
 * stored, signed-in players only.
 *
 * ── IT NEVER THROWS AND NEVER BLOCKS THE SCORE ─────────────────────────────
 * The caller has already committed the score. Everything here, including the
 * query that finds who was passed, is swallowed after logging — a notification is
 * the least important thing in that request.
 *
 * ── IT DOES NOT TELL THE SAME PERSON TWICE FOR ONE SCORE ───────────────────
 * A friend who dared this player to beat that very score has just been told
 * `challenge_beaten` for the same overtake. `skipPlayerIds` carries those
 * challengers so one overtake is one notification, not two.
 *
 * ── A STAGED GAME IS NEVER NAMED ───────────────────────────────────────────
 * A staged game's existence is visible only to testers. The recipient may not be
 * one, so a board linked to a game the PUBLIC resolver cannot find notifies
 * nobody. `resolveGame` is public-only — it returns `null` for a staged game, and
 * for one it cannot verify during an outage — so that single lookup is both the
 * title and the fail-closed gate, and this module needs none of the including-
 * staged APIs that `staged-allowlist.test.ts` guards (the same choice
 * `challenges/notify.ts` makes).
 */

import { resolveGame } from "@/app/lib/games-store";
import { friendPassedCopy } from "@/app/lib/notifications/copy";
import { notifyPlayer } from "@/app/lib/notifications/deliver";
import { store } from "@/app/lib/scoreboard";
import { friendPassedDedupeKey } from "./friend-passed";

export async function notifyFriendsPassed(input: {
  playerId: string;
  /** The display name the score was posted under — never a Google name or an id. */
  passerName: string;
  board: {
    id: string;
    gameSlug: string | null;
    title: string;
    sort: "asc" | "desc";
  };
  score: number;
  /** The id of the score row just written, so the previous best excludes it. */
  scoreId: number;
  /** Players already told about this same submit (challengers just notified). */
  skipPlayerIds: string[];
}): Promise<void> {
  try {
    const { playerId, board } = input;
    const passed = await store.getFriendsNewlyPassed(
      playerId,
      board.id,
      input.score,
      input.scoreId,
      board.sort,
    );
    // The common case — nobody newly passed — costs exactly that one statement.
    if (passed.length === 0) return;

    // The DISPLAY TITLE, through the public resolver, once for the whole batch.
    // A linked game it cannot resolve is staged or unverifiable: say nothing.
    let game: string | null = null;
    if (board.gameSlug) {
      game = (await resolveGame(board.gameSlug))?.title ?? null;
      if (game === null) return;
    }

    const skip = new Set(input.skipPlayerIds);

    for (const friend of passed) {
      if (skip.has(friend.playerId)) continue;
      await notifyPlayer(friend.playerId, {
        kind: "friend_passed",
        copy: friendPassedCopy({
          by: input.passerName,
          game,
          boardTitle: board.title,
          targetScore: friend.best,
        }),
        dedupeKey: friendPassedDedupeKey({
          boardId: board.id,
          passerId: playerId,
          passedBest: friend.best,
        }),
      });
    }
  } catch (error) {
    console.error(`[scoreboard] notifying friends passed on ${input.board.id} failed:`, error);
  }
}
