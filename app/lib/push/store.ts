/**
 * HallPass — the push subscriptions store.
 *
 * A `createPushStore(sql)` factory like every other store here, so the module
 * stays free of `server-only` and `store.test.ts` can assert the SHAPE of each
 * statement against a fake tagged template.
 *
 * ── ONE STATEMENT PER MUTATION ─────────────────────────────────────────────
 * `neon()` is SQL-over-HTTP with no cross-statement transactions, so subscribing
 * and enforcing the device cap happen in a single statement. Two round trips
 * would leave a window where a player sat over the cap, and — worse — a failure
 * between them would leave it there permanently, since nothing revisits it.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { PUSH_DEVICE_CAP } from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/** One device to push to. */
export type PushDevice = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function createPushStore(sql: Sql) {
  return {
    /**
     * Register (or refresh) one device, and evict anything over the cap — in ONE
     * statement.
     *
     * ── THE OFF-BY-ONE THAT ISN'T ───────────────────────────────────────────
     * A data-modifying CTE's effects are NOT visible to sibling CTEs in the same
     * statement: `excess` reads the table as it was BEFORE the upsert, so it
     * cannot see the row being written. Rather than accept a transient cap+1,
     * the eviction excludes this endpoint and reserves its slot by offsetting
     * `CAP - 1`. That is exact in both cases:
     *
     *   new endpoint      — keeps CAP-1 others plus the new row      = CAP
     *   existing endpoint — keeps CAP-1 others plus the refreshed row = CAP
     *
     * Ordering is by `last_seen_at DESC`, so what goes is the LEAST RECENTLY
     * SEEN device and never simply the oldest: a phone used daily for two years
     * must outlive a Chromebook borrowed once last term.
     */
    async subscribe(input: {
      playerId: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }): Promise<void> {
      const { playerId, endpoint, p256dh, auth } = input;
      await sql`
        WITH up AS (
          INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth)
          VALUES (${endpoint}, ${playerId}, ${p256dh}, ${auth})
          ON CONFLICT (endpoint) DO UPDATE
            SET player_id    = EXCLUDED.player_id,
                p256dh       = EXCLUDED.p256dh,
                auth         = EXCLUDED.auth,
                last_seen_at = now()
          RETURNING endpoint
        ),
        excess AS (
          SELECT endpoint FROM push_subscriptions
           WHERE player_id = ${playerId}
             AND endpoint <> ${endpoint}
           ORDER BY last_seen_at DESC
           OFFSET ${Math.max(0, PUSH_DEVICE_CAP - 1)}
        )
        DELETE FROM push_subscriptions
         WHERE endpoint IN (SELECT endpoint FROM excess)
           AND EXISTS (SELECT 1 FROM up)
      `;
    },

    /**
     * Forget one device.
     *
     * Keyed on the endpoint AND the player, so a leaked endpoint cannot be used
     * to unsubscribe somebody else's device.
     */
    async unsubscribe(playerId: string, endpoint: string): Promise<boolean> {
      const rows = (await sql`
        DELETE FROM push_subscriptions
         WHERE endpoint = ${endpoint} AND player_id = ${playerId}
        RETURNING endpoint
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Delete a dead endpoint, whoever it belonged to.
     *
     * Called from the send path when a push service answers `404`/`410 Gone`.
     * NOT keyed by player, deliberately: the push service has told us this
     * endpoint no longer exists anywhere, and it is the same fact regardless of
     * whose row it is. This is the whole of the repo's subscription hygiene —
     * there is no cron to sweep with.
     */
    async removeDead(endpoint: string): Promise<void> {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
    },

    /** Every device this player has agreed to be notified on. */
    async devicesFor(playerId: string): Promise<PushDevice[]> {
      const rows = (await sql`
        SELECT endpoint, p256dh, auth
          FROM push_subscriptions
         WHERE player_id = ${playerId}
         ORDER BY last_seen_at DESC
      `) as Row[];
      return rows.map((row) => ({
        endpoint: String(row.endpoint),
        p256dh: String(row.p256dh),
        auth: String(row.auth),
      }));
    },
  };
}

export type PushStore = ReturnType<typeof createPushStore>;
