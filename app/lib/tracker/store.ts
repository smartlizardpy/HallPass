/**
 * HallPass — the project tracker store.
 *
 * A `createTrackerStore(sql)` factory, like `reviews/store.ts`, `beta/store.ts`
 * and `social/store.ts`: the factory takes the tagged-template function so the
 * whole module stays free of `server-only` and the fake-tagged-template seam in
 * `store.test.ts` can assert the SHAPE of every statement without a database.
 *
 * ── ONE STATEMENT PER MUTATION, forced by the driver ───────────────────────
 * `neon()` is SQL-over-HTTP: one stateless request per tagged-template call, so
 * a `BEGIN` in one call and a `COMMIT` in another are not the same transaction.
 * "Update the item, then log the event" written as two `await`s has a real
 * window where the first succeeded and the second did not, and the activity
 * trail quietly loses entries — the exact failure an audit trail exists to
 * prevent. So every mutation here is a single multi-CTE statement that changes
 * the row AND writes its event, and `store.test.ts` asserts the call count.
 *
 * ── THE EMPTY RESULT SET IS THE OUTCOME CODE ──────────────────────────────
 * Each mutation's `prev` CTE selects the row under its guards (exists, not
 * archived). Everything downstream joins against it, so a guard that fails
 * yields zero rows end to end and the mutation returns `null`. That is how a
 * server action tells "no such item" from "it worked" without a second round
 * trip — the same decode-from-one-statement idiom `reviews/store.ts` uses.
 *
 * ── SQL SAFETY ────────────────────────────────────────────────────────────
 * The `neon()` tagged template parameterises VALUES only and does not reliably
 * splice fragments. Nothing here interpolates a fragment. In particular the
 * board's tag filter is NOT a dynamic `WHERE`: `listBoard()` reads every
 * non-archived item once and the page filters in JS. At this table's realistic
 * size — tens to low hundreds of rows — that is one round trip instead of a
 * combinatorial set of hand-written templates, and that, not a performance
 * claim, is the honest reason.
 *
 * ── WHY TAG LISTS CROSS THE BOUNDARY AS COMMA-JOINED TEXT ─────────────────
 * Both directions use `string_agg` / `string_to_array` rather than binding a
 * JS array to a `text[]` parameter. Tags are already normalised to
 * `[a-z0-9-]` by `parseTags()`, so a comma-joined string is unambiguous, and it
 * keeps every bound parameter a plain scalar — no dependence on how the HTTP
 * driver serialises arrays, and no array-literal escaping to get wrong.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { TERMINAL_STATUSES, type TrackerStatus } from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/**
 * `BIGINT` arrives from the HTTP driver as a string (the int8 parser leaves it
 * one so 2^53 cannot silently round). Every id and count goes through here.
 */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  return value == null ? null : toIso(value);
}

/** Split the `string_agg` of an item's tags back into a list. */
function toTags(value: unknown): string[] {
  const raw = value == null ? "" : String(value);
  return raw ? raw.split(",").filter(Boolean) : [];
}

/** A row as the board renders it. Deliberately carries NO `brief` — see `listBoard`. */
export type TrackerCard = {
  id: number;
  title: string;
  status: TrackerStatus;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** How many progress notes the item carries; drives the "3 updates" hint. */
  updateCount: number;
  /** When the most recent note was written, or `null` if there are none. */
  lastUpdateAt: string | null;
};

/** The full item, as the detail page renders it. */
export type TrackerItem = TrackerCard & {
  brief: string;
  startedAt: string | null;
  doneAt: string | null;
  archivedAt: string | null;
  ghRepo: string | null;
  ghIssueNumber: number | null;
};

export type TrackerUpdate = {
  id: number;
  authorEmail: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
};

export type TrackerEvent = {
  id: number;
  actorEmail: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
};

export function createTrackerStore(sql: Sql) {
  function mapCard(row: Row): TrackerCard {
    return {
      id: toInt(row.id),
      title: String(row.title),
      status: String(row.status) as TrackerStatus,
      tags: toTags(row.tags),
      createdBy: String(row.created_by),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      updateCount: toInt(row.update_count),
      lastUpdateAt: toIsoOrNull(row.last_update_at),
    };
  }

  function mapItem(row: Row): TrackerItem {
    return {
      ...mapCard(row),
      brief: String(row.brief ?? ""),
      startedAt: toIsoOrNull(row.started_at),
      doneAt: toIsoOrNull(row.done_at),
      archivedAt: toIsoOrNull(row.archived_at),
      ghRepo: row.gh_repo == null ? null : String(row.gh_repo),
      ghIssueNumber:
        row.gh_issue_number == null ? null : toInt(row.gh_issue_number),
    };
  }

  /** Comma-join a tag list for the SQL boundary; `""` means "no tags". */
  function csv(tags: readonly string[]): string {
    return tags.join(",");
  }

  return {
    /**
     * Every non-archived item, with its tags and update counts, in one query.
     *
     * `brief` IS DELIBERATELY NOT SELECTED. It is capped at 20 000 characters,
     * and the board shows a hundred cards none of which render it — selecting it
     * would pull megabytes over the wire to display nothing. The detail page
     * fetches it for the one item being read.
     *
     * Tags come back as a `string_agg` rather than a join fan-out, so one item
     * is one row and the caller does not have to regroup.
     */
    async listBoard(): Promise<TrackerCard[]> {
      const rows = (await sql`
        SELECT i.id,
               i.title,
               i.status,
               i.created_by,
               i.created_at,
               i.updated_at,
               (SELECT string_agg(t.tag, ',' ORDER BY t.tag)
                  FROM tracker_item_tags t WHERE t.item_id = i.id) AS tags,
               (SELECT count(*) FROM tracker_updates u WHERE u.item_id = i.id) AS update_count,
               (SELECT max(u.created_at) FROM tracker_updates u WHERE u.item_id = i.id) AS last_update_at
          FROM tracker_items i
         WHERE i.archived_at IS NULL
         ORDER BY i.position, i.id DESC
      `) as Row[];
      return rows.map(mapCard);
    },

    /** One item in full, archived or not. `null` when it does not exist. */
    async getItem(id: number): Promise<TrackerItem | null> {
      const rows = (await sql`
        SELECT i.id,
               i.title,
               i.brief,
               i.status,
               i.created_by,
               i.created_at,
               i.updated_at,
               i.started_at,
               i.done_at,
               i.archived_at,
               i.gh_repo,
               i.gh_issue_number,
               (SELECT string_agg(t.tag, ',' ORDER BY t.tag)
                  FROM tracker_item_tags t WHERE t.item_id = i.id) AS tags,
               (SELECT count(*) FROM tracker_updates u WHERE u.item_id = i.id) AS update_count,
               (SELECT max(u.created_at) FROM tracker_updates u WHERE u.item_id = i.id) AS last_update_at
          FROM tracker_items i
         WHERE i.id = ${id}
      `) as Row[];
      return rows.length ? mapItem(rows[0]) : null;
    },

    /** An item's progress notes, newest first. */
    async listUpdates(itemId: number): Promise<TrackerUpdate[]> {
      const rows = (await sql`
        SELECT id, author_email, body, created_at, edited_at
          FROM tracker_updates
         WHERE item_id = ${itemId}
         ORDER BY id DESC
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        authorEmail: String(row.author_email),
        body: String(row.body),
        createdAt: toIso(row.created_at),
        editedAt: toIsoOrNull(row.edited_at),
      }));
    },

    /** An item's activity trail, newest first. */
    async listEvents(itemId: number, limit = 50): Promise<TrackerEvent[]> {
      const rows = (await sql`
        SELECT id, actor_email, action, from_value, to_value, created_at
          FROM tracker_events
         WHERE item_id = ${itemId}
         ORDER BY id DESC
         LIMIT ${limit}
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        actorEmail: String(row.actor_email),
        action: String(row.action),
        fromValue: row.from_value == null ? null : String(row.from_value),
        toValue: row.to_value == null ? null : String(row.to_value),
        createdAt: toIso(row.created_at),
      }));
    },

    /**
     * Every tag in use on a live item, for the filter bar.
     *
     * Derived with `DISTINCT` rather than kept in a registry table: at this size
     * it is one index-only scan over `tracker_item_tags_tag_idx`, and unlike a
     * registry it cannot drift from the tags actually applied.
     */
    async listTags(): Promise<string[]> {
      const rows = (await sql`
        SELECT DISTINCT t.tag
          FROM tracker_item_tags t
          JOIN tracker_items i ON i.id = t.item_id
         WHERE i.archived_at IS NULL
         ORDER BY t.tag
      `) as Row[];
      return rows.map((row) => String(row.tag));
    },

    /**
     * Paste a new item in.
     *
     * One statement: the item, its tags and the `create` event. Tags ride in as
     * comma-joined text and are expanded with `string_to_array`; `nullif(…,'')`
     * makes the no-tags case an empty unnest rather than a row containing an
     * empty-string tag, which the format CHECK would reject and which would take
     * the whole insert — and the pasted brief — down with it.
     *
     * Returns the new id.
     */
    async createItem(input: {
      title: string;
      brief: string;
      tags: readonly string[];
      actor: string;
    }): Promise<number | null> {
      const rows = (await sql`
        WITH ins AS (
          INSERT INTO tracker_items (title, brief, created_by)
          VALUES (${input.title}, ${input.brief}, ${input.actor})
          RETURNING id, title
        ), tagged AS (
          INSERT INTO tracker_item_tags (item_id, tag)
          SELECT ins.id, tag
            FROM ins,
                 unnest(string_to_array(nullif(${csv(input.tags)}, ''), ',')) AS tag
          ON CONFLICT DO NOTHING
          RETURNING item_id
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action, to_value)
          SELECT ins.id, ${input.actor}, 'create', ins.title FROM ins
          RETURNING item_id
        )
        SELECT id FROM ins
      `) as Row[];
      return rows.length ? toInt(rows[0].id) : null;
    },

    /**
     * Move an item to another lane.
     *
     * `prev` reads the pre-update snapshot — a CTE sees the statement's starting
     * state — so `from_value` is correct with no extra round trip.
     *
     * `started_at` is stamped the FIRST time an item reaches `building` and never
     * re-stamped, so bouncing a thing in and out of the lane does not keep
     * resetting when work began. `done_at` is set on entering a terminal status
     * and CLEARED on leaving one, which the `tracker_items_done_at_matches_status`
     * CHECK makes mandatory rather than optional.
     *
     * Re-selecting the lane an item is already in is a NO-OP, not a failure:
     * `moved` is guarded on `t.status <> next` so it writes nothing and logs
     * nothing, but the final SELECT reads from `prev` LEFT JOIN `moved`, so a
     * live item still returns a row. Without that split, "already there" and "no
     * such item" would both be zero rows and the action would show an error for
     * a double-submitted form.
     *
     * Returns `{ from, changed }`, or `null` if there was no live item to move.
     */
    async setStatus(
      id: number,
      next: TrackerStatus,
      actor: string,
    ): Promise<{ from: string; changed: boolean } | null> {
      const terminal = csv(TERMINAL_STATUSES);
      const rows = (await sql`
        WITH prev AS (
          SELECT id, status FROM tracker_items
           WHERE id = ${id} AND archived_at IS NULL
        ), moved AS (
          UPDATE tracker_items t
             SET status     = ${next},
                 started_at = CASE
                                WHEN ${next} = 'building' AND t.started_at IS NULL
                                THEN now() ELSE t.started_at END,
                 done_at    = CASE
                                WHEN ${next} = ANY(string_to_array(${terminal}, ','))
                                THEN coalesce(t.done_at, now()) ELSE NULL END,
                 updated_at = now()
            FROM prev
           WHERE t.id = prev.id AND t.status <> ${next}
          RETURNING t.id, t.status
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action, from_value, to_value)
          SELECT moved.id, ${actor}, 'status', prev.status, moved.status
            FROM moved, prev
          RETURNING item_id
        )
        SELECT prev.status AS from_status, (moved.id IS NOT NULL) AS changed
          FROM prev LEFT JOIN moved ON moved.id = prev.id
      `) as Row[];
      if (!rows.length) return null;
      return {
        from: String(rows[0].from_status),
        changed: Boolean(rows[0].changed),
      };
    },

    /**
     * Rewrite an item's title and brief.
     *
     * The event records only that an edit happened, not a diff: the brief runs to
     * 20 000 characters and storing before/after copies of it on every keystroke-
     * to-save would make the audit table larger than the data. The progress
     * narrative that matters is in `tracker_updates`, which is append-only.
     */
    async editItem(
      id: number,
      input: { title: string; brief: string },
      actor: string,
    ): Promise<boolean> {
      const rows = (await sql`
        WITH prev AS (
          SELECT id, title FROM tracker_items
           WHERE id = ${id} AND archived_at IS NULL
        ), edited AS (
          UPDATE tracker_items t
             SET title = ${input.title}, brief = ${input.brief}, updated_at = now()
            FROM prev
           WHERE t.id = prev.id
          RETURNING t.id, t.title
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action, from_value, to_value)
          SELECT edited.id, ${actor}, 'edit', prev.title, edited.title
            FROM edited, prev
          RETURNING item_id
        )
        SELECT id FROM edited
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Converge an item's tags to exactly `tags`.
     *
     * One statement again, and one event rather than one per tag: the trail says
     * "tags: a,b → a,c", which is what somebody reading the history wants, and it
     * keeps a five-tag edit from writing ten rows.
     *
     * `NOT IN (SELECT tag FROM wanted)` is safe here specifically because
     * `wanted` can never contain a NULL — `nullif(…,'')` turns the empty case
     * into zero rows rather than one NULL row, and a NULL would make the whole
     * `NOT IN` unknown and silently delete nothing.
     */
    async setTags(
      id: number,
      tags: readonly string[],
      actor: string,
    ): Promise<boolean> {
      const next = csv(tags);
      const rows = (await sql`
        WITH live AS (
          SELECT id FROM tracker_items WHERE id = ${id} AND archived_at IS NULL
        ), prev AS (
          SELECT coalesce(string_agg(t.tag, ',' ORDER BY t.tag), '') AS tags
            FROM tracker_item_tags t, live WHERE t.item_id = live.id
        ), wanted AS (
          SELECT unnest(string_to_array(nullif(${next}, ''), ',')) AS tag
        ), removed AS (
          DELETE FROM tracker_item_tags t
           USING live
           WHERE t.item_id = live.id AND t.tag NOT IN (SELECT tag FROM wanted)
          RETURNING t.tag
        ), added AS (
          INSERT INTO tracker_item_tags (item_id, tag)
          SELECT live.id, wanted.tag FROM live, wanted
          ON CONFLICT DO NOTHING
          RETURNING tag
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action, from_value, to_value)
          SELECT live.id, ${actor}, 'tag', prev.tags, ${next}
            FROM live, prev
          RETURNING item_id
        )
        SELECT id FROM live
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Add a dated progress note — the thing that turns a status chip into
     * information a reader can act on.
     */
    async addUpdate(
      itemId: number,
      body: string,
      actor: string,
    ): Promise<number | null> {
      const rows = (await sql`
        WITH live AS (
          SELECT id FROM tracker_items WHERE id = ${itemId} AND archived_at IS NULL
        ), ins AS (
          INSERT INTO tracker_updates (item_id, author_email, body)
          SELECT live.id, ${actor}, ${body} FROM live
          RETURNING id
        ), touched AS (
          UPDATE tracker_items t SET updated_at = now() FROM live WHERE t.id = live.id
          RETURNING t.id
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action)
          SELECT live.id, ${actor}, 'comment' FROM live
          RETURNING item_id
        )
        SELECT id FROM ins
      `) as Row[];
      return rows.length ? toInt(rows[0].id) : null;
    },

    /**
     * Soft-delete. Nothing in the UI hard-deletes, so an item removed in error is
     * one click from coming back and its history is never orphaned.
     */
    async archiveItem(id: number, actor: string): Promise<boolean> {
      const rows = (await sql`
        WITH live AS (
          SELECT id FROM tracker_items WHERE id = ${id} AND archived_at IS NULL
        ), archived AS (
          UPDATE tracker_items t SET archived_at = now(), updated_at = now()
            FROM live WHERE t.id = live.id
          RETURNING t.id
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action)
          SELECT archived.id, ${actor}, 'archive' FROM archived
          RETURNING item_id
        )
        SELECT id FROM archived
      `) as Row[];
      return rows.length > 0;
    },

    /** Undo an archive. Guarded on `archived_at IS NOT NULL`, so it is not a no-op reused as a touch. */
    async restoreItem(id: number, actor: string): Promise<boolean> {
      const rows = (await sql`
        WITH gone AS (
          SELECT id FROM tracker_items WHERE id = ${id} AND archived_at IS NOT NULL
        ), restored AS (
          UPDATE tracker_items t SET archived_at = NULL, updated_at = now()
            FROM gone WHERE t.id = gone.id
          RETURNING t.id
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action)
          SELECT restored.id, ${actor}, 'restore' FROM restored
          RETURNING item_id
        )
        SELECT id FROM restored
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Destroy an item for good. The super-admin-only counterpart to
     * {@link archiveItem}, and the only unrecoverable operation in this store.
     *
     * NO `archived_at` GUARD, unlike every other mutation here. The other guards
     * exist to stop work happening on something already off the board; this one
     * IS the removal, and having to archive first before deleting would be
     * ceremony, not safety. Either state is deletable.
     *
     * THE EVENT OUTLIVES THE ROW, and it only can because `tracker_events.item_id`
     * carries no foreign key — the one deliberate omission in `021_tracker.sql`.
     * A CASCADE there would erase precisely the record you want afterwards: who
     * destroyed what, and when. So the trail keeps a dangling `item_id`, on
     * purpose.
     *
     * `tracker_item_tags` and `tracker_updates` DO cascade away with the row.
     * That is the honest cost of a hard delete and the reason archiving stays
     * the default: the progress notes are not recoverable.
     *
     * One statement, like every mutation here. Postgres runs a data-modifying
     * CTE exactly once and to completion whether or not the primary query reads
     * its output, so `logged` is not skippable — the delete cannot land without
     * its event.
     *
     * Returns the title of what was destroyed, so the caller can name it in the
     * confirmation, or `null` when there was no such item.
     */
    async deleteItem(id: number, actor: string): Promise<string | null> {
      const rows = (await sql`
        WITH gone AS (
          DELETE FROM tracker_items WHERE id = ${id}
          RETURNING id, title, status
        ), logged AS (
          INSERT INTO tracker_events (item_id, actor_email, action, from_value, to_value)
          SELECT gone.id, ${actor}, 'delete', gone.title, gone.status FROM gone
          RETURNING item_id
        )
        SELECT title FROM gone
      `) as Row[];
      return rows.length ? String(rows[0].title) : null;
    },

    /** Archived items, newest first — the "deleted" bin. */
    async listArchived(): Promise<TrackerCard[]> {
      const rows = (await sql`
        SELECT i.id, i.title, i.status, i.created_by, i.created_at, i.updated_at,
               (SELECT string_agg(t.tag, ',' ORDER BY t.tag)
                  FROM tracker_item_tags t WHERE t.item_id = i.id) AS tags,
               (SELECT count(*) FROM tracker_updates u WHERE u.item_id = i.id) AS update_count,
               (SELECT max(u.created_at) FROM tracker_updates u WHERE u.item_id = i.id) AS last_update_at
          FROM tracker_items i
         WHERE i.archived_at IS NOT NULL
         ORDER BY i.archived_at DESC
      `) as Row[];
      return rows.map(mapCard);
    },
  };
}

export type TrackerStore = ReturnType<typeof createTrackerStore>;
