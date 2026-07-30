/**
 * HallPass — the player-flair store.
 *
 * A `createFlairStore(sql)` FACTORY, like `reviews/store.ts` and
 * `achievements/store.ts`: the fake-tagged-template seam is how the SHAPE of each
 * statement is asserted without a database. The live binding at the foot of the
 * file is what the dashboard and its server actions import.
 *
 * SQL SAFETY, carried from every other store: the `neon()` tagged template
 * parameterises interpolated VALUES and does NOT reliably splice SQL fragments.
 * Nothing here interpolates a fragment — only bound values (`playerId`, `label`,
 * `id`, ...).
 *
 * ONE STATEMENT PER MUTATION, forced by the driver: `neon()` is SQL-over-HTTP with
 * one stateless request per call, so there is no transaction to span two of them.
 * Every method below is a single statement.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { sql } from "@/app/lib/db";
import { publicDisplayName } from "@/app/lib/players";
import { mapFlairRow, type Flair, type FlairInput } from "@/app/lib/flair";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** The outcome of a grant attempt, decoded from the write's `RETURNING`. */
export type GrantOutcome =
  /** A new row was written. */
  | "granted"
  /** This player already holds a flair with that exact label — nothing changed. */
  | "duplicate";

/**
 * One flair grant as the dashboard lists it: the pill fields plus who holds it
 * and who granted it. Carries `username`/`displayName` — NOT `players.id` (the
 * Google subject) — so a revoke targets the row by its own id and no minor's
 * subject leaves the server.
 */
export type FlairGrant = Flair & {
  /** The holder's `@username`, or `null` if they have not claimed one. */
  username: string | null;
  /** The holder's public display name (handle, else `@username`, else "Player"). */
  displayName: string;
  /** The admin email recorded on the grant. */
  grantedBy: string;
  createdAt: string;
};

/**
 * How many grants the dashboard's "recently granted" table shows. A hard bound so
 * the page is a fixed size no matter how many grants accumulate; an admin looking
 * for an older one uses the profile, not this list.
 */
export const FLAIR_RECENT_LIMIT = 50;

export function createFlairStore(sqlClient: Sql) {
  return {
    /**
     * Grant `input` to `playerId`, recording the acting admin. Idempotent on
     * (player_id, label): a repeat grant of the same label is reported as a
     * `"duplicate"` rather than stacking a second identical pill. The caller has
     * already resolved and validated the player and the input, so a foreign-key
     * violation here is a genuine race (the player was deleted between resolve and
     * grant) and is left to surface as a store error the action turns into a
     * banner.
     */
    async grantFlair(
      playerId: string,
      input: FlairInput,
      grantedBy: string,
    ): Promise<GrantOutcome> {
      const rows = await sqlClient`
        INSERT INTO player_flair (player_id, label, icon, tone, granted_by)
        VALUES (${playerId}, ${input.label}, ${input.icon}, ${input.tone}, ${grantedBy})
        ON CONFLICT (player_id, label) DO NOTHING
        RETURNING id
      `;
      return rows.length > 0 ? "granted" : "duplicate";
    },

    /**
     * Revoke a grant by its own id. Returns `true` if a row was removed, `false`
     * for an unknown id (`RETURNING` distinguishes the two without a follow-up
     * read).
     */
    async revokeFlair(id: number): Promise<boolean> {
      const rows = await sqlClient`
        DELETE FROM player_flair WHERE id = ${id} RETURNING id
      `;
      return rows.length > 0;
    },

    /**
     * Every flair for one player, newest first — the profile read. Kept here as
     * well as inlined in the profile reader so a caller that already holds the
     * internal id (e.g. the account page) can reuse it.
     */
    async listFlairForPlayer(playerId: string): Promise<Flair[]> {
      const rows = await sqlClient`
        SELECT id, label, icon, tone
        FROM player_flair
        WHERE player_id = ${playerId}
        ORDER BY created_at DESC
      `;
      return rows.map(mapFlairRow);
    },

    /**
     * The most recently granted flair across all players, for the dashboard's
     * management table. Joined to `players` for a display name; `p.id` (the Google
     * subject) is NOT selected — the row's own id is the revoke handle.
     */
    async listRecentFlair(limit: number = FLAIR_RECENT_LIMIT): Promise<FlairGrant[]> {
      const rows: Row[] = await sqlClient`
        SELECT f.id, f.label, f.icon, f.tone, f.granted_by, f.created_at,
               p.username, p.handle
        FROM player_flair f
        JOIN players p ON p.id = f.player_id
        ORDER BY f.created_at DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => ({
        ...mapFlairRow(row),
        username: row.username == null ? null : String(row.username),
        displayName: publicDisplayName({
          handle: row.handle == null ? null : String(row.handle),
          username: row.username == null ? null : String(row.username),
        }),
        grantedBy: String(row.granted_by),
        createdAt: toIso(row.created_at),
      }));
    },
  };
}

export type FlairStore = ReturnType<typeof createFlairStore>;

/** The live store, bound to the shared Neon client. */
export const flair = createFlairStore(sql);
