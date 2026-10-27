/**
 * BoardPass — PIN credentials: status, set, disable, and the login guess counter.
 *
 * One row per player in `boardpass_credentials`; disabling DELETES it. Every
 * change that should cut people off bumps `pin_version` and revokes the player's
 * open board participants. The resolver ALSO joins on `pin_version`, so even a
 * revoke that failed half-way cannot leave a stale participant able to play.
 *
 * THE GUESS COUNTER IS RESERVED, NOT CHECKED. `reserveAccountAttempt` increments
 * the failure count and returns the hash in ONE statement, guarded by "not
 * locked". A check-then-verify-then-record flow would let 1000 parallel requests
 * all pass the lock check before any failure is written; here the 5th reserve
 * sets the lock and every later one gets no row, so parallelism buys at most five
 * guesses per lock. A success resets the counter (`recordSuccess`).
 *
 * Locks escalate 30 s, 1, 2, 4 … capped at 15 min, and a quiet account forgets its
 * failures after 24 h. A lock only ever affects BoardPass, never Google login.
 */

import "server-only";
import { sql } from "@/app/lib/db";
import {
  ACCOUNT_FAILURE_DECAY_SECONDS,
  ACCOUNT_LOCK_AFTER,
  ACCOUNT_LOCK_BASE_SECONDS,
  ACCOUNT_LOCK_MAX_SECONDS,
} from "./config";

export interface CredentialStatus {
  enabled: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export async function getCredentialStatus(playerId: string): Promise<CredentialStatus> {
  const rows = (await sql`
    SELECT created_at, last_used_at FROM boardpass_credentials WHERE player_id = ${playerId}
  `) as { created_at: string; last_used_at: string | null }[];
  const row = rows[0];
  return {
    enabled: Boolean(row),
    createdAt: row?.created_at ?? null,
    lastUsedAt: row?.last_used_at ?? null,
  };
}

/**
 * Create or replace a player's PIN. A replace bumps `pin_version`, clears the
 * guess counter, and revokes every board they are on.
 */
export async function setCredential(playerId: string, pinHash: string): Promise<void> {
  await sql`
    INSERT INTO boardpass_credentials (player_id, pin_hash)
    VALUES (${playerId}, ${pinHash})
    ON CONFLICT (player_id) DO UPDATE SET
      pin_hash = EXCLUDED.pin_hash,
      pin_version = boardpass_credentials.pin_version + 1,
      failed_count = 0, last_failed_at = NULL, locked_until = NULL,
      updated_at = now()
  `;
  await revokeParticipantsForPlayer(playerId);
}

/** Remove a player's PIN and every board seat they hold. */
export async function deleteCredential(playerId: string): Promise<void> {
  await sql`DELETE FROM boardpass_credentials WHERE player_id = ${playerId}`;
  await revokeParticipantsForPlayer(playerId);
}

export interface ReservedAttempt {
  playerId: string;
  pinHash: string;
  pinVersion: number;
}

/**
 * Take one guess against the account whose username this is. `null` covers every
 * way there is nothing to verify (no such username, no credential, locked) so the
 * caller cannot tell them apart.
 */
export async function reserveAccountAttempt(
  username: string,
): Promise<ReservedAttempt | null> {
  const decay = ACCOUNT_FAILURE_DECAY_SECONDS;
  const rows = (await sql`
    UPDATE boardpass_credentials SET
      failed_count = CASE
        WHEN last_failed_at IS NOT NULL AND last_failed_at < now() - make_interval(secs => ${decay}::int)
          THEN 1 ELSE failed_count + 1 END,
      last_failed_at = now(),
      locked_until = CASE
        WHEN (CASE
          WHEN last_failed_at IS NOT NULL AND last_failed_at < now() - make_interval(secs => ${decay}::int)
            THEN 1 ELSE failed_count + 1 END) >= ${ACCOUNT_LOCK_AFTER}::int
        THEN now() + make_interval(secs => LEAST(
          ${ACCOUNT_LOCK_MAX_SECONDS}::float8,
          ${ACCOUNT_LOCK_BASE_SECONDS}::float8 * power(2, LEAST(
            (CASE
              WHEN last_failed_at IS NOT NULL AND last_failed_at < now() - make_interval(secs => ${decay}::int)
                THEN 1 ELSE failed_count + 1 END) - ${ACCOUNT_LOCK_AFTER}::int, 6))))
        ELSE NULL END
    WHERE player_id = (SELECT id FROM players WHERE username = ${username})
      AND (locked_until IS NULL OR locked_until <= now())
    RETURNING player_id, pin_hash, pin_version
  `) as { player_id: string; pin_hash: string; pin_version: number }[];
  const row = rows[0];
  return row
    ? { playerId: row.player_id, pinHash: row.pin_hash, pinVersion: row.pin_version }
    : null;
}

/** The right PIN was entered: forget the failures. */
export async function recordSuccess(playerId: string): Promise<void> {
  await sql`
    UPDATE boardpass_credentials
    SET failed_count = 0, last_failed_at = NULL, locked_until = NULL, last_used_at = now()
    WHERE player_id = ${playerId}
  `;
}

/**
 * Revoke every open board seat a player holds, fixing each session's head-count
 * and clearing the active binding if it was theirs. One statement.
 */
export async function revokeParticipantsForPlayer(playerId: string): Promise<number> {
  const rows = (await sql`
    WITH r AS (
      UPDATE boardpass_participants SET revoked_at = now()
      WHERE player_id = ${playerId} AND revoked_at IS NULL
      RETURNING id, session_id
    ),
    per AS (SELECT session_id, count(*)::int AS n FROM r GROUP BY session_id)
    UPDATE boardpass_sessions s SET
      participant_count = GREATEST(s.participant_count - per.n, 0),
      active_game_slug = CASE WHEN s.active_participant_id IN (SELECT id FROM r)
        THEN NULL ELSE s.active_game_slug END,
      active_since = CASE WHEN s.active_participant_id IN (SELECT id FROM r)
        THEN NULL ELSE s.active_since END,
      active_participant_id = CASE WHEN s.active_participant_id IN (SELECT id FROM r)
        THEN NULL ELSE s.active_participant_id END
    FROM per WHERE s.id = per.session_id
    RETURNING s.id
  `) as { id: string }[];
  return rows.length;
}

/** How many live boards this player is currently signed in on. */
export async function countActiveBoards(playerId: string): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n
    FROM boardpass_participants p
    JOIN boardpass_sessions s ON s.id = p.session_id
    WHERE p.player_id = ${playerId} AND p.revoked_at IS NULL
      AND s.ended_at IS NULL AND s.absolute_expires_at > now()
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}
