/**
 * HallPass — the notifications store.
 *
 * A `createNotificationStore(sql)` factory like every other store here, so the
 * module stays free of `server-only` and `store.test.ts` can assert the SHAPE of
 * each statement against a fake tagged template.
 *
 * ── ONE STATEMENT PER MUTATION ─────────────────────────────────────────────
 * `neon()` is SQL-over-HTTP with no cross-statement transactions, so inserting a
 * notification and enforcing its retention cap happen in a SINGLE statement —
 * the same bargain `push/store.ts` strikes for the device cap, and for the same
 * reason: two round trips leave a window over the cap, and a failure between
 * them leaves it there permanently, because nothing ever revisits it.
 *
 * ── SQL SAFETY ─────────────────────────────────────────────────────────────
 * The `neon()` tagged template parameterises interpolated VALUES; it does NOT
 * reliably splice raw SQL fragments. So no fragment variable is ever
 * interpolated. Where behaviour depends on a boolean — the two shapes of
 * {@link broadcastPushPlayerIds} — the branch happens in JS into explicit,
 * fully-written templates, exactly as `dashboard-users.ts` does for its
 * super-admin path.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  NOTIFICATIONS_KEEP_BROADCASTS,
  NOTIFICATIONS_KEEP_PER_PLAYER,
  type NotificationChannel,
} from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/** One stored notification, as the bell and the page read it. */
export type StoredNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  /** True for a site-wide row (`player_id IS NULL`). */
  isBroadcast: boolean;
};

/** A page of the inbox, plus the watermark that decides what is unread. */
export type InboxPage = {
  items: StoredNotification[];
  /**
   * When this player last opened their bell, or `null` if they never have.
   *
   * `null` means EVERYTHING is unread, which is the correct starting point: a
   * first bell should show what is waiting rather than an inbox that silently
   * marked itself read before it was ever looked at.
   */
  seenAt: string | null;
};

/** What a notification carries, before it is owned by anybody. */
export type NotificationInput = {
  kind: string;
  title: string;
  body: string;
  url: string;
  /**
   * Optional producer-supplied identity. When set, a second insert with the same
   * key is a no-op — marking a game New, un-marking it and marking it again is
   * ONE drop. `null` means "never deduped"; the unique index is PARTIAL, so
   * keyless rows are not indexed at all.
   */
  dedupeKey: string | null;
};

/** Coerce a driver timestamp to an ISO string, as `dashboard-users.ts` does. */
function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function mapNotification(row: Row): StoredNotification {
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    url: String(row.url),
    createdAt: toIso(row.created_at),
    isBroadcast: row.is_broadcast === true,
  };
}

export function createNotificationStore(sql: Sql) {
  return {
    /**
     * Write one personal notification, evicting past the retention cap — in ONE
     * statement. Resolves whether a row was actually written.
     *
     * ── THE OFF-BY-ONE THAT ISN'T ───────────────────────────────────────────
     * A data-modifying CTE's effects are NOT visible to sibling CTEs in the same
     * statement, so `excess` reads the table as it was BEFORE the insert and
     * cannot see the row being written. Rather than accept a transient cap+1,
     * the eviction reserves this row's slot by offsetting `KEEP - 1`: it keeps
     * `KEEP-1` older rows plus the new one, which is exactly `KEEP`. This is the
     * same correction `push/store.ts` makes for the device cap.
     *
     * ── WHY THE PRUNE IS GUARDED ON THE INSERT ──────────────────────────────
     * `AND EXISTS (SELECT 1 FROM ins)` means a DEDUPED call — one where
     * `ON CONFLICT DO NOTHING` wrote nothing — also evicts nothing. Without it,
     * a producer that re-fires a deduped event would quietly delete this
     * player's oldest notification each time, trading a row they might still
     * want to read for one that was never written.
     *
     * ── WHY THE ORDER CARRIES `id` AS WELL AS `created_at` ──────────────────
     * `now()` in Postgres is the TRANSACTION timestamp, not the statement's, so
     * any two rows written in one transaction carry the IDENTICAL `created_at`.
     * With `ORDER BY created_at DESC` alone those ties resolve arbitrarily, and
     * the eviction then drops arbitrary rows rather than the oldest — verified
     * against a real Postgres, where a batch of ten with a cap of three kept the
     * 10th, 2nd and 1st. `id` is a monotonic identity column, so appending it
     * makes the order total and the eviction exactly "oldest first".
     *
     * The HTTP driver gives each statement its own implicit transaction, so
     * production ties are unlikely rather than impossible — which is precisely
     * the kind of ordering bug that would surface later as "a notification
     * vanished" and be untraceable.
     *
     * ── WHY THE OUTER STATEMENT IS A SELECT ─────────────────────────────────
     * The caller needs to know whether the insert took, and the prune has to be
     * able to reference it — so neither the INSERT nor the DELETE can be the
     * primary query. Postgres runs a data-modifying CTE exactly once and to
     * completion whether or not the primary query reads it, so `pruned` still
     * happens; `count(*) FROM ins` is then just how the answer gets out.
     */
    async insertPersonal(
      input: NotificationInput & { playerId: string },
    ): Promise<boolean> {
      const { playerId, kind, title, body, url, dedupeKey } = input;
      const rows = (await sql`
        WITH ins AS (
          INSERT INTO notifications (player_id, kind, title, body, url, dedupe_key)
          VALUES (${playerId}, ${kind}, ${title}, ${body}, ${url}, ${dedupeKey})
          ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
          RETURNING id
        ),
        excess AS (
          SELECT id FROM notifications
           WHERE player_id = ${playerId}
           ORDER BY created_at DESC, id DESC
           OFFSET ${Math.max(0, NOTIFICATIONS_KEEP_PER_PLAYER - 1)}
        ),
        pruned AS (
          DELETE FROM notifications
           WHERE id IN (SELECT id FROM excess)
             AND EXISTS (SELECT 1 FROM ins)
          RETURNING id
        )
        SELECT count(*)::int AS inserted FROM ins
      `) as Row[];
      return Number(rows[0]?.inserted ?? 0) > 0;
    },

    /**
     * Write one site-wide notification (`player_id IS NULL`), capped the same
     * way. Resolves whether a row was actually written.
     *
     * Capped SEPARATELY from personal rows and against its own, much smaller
     * population: a broadcast is read by every signed-in player on every bell
     * poll, so the site-wide backlog is the one length that costs everybody.
     */
    async insertBroadcast(input: NotificationInput): Promise<boolean> {
      const { kind, title, body, url, dedupeKey } = input;
      const rows = (await sql`
        WITH ins AS (
          INSERT INTO notifications (player_id, kind, title, body, url, dedupe_key)
          VALUES (NULL, ${kind}, ${title}, ${body}, ${url}, ${dedupeKey})
          ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
          RETURNING id
        ),
        excess AS (
          SELECT id FROM notifications
           WHERE player_id IS NULL
           ORDER BY created_at DESC, id DESC
           OFFSET ${Math.max(0, NOTIFICATIONS_KEEP_BROADCASTS - 1)}
        ),
        pruned AS (
          DELETE FROM notifications
           WHERE id IN (SELECT id FROM excess)
             AND EXISTS (SELECT 1 FROM ins)
          RETURNING id
        )
        SELECT count(*)::int AS inserted FROM ins
      `) as Row[];
      return Number(rows[0]?.inserted ?? 0) > 0;
    },

    /**
     * This player's inbox: their own rows UNION every broadcast, newest first,
     * with the watermark that says which of them are unread.
     *
     * The watermark rides along as a SCALAR SUBQUERY rather than a join, so it
     * is evaluated once for the whole page and the statement stays a single
     * round trip. A player with no `notification_state` row yields `null`, which
     * `InboxPage.seenAt` documents as "everything is unread".
     *
     * Ordered by `id` as well as `created_at`, for the reason set out on
     * {@link insertPersonal}: `now()` is the transaction timestamp, so ties are
     * representable, and an inbox that reordered itself between two polls would
     * be the visible half of the same bug.
     *
     * NO PREFERENCE FILTERING HAPPENS HERE, deliberately. A broadcast row is
     * shared, so "does this player want it?" cannot be answered by the row — and
     * the answer depends on the DEFAULTS in `config.ts`, which are code. The
     * barrel filters, where the catalogue is in scope. See `index.ts`.
     */
    async listFor(playerId: string, limit: number): Promise<InboxPage> {
      const rows = (await sql`
        SELECT n.id,
               n.kind,
               n.title,
               n.body,
               n.url,
               n.created_at,
               (n.player_id IS NULL) AS is_broadcast,
               (SELECT seen_at FROM notification_state WHERE player_id = ${playerId})
                 AS seen_at
          FROM notifications n
         WHERE n.player_id = ${playerId} OR n.player_id IS NULL
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT ${limit}
      `) as Row[];

      return {
        items: rows.map(mapNotification),
        seenAt: rows[0]?.seen_at == null ? null : toIso(rows[0].seen_at),
      };
    },

    /**
     * Mark everything up to now as read.
     *
     * `now()` rather than the newest row's timestamp: a notification written
     * between the read that rendered the bell and this write is still something
     * the player has now had on screen, and stamping the older value would leave
     * a permanently unread row nobody can clear.
     */
    async markSeen(playerId: string): Promise<void> {
      await sql`
        INSERT INTO notification_state (player_id, seen_at)
        VALUES (${playerId}, now())
        ON CONFLICT (player_id) DO UPDATE SET seen_at = now()
      `;
    },

    /**
     * This player's stored deviations, as `kind -> channel`.
     *
     * SPARSE: a kind absent from the result has no opinion attached and takes
     * the catalogue default. The caller must resolve through
     * `config.resolveChannel` rather than treating a missing key as "off".
     */
    async prefsFor(playerId: string): Promise<Record<string, string>> {
      const rows = (await sql`
        SELECT kind, channel FROM notification_prefs WHERE player_id = ${playerId}
      `) as Row[];
      const prefs: Record<string, string> = {};
      for (const row of rows) prefs[String(row.kind)] = String(row.channel);
      return prefs;
    },

    /**
     * The stored channel for ONE kind across MANY players, as
     * `playerId -> channel`.
     *
     * Exists for the admin fan-out. A moderation event is delivered to every
     * admin, and asking {@link prefsFor} per admin would be one round trip each
     * on a path that runs behind somebody else's review being posted. This is
     * one statement whatever the roster size.
     *
     * SPARSE, exactly like `prefsFor`: a player absent from the result has no
     * opinion stored and takes the catalogue default. The caller must resolve
     * through `config.resolveChannel` rather than reading absence as "off".
     */
    async channelsForKind(
      playerIds: string[],
      kind: string,
    ): Promise<Record<string, string>> {
      if (playerIds.length === 0) return {};
      const rows = (await sql`
        SELECT player_id, channel
          FROM notification_prefs
         WHERE kind = ${kind}
           AND player_id = ANY(${playerIds}::text[])
      `) as Row[];
      const channels: Record<string, string> = {};
      for (const row of rows) channels[String(row.player_id)] = String(row.channel);
      return channels;
    },

    /**
     * Record one explicit choice.
     *
     * THE ROW IS WRITTEN EVEN WHEN THE CHOICE MATCHES TODAY'S DEFAULT, and that
     * is not an oversight. "Sparse" here means "not materialised for everybody
     * at signup", not "only values that differ". A player who deliberately
     * chooses the current default has expressed an intent, and deleting the row
     * to keep it tidy would silently re-opt them in the day somebody changes
     * that default in `config.ts`.
     */
    async setPref(
      playerId: string,
      kind: string,
      channel: NotificationChannel,
    ): Promise<void> {
      await sql`
        INSERT INTO notification_prefs (player_id, kind, channel)
        VALUES (${playerId}, ${kind}, ${channel})
        ON CONFLICT (player_id, kind) DO UPDATE
          SET channel = EXCLUDED.channel,
              updated_at = now()
      `;
    },

    /**
     * Which players should receive a BROADCAST kind as a push, restricted to
     * those who actually have a device subscribed.
     *
     * Two shapes, branched in JS into fully-written templates — never a spliced
     * fragment — because the question genuinely inverts on the kind's default:
     *
     *   default is NOT push — only an explicit `'push'` row opts you in. This is
     *     `game_drop` today: the whole point of its quiet default is that a
     *     site-wide push is something you ask for.
     *
     *   default IS push — everybody with a device is in EXCEPT those who stored
     *     something quieter. A missing row means no opinion, so it must not be
     *     read as opting out.
     *
     * Restricted to subscribed devices in the query rather than after it: the
     * unrestricted list is "every player who ever set a preference", and pushing
     * is the only thing this result is used for.
     */
    async broadcastPushPlayerIds(
      kind: string,
      defaultIsPush: boolean,
    ): Promise<string[]> {
      const rows = (
        defaultIsPush
          ? await sql`
              SELECT DISTINCT s.player_id
                FROM push_subscriptions s
                LEFT JOIN notification_prefs p
                  ON p.player_id = s.player_id AND p.kind = ${kind}
               WHERE p.channel IS NULL OR p.channel = 'push'
            `
          : await sql`
              SELECT DISTINCT s.player_id
                FROM push_subscriptions s
                JOIN notification_prefs p
                  ON p.player_id = s.player_id AND p.kind = ${kind}
               WHERE p.channel = 'push'
            `
      ) as Row[];
      return rows.map((row) => String(row.player_id));
    },
  };
}

export type NotificationStore = ReturnType<typeof createNotificationStore>;
