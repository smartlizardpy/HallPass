import "server-only";

/**
 * HallPass — telling a challenger that somebody beat them.
 *
 * ── WHY THIS IS A MODULE AND NOT TWO CALL SITES ────────────────────────────
 * Challenges are resolved from TWO places now, and they are easy to forget
 * about separately:
 *
 *   1. `POST /api/v1/leaderboard/<board>` — the ordinary path, where a
 *      signed-in player posts a qualifying score.
 *   2. `POST /api/v1/me/claim` — the challenge-link path, where somebody played
 *      signed out, beat the score, and only then made an account.
 *
 * The second one is the whole point of challenge links, and it would be the
 * easy one to leave silent: everything still works, the challenge closes, and
 * the owner simply never learns that their link did its job. So the "tell them"
 * step lives next to the rule rather than being spelled out twice.
 *
 * ── IT NEVER THROWS AND NEVER BLOCKS THE OUTCOME ───────────────────────────
 * Both callers have already committed something the player cares about — a
 * score, or the transfer of one — by the time this runs. A notification is the
 * least important thing in either request, so every failure is swallowed after
 * logging. `notifyPlayer` is itself non-throwing; this is the brace to that
 * belt, because the copy builders and the game lookup are not.
 *
 * Awaited rather than fired into the void, matching the send path: on
 * serverless the response ending can end the invocation, and a floating promise
 * is cancelled often enough to make notifications look flaky rather than
 * broken.
 */

import { findGame } from "@/app/lib/games";
import { challengeBeatenCopy } from "@/app/lib/notifications/copy";
import { notifyPlayer } from "@/app/lib/notifications/deliver";
import type { ResolvedChallenge } from "./store";

/**
 * Notify the challenger behind each challenge this score just closed.
 *
 * `winnerName` is the DISPLAY name of whoever beat it — the sanitised handle
 * the score was posted under, never a Google name and never an id.
 */
export async function notifyChallengesBeaten(
  resolved: ResolvedChallenge[],
  winnerName: string,
): Promise<void> {
  for (const challenge of resolved) {
    try {
      await notifyPlayer(challenge.challengerId, {
        kind: "challenge_beaten",
        copy: challengeBeatenCopy({
          by: winnerName,
          // The DISPLAY TITLE, never the slug — `findGame` is the static
          // catalogue, so this is a lookup and not a round trip. An external
          // game is not in it and falls back to the board title.
          game: challenge.gameSlug
            ? (findGame(challenge.gameSlug)?.title ?? null)
            : null,
          boardTitle: challenge.boardTitle,
          targetScore: challenge.targetScore,
        }),
        // KEYED ON THE CHALLENGE, which can only resolve once — `resolveForScore`
        // filters on `resolved_at IS NULL`. So this is not really deduplicating
        // anything today; it is insurance against the day both resolution paths
        // race for the same row, where the alternative is telling somebody twice
        // that the same person beat the same score.
        //
        // Unlike `challenge_received`, which passes null on purpose because a
        // repeat there means a genuine new rematch.
        dedupeKey: `challenge_beaten:${challenge.id}`,
      });
    } catch (error) {
      console.error(
        `[challenges] notifying ${challenge.id} beaten failed:`,
        error,
      );
    }
  }
}
