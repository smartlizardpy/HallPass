/**
 * BoardPass — who is a request playing as?
 *
 * THIS IS THE ONLY DOOR a board session has into the rest of the site, and it is
 * opt-in. `auth()` / `currentPlayerId()` know nothing about the board cookie, so
 * friends, invites, challenge creation, settings and admin all see a guest. Only
 * the routes that call {@link gameplayPlayerId} — scores and achievements — and
 * the read-only {@link peekBoard} used by `/api/v1/me` ever look.
 *
 * `gameplayPlayerId(slug)` answers "which player did the board choose for THIS
 * game?". It matches the session's active participant AND its active game slug,
 * so a score posted for game B cannot be credited to whoever was chosen for game
 * A. It also checks, in the same statement, that the session is live (idle + a
 * short grace so a game-over score isn't lost, and the absolute limit with no
 * grace), that the seat isn't revoked, and that the credential still exists at the
 * same `pin_version`.
 *
 * A credited write bumps idle expiry (bounded by the absolute limit) — but only
 * when the session hasn't already idled out, so a grace-window write can't
 * resurrect an expired session.
 *
 * The rollout mode is checked first: with BoardPass `off`, nothing resolves.
 */

import "server-only";
import { cookies } from "next/headers";
import { sql } from "@/app/lib/db";
import { GAMEPLAY_GRACE_SECONDS, GAME_IDLE_SECONDS } from "./config";
import { getBoardPassMode } from "./mode";
import { BOARDPASS_COOKIE, hashSessionToken, isWellFormedToken } from "./token";

/** The hash of the request's board cookie, or null if absent or malformed. */
export async function boardTokenHash(): Promise<string | null> {
  try {
    const token = (await cookies()).get(BOARDPASS_COOKIE)?.value;
    return isWellFormedToken(token) ? hashSessionToken(token) : null;
  } catch {
    return null;
  }
}

export async function gameplayPlayerId(gameSlug: string): Promise<string | null> {
  try {
    if ((await getBoardPassMode()) === "off") return null;
    const tokenHash = await boardTokenHash();
    if (!tokenHash) return null;
    const rows = (await sql`
      WITH hit AS (
        SELECT s.id AS sid, p.player_id, (s.idle_expires_at > now()) AS in_idle
        FROM boardpass_sessions s
        JOIN boardpass_participants p
          ON p.id = s.active_participant_id AND p.session_id = s.id AND p.revoked_at IS NULL
        JOIN boardpass_credentials c
          ON c.player_id = p.player_id AND c.pin_version = p.pin_version
        WHERE s.token_hash = ${tokenHash}
          AND s.ended_at IS NULL
          AND s.absolute_expires_at > now()
          AND s.idle_expires_at + make_interval(secs => ${GAMEPLAY_GRACE_SECONDS}::int) > now()
          AND s.active_game_slug = ${gameSlug}
      ),
      bump AS (
        UPDATE boardpass_sessions SET
          last_activity_at = now(),
          idle_expires_at = LEAST(absolute_expires_at,
            now() + make_interval(secs => ${GAME_IDLE_SECONDS}::int))
        WHERE id IN (SELECT sid FROM hit WHERE in_idle)
      )
      SELECT player_id FROM hit
    `) as { player_id: string }[];
    return rows[0]?.player_id ?? null;
  } catch (error) {
    // Same posture as `currentPlayerId`: a failure reads as "not signed in".
    console.error("boardpass gameplayPlayerId failed:", error);
    return null;
  }
}

export interface BoardPeek {
  /** A live board session exists in this browser. */
  board: boolean;
  /** The player chosen for the open game, if any. */
  active: { playerId: string; slug: string } | null;
}

/** Read-only variant for `/api/v1/me`: never extends the session. */
export async function peekBoard(): Promise<BoardPeek> {
  const none: BoardPeek = { board: false, active: null };
  try {
    if ((await getBoardPassMode()) === "off") return none;
    const tokenHash = await boardTokenHash();
    if (!tokenHash) return none;
    const rows = (await sql`
      SELECT s.active_game_slug, p.player_id, c.player_id AS credential_player
      FROM boardpass_sessions s
      LEFT JOIN boardpass_participants p
        ON p.id = s.active_participant_id AND p.session_id = s.id AND p.revoked_at IS NULL
      LEFT JOIN boardpass_credentials c
        ON c.player_id = p.player_id AND c.pin_version = p.pin_version
      WHERE s.token_hash = ${tokenHash}
        AND s.ended_at IS NULL
        AND s.absolute_expires_at > now() AND s.idle_expires_at > now()
    `) as {
      active_game_slug: string | null;
      player_id: string | null;
      credential_player: string | null;
    }[];
    if (rows.length === 0) return none;
    const r = rows[0];
    // `credential_player` is set only when the seat's pin_version still matches.
    return {
      board: true,
      active:
        r.player_id && r.credential_player && r.active_game_slug
          ? { playerId: r.player_id, slug: r.active_game_slug }
          : null,
    };
  } catch (error) {
    console.error("boardpass peekBoard failed:", error);
    return none;
  }
}
