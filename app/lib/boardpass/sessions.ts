/**
 * BoardPass — board sessions and who is in them.
 *
 * The Neon HTTP driver has no transactions, so every rule that spans rows is held
 * by a constraint or done inside ONE statement:
 *
 *   JOIN     `UPDATE boardpass_sessions SET participant_count = +1 … WHERE
 *            participant_count < 8 RETURNING id` takes the session row lock, so
 *            concurrent joins serialise on the counter, and the participant INSERT
 *            rides in the same statement. A duplicate trips the partial unique
 *            index (23505) and the increment rolls back with it.
 *   REMOVE   revoke + decrement + clear-the-active-binding in one CTE.
 *   EXPIRY   every read re-checks `ended_at`, `absolute_expires_at` and
 *            `idle_expires_at` against `now()`. An expired session never
 *            authenticates, whether or not any cleanup has run.
 *
 * A participant only counts while its credential still exists at the SAME
 * `pin_version`; changing or disabling a PIN therefore cuts a seat off even if the
 * explicit revoke never ran.
 *
 * WHAT A ROSTER SHOWS. A board is a shared screen: everyone in the room reads it.
 * So names come from `publicDisplayName` (handle → @username → "Player"), never
 * from the Google account name, which for most children is their real name. No
 * email, no Google id, no username unless it is the chosen handle's fallback.
 */

import "server-only";
import { randomUUID } from "node:crypto";
import { memeAvatarFor } from "@/app/lib/avatars";
import { sql } from "@/app/lib/db";
import { publicDisplayName } from "@/app/lib/players";
import {
  ABSOLUTE_SECONDS,
  CLEANUP_AFTER_SECONDS,
  GAME_IDLE_SECONDS,
  LOBBY_IDLE_SECONDS,
  MAX_PARTICIPANTS,
} from "./config";

export interface RosterEntry {
  /** The participant row id: what remove and pick-a-player take. Not a player id. */
  id: string;
  /** The player's public id, already on every public surface. */
  publicId: string;
  name: string;
  image: string;
}

export interface BoardSessionState {
  id: string;
  /** Server clock, so a skewed board clock can't mis-time the countdown. */
  now: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  participants: RosterEntry[];
  active: { participantId: string; slug: string } | null;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && (error as { code?: string }).code === "23505";
}

type StateRow = {
  id: string;
  now: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  active_participant_id: string | null;
  active_game_slug: string | null;
  pid: string | null;
  public_id: string | null;
  handle: string | null;
  username: string | null;
  avatar_meme: string | null;
  avatar_colour: string | null;
};

/**
 * The live session for a cookie hash, with its roster. Does NOT extend anything:
 * reading state must never keep a session alive. `null` when missing, ended or
 * expired.
 */
export async function getLiveSession(tokenHash: string): Promise<BoardSessionState | null> {
  const rows = (await sql`
    SELECT s.id, now() AS now, s.idle_expires_at, s.absolute_expires_at,
           s.active_participant_id, s.active_game_slug,
           p.id AS pid, pl.public_id, pl.handle, pl.username, pl.avatar_meme, pl.avatar_colour
    FROM boardpass_sessions s
    LEFT JOIN boardpass_participants p ON p.session_id = s.id AND p.revoked_at IS NULL
    LEFT JOIN boardpass_credentials c ON c.player_id = p.player_id AND c.pin_version = p.pin_version
    LEFT JOIN players pl ON pl.id = p.player_id
    WHERE s.token_hash = ${tokenHash}
      AND s.ended_at IS NULL
      AND s.absolute_expires_at > now()
      AND s.idle_expires_at > now()
      AND (p.id IS NULL OR c.player_id IS NOT NULL)
    ORDER BY p.joined_at, p.id
  `) as StateRow[];
  if (rows.length === 0) return null;
  const head = rows[0];
  const participants: RosterEntry[] = [];
  for (const r of rows) {
    if (!r.pid || !r.public_id) continue;
    participants.push({
      id: r.pid,
      publicId: String(r.public_id),
      name: publicDisplayName({ handle: r.handle, username: r.username }),
      image: memeAvatarFor(String(r.public_id), { meme: r.avatar_meme, colour: r.avatar_colour }),
    });
  }
  const activeStillHere = participants.some((p) => p.id === head.active_participant_id);
  return {
    id: head.id,
    now: new Date(head.now).toISOString(),
    idleExpiresAt: new Date(head.idle_expires_at).toISOString(),
    absoluteExpiresAt: new Date(head.absolute_expires_at).toISOString(),
    participants,
    active:
      activeStillHere && head.active_participant_id && head.active_game_slug
        ? { participantId: head.active_participant_id, slug: head.active_game_slug }
        : null,
  };
}

/** Start a session with its first player. One statement. */
export async function createSession(input: {
  tokenHash: string;
  playerId: string;
  pinVersion: number;
}): Promise<{ sessionId: string; participantId: string }> {
  const sessionId = randomUUID();
  const participantId = randomUUID();
  await sql`
    WITH s AS (
      INSERT INTO boardpass_sessions
        (id, token_hash, idle_expires_at, absolute_expires_at, participant_count)
      VALUES (
        ${sessionId}, ${input.tokenHash},
        now() + make_interval(secs => ${LOBBY_IDLE_SECONDS}::int),
        now() + make_interval(secs => ${ABSOLUTE_SECONDS}::int),
        1
      )
      RETURNING id
    )
    INSERT INTO boardpass_participants (id, session_id, player_id, pin_version)
    SELECT ${participantId}, s.id, ${input.playerId}, ${input.pinVersion} FROM s
  `;
  return { sessionId, participantId };
}

export type JoinResult =
  | { ok: true; participantId: string }
  | { ok: false; reason: "duplicate" | "full" | "gone" };

/** Add a player to a live session, enforcing the cap and no-duplicates. */
export async function joinSession(input: {
  tokenHash: string;
  playerId: string;
  pinVersion: number;
}): Promise<JoinResult> {
  const participantId = randomUUID();
  try {
    const rows = (await sql`
      WITH slot AS (
        UPDATE boardpass_sessions SET
          participant_count = participant_count + 1,
          last_activity_at = now(),
          idle_expires_at = LEAST(absolute_expires_at,
            now() + make_interval(secs => ${LOBBY_IDLE_SECONDS}::int))
        WHERE token_hash = ${input.tokenHash}
          AND ended_at IS NULL
          AND absolute_expires_at > now()
          AND idle_expires_at > now()
          AND participant_count < ${MAX_PARTICIPANTS}::int
        RETURNING id
      )
      INSERT INTO boardpass_participants (id, session_id, player_id, pin_version)
      SELECT ${participantId}, slot.id, ${input.playerId}, ${input.pinVersion} FROM slot
      RETURNING id
    `) as { id: string }[];
    if (rows.length > 0) return { ok: true, participantId };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
  // Zero rows: full, or the session is gone. Told apart for the message only.
  const live = await getLiveSession(input.tokenHash);
  return { ok: false, reason: live ? "full" : "gone" };
}

/** Revoke one seat in THIS session. `false` if it wasn't there to remove. */
export async function removeParticipant(
  tokenHash: string,
  participantId: string,
): Promise<boolean> {
  const rows = (await sql`
    WITH s AS (
      SELECT id FROM boardpass_sessions
      WHERE token_hash = ${tokenHash} AND ended_at IS NULL
        AND absolute_expires_at > now() AND idle_expires_at > now()
    ),
    r AS (
      UPDATE boardpass_participants SET revoked_at = now()
      WHERE id = ${participantId} AND revoked_at IS NULL
        AND session_id IN (SELECT id FROM s)
      RETURNING id, session_id
    )
    UPDATE boardpass_sessions x SET
      participant_count = GREATEST(x.participant_count - 1, 0),
      active_game_slug = CASE WHEN x.active_participant_id = ${participantId}
        THEN NULL ELSE x.active_game_slug END,
      active_since = CASE WHEN x.active_participant_id = ${participantId}
        THEN NULL ELSE x.active_since END,
      active_participant_id = CASE WHEN x.active_participant_id = ${participantId}
        THEN NULL ELSE x.active_participant_id END
    FROM r WHERE x.id = r.session_id
    RETURNING x.id
  `) as { id: string }[];
  return rows.length > 0;
}

/** End the whole session and revoke every seat. Idempotent. */
export async function endSession(tokenHash: string): Promise<void> {
  await sql`
    WITH s AS (
      UPDATE boardpass_sessions SET
        ended_at = COALESCE(ended_at, now()),
        active_participant_id = NULL, active_game_slug = NULL, active_since = NULL
      WHERE token_hash = ${tokenHash}
      RETURNING id
    )
    UPDATE boardpass_participants SET revoked_at = now()
    WHERE session_id IN (SELECT id FROM s) AND revoked_at IS NULL
  `;
}

/**
 * "Keep Playing": push idle expiry out, never past the absolute limit. Only a
 * deliberate tap reaches this; background requests never do. `null` if the
 * session is already gone.
 */
export async function touchSession(
  tokenHash: string,
): Promise<{ idleExpiresAt: string; absoluteExpiresAt: string } | null> {
  const rows = (await sql`
    UPDATE boardpass_sessions SET
      last_activity_at = now(),
      idle_expires_at = LEAST(absolute_expires_at, now() + make_interval(
        secs => CASE WHEN active_game_slug IS NULL
          THEN ${LOBBY_IDLE_SECONDS}::int ELSE ${GAME_IDLE_SECONDS}::int END))
    WHERE token_hash = ${tokenHash} AND ended_at IS NULL
      AND absolute_expires_at > now() AND idle_expires_at > now()
    RETURNING idle_expires_at, absolute_expires_at
  `) as { idle_expires_at: string; absolute_expires_at: string }[];
  const row = rows[0];
  return row
    ? {
        idleExpiresAt: new Date(row.idle_expires_at).toISOString(),
        absoluteExpiresAt: new Date(row.absolute_expires_at).toISOString(),
      }
    : null;
}

export type BindResult =
  | { ok: true; playerId: string }
  | { ok: false; reason: "gone" | "busy" };

/**
 * Choose who is playing `slug`. Refuses (`busy`) if a DIFFERENT player or game is
 * already bound: switching takes an explicit clear first, which the lobby does
 * when a game closes. That stops a stray call mid-game from swapping who gets
 * the credit. Re-binding the same player and game is allowed (idempotent).
 */
export async function bindActive(input: {
  tokenHash: string;
  participantId: string;
  slug: string;
}): Promise<BindResult> {
  const rows = (await sql`
    UPDATE boardpass_sessions s SET
      active_participant_id = pp.id,
      active_game_slug = ${input.slug},
      active_since = COALESCE(
        CASE WHEN s.active_participant_id = pp.id AND s.active_game_slug = ${input.slug}
          THEN s.active_since END, now()),
      last_activity_at = now(),
      idle_expires_at = LEAST(s.absolute_expires_at,
        now() + make_interval(secs => ${GAME_IDLE_SECONDS}::int))
    FROM (
      SELECT p.id, p.player_id, p.session_id
      FROM boardpass_participants p
      JOIN boardpass_credentials c ON c.player_id = p.player_id AND c.pin_version = p.pin_version
      WHERE p.id = ${input.participantId} AND p.revoked_at IS NULL
    ) pp
    WHERE s.id = pp.session_id
      AND s.token_hash = ${input.tokenHash}
      AND s.ended_at IS NULL AND s.absolute_expires_at > now() AND s.idle_expires_at > now()
      AND (s.active_participant_id IS NULL
           OR (s.active_participant_id = pp.id AND s.active_game_slug = ${input.slug}))
    RETURNING pp.player_id
  `) as { player_id: string }[];
  if (rows.length > 0) return { ok: true, playerId: rows[0].player_id };
  const live = await getLiveSession(input.tokenHash);
  if (!live) return { ok: false, reason: "gone" };
  const known = live.participants.some((p) => p.id === input.participantId);
  return { ok: false, reason: known ? "busy" : "gone" };
}

/** The game closed: nobody is "playing" any more. */
export async function clearActive(tokenHash: string): Promise<void> {
  await sql`
    UPDATE boardpass_sessions SET
      active_participant_id = NULL, active_game_slug = NULL, active_since = NULL,
      idle_expires_at = LEAST(absolute_expires_at, now() + make_interval(secs => ${LOBBY_IDLE_SECONDS}::int))
    WHERE token_hash = ${tokenHash} AND ended_at IS NULL
      AND absolute_expires_at > now() AND idle_expires_at > now()
  `;
}

/** Delete long-dead sessions (participants cascade). Opportunistic, on login. */
export async function cleanupSessions(): Promise<void> {
  await sql`
    DELETE FROM boardpass_sessions
    WHERE absolute_expires_at < now() - make_interval(secs => ${CLEANUP_AFTER_SECONDS}::int)
  `;
}
