/**
 * BoardPass — counts for the dashboard. Aggregates only: no username, player id
 * or session id leaves this module.
 */

import "server-only";
import { sql } from "@/app/lib/db";

export interface BoardPassStats {
  credentials: number;
  liveSessions: number;
  livePlayers: number;
  /** Wrong-PIN attempts recorded on accounts in the last 24 hours. */
  recentFailures: number;
  lockedAccounts: number;
}

export async function getBoardPassStats(): Promise<BoardPassStats> {
  const rows = (await sql`
    SELECT
      (SELECT count(*) FROM boardpass_credentials)::int AS credentials,
      (SELECT count(*) FROM boardpass_sessions
         WHERE ended_at IS NULL AND idle_expires_at > now() AND absolute_expires_at > now())::int AS live_sessions,
      (SELECT count(*) FROM boardpass_participants p
         JOIN boardpass_sessions s ON s.id = p.session_id
         WHERE p.revoked_at IS NULL AND s.ended_at IS NULL
           AND s.idle_expires_at > now() AND s.absolute_expires_at > now())::int AS live_players,
      (SELECT coalesce(sum(failed_count), 0) FROM boardpass_credentials
         WHERE last_failed_at > now() - interval '24 hours')::int AS recent_failures,
      (SELECT count(*) FROM boardpass_credentials WHERE locked_until > now())::int AS locked
  `) as {
    credentials: number; live_sessions: number; live_players: number;
    recent_failures: number; locked: number;
  }[];
  const r = rows[0];
  return {
    credentials: r?.credentials ?? 0,
    liveSessions: r?.live_sessions ?? 0,
    livePlayers: r?.live_players ?? 0,
    recentFailures: r?.recent_failures ?? 0,
    lockedAccounts: r?.locked ?? 0,
  };
}
