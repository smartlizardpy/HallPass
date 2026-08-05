/**
 * HallPass — the beta programme store.
 *
 * A `createBetaStore(sql)` factory like `scoreboard/store.ts`, `social/store.ts`,
 * `reviews/store.ts` and `achievements/store.ts`: deliberately free of
 * `server-only` so the branchy parts can be unit-tested against a fake tagged
 * template. The barrel (`index.ts`) binds the real connection.
 *
 * SQL SAFETY. The `neon()` tagged template parameterises VALUES only and does
 * not reliably splice fragments. Nothing here interpolates a column name, a
 * table name or an ORDER BY direction. Where behaviour depends on an enum, the
 * method branches in JS into two fully-written templates rather than building a
 * string — see {@link BetaStore.triageReport}.
 *
 * ONE STATEMENT PER MUTATION, forced by the driver: `neon()` is SQL-over-HTTP
 * with one stateless request per call, so a transaction cannot span two of them.
 * Anything that must change two tables together travels as a single
 * data-modifying CTE.
 *
 * WHY TRIAGE IS READ-THEN-WRITE ANYWAY. Awarding XP needs the report's `kind`
 * and `severity`, and the XP table lives in TypeScript (`config.ts`), not in the
 * database — so the amount cannot be computed inside the statement. The write is
 * therefore guarded by `status = 'open'`: if anything changed since the admin
 * loaded the queue, the UPDATE matches zero rows, the CTE yields nothing, and no
 * award is inserted. A partial unique index on `beta_xp_awards(report_id)` closes
 * the remaining gap — a double-submitted form pays once, not twice.
 *
 * TIMESTAMPS come back from `neon()` as strings; every one is funnelled through
 * `toIso()` so callers never see a driver-shaped value. BIGINT and `count(*)`
 * come back as strings too, hence `toInt()`.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  toAssignmentStatus,
  toBugSeverity,
  toReportKind,
  toReportStatus,
  toShotKind,
  toShotStatus,
  type AssignmentStatus,
  type BugSeverity,
  type ReportKind,
  type ReportStatus,
  type ShotKind,
  type ShotStatus,
} from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

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

function toStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function toStrOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Programme membership as the guard sees it. */
export type BetaTester = {
  playerId: string;
  invitedBy: string | null;
  invitedAt: string;
  /** Non-null means membership was withdrawn; the row is kept for audit. */
  revokedAt: string | null;
  notes: string;
};

/**
 * A roster row for the admin table.
 *
 * Carries the player's PUBLIC display fields only — never `players.email`. The
 * roster is an admin surface, but keeping the email out by construction means
 * this shape can never leak one if a future page renders it somewhere else.
 */
export type RosterEntry = BetaTester & {
  username: string | null;
  handle: string | null;
  name: string | null;
  image: string | null;
  xp: number;
  openAssignments: number;
  reportsFiled: number;
  reportsAccepted: number;
};

export type BetaAssignment = {
  id: number;
  playerId: string;
  slug: string;
  assignedBy: string | null;
  brief: string;
  status: AssignmentStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type BetaReport = {
  id: number;
  playerId: string | null;
  assignmentId: number | null;
  slug: string;
  kind: ReportKind;
  severity: BugSeverity | null;
  title: string;
  body: string;
  status: ReportStatus;
  clipBlobPath: string | null;
  clipBytes: number;
  clipMs: number;
  /** Blob key of the screenshot pinned to this report, for deletion on resolve. */
  shotBlobPath: string | null;
  /** The screenshot's URL, so triage renders evidence without a head(). */
  shotUrl: string | null;
  device: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

/** A report joined to its author's public display fields, for the admin queue. */
export type BetaReportWithAuthor = BetaReport & {
  authorUsername: string | null;
  authorHandle: string | null;
  authorName: string | null;
};

export type BetaShot = {
  id: string;
  playerId: string | null;
  slug: string;
  blobPath: string;
  blobUrl: string | null;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  kind: ShotKind;
  status: ShotStatus;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  promotedMediaId: string | null;
};

export type XpAward = {
  id: number;
  amount: number;
  reason: string;
  reportId: number | null;
  shotId: string | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapTester(row: Row): BetaTester {
  return {
    playerId: String(row.player_id),
    invitedBy: toStrOrNull(row.invited_by),
    invitedAt: toIso(row.invited_at),
    revokedAt: toIsoOrNull(row.revoked_at),
    notes: toStr(row.notes),
  };
}

function mapRoster(row: Row): RosterEntry {
  return {
    ...mapTester(row),
    username: toStrOrNull(row.username),
    handle: toStrOrNull(row.handle),
    name: toStrOrNull(row.name),
    image: toStrOrNull(row.image),
    xp: toInt(row.xp),
    openAssignments: toInt(row.open_assignments),
    reportsFiled: toInt(row.reports_filed),
    reportsAccepted: toInt(row.reports_accepted),
  };
}

function mapAssignment(row: Row): BetaAssignment {
  return {
    id: toInt(row.id),
    playerId: String(row.player_id),
    slug: String(row.slug),
    assignedBy: toStrOrNull(row.assigned_by),
    brief: toStr(row.brief),
    // A value outside the union can only mean the CHECK was altered without this
    // file; fall back rather than hand callers a lie typed as AssignmentStatus.
    status: toAssignmentStatus(row.status) ?? "assigned",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: toIsoOrNull(row.completed_at),
  };
}

function mapReport(row: Row): BetaReport {
  return {
    id: toInt(row.id),
    playerId: toStrOrNull(row.player_id),
    assignmentId: row.assignment_id == null ? null : toInt(row.assignment_id),
    slug: String(row.slug),
    kind: toReportKind(row.kind) ?? "bug",
    severity: toBugSeverity(row.severity),
    title: toStr(row.title),
    body: toStr(row.body),
    status: toReportStatus(row.status) ?? "open",
    clipBlobPath: toStrOrNull(row.clip_blob_path),
    clipBytes: toInt(row.clip_bytes),
    clipMs: toInt(row.clip_ms),
    shotBlobPath: toStrOrNull(row.shot_blob_path),
    shotUrl: toStrOrNull(row.shot_url),
    device: toStr(row.device),
    createdAt: toIso(row.created_at),
    resolvedBy: toStrOrNull(row.resolved_by),
    resolvedAt: toIsoOrNull(row.resolved_at),
  };
}

function mapReportWithAuthor(row: Row): BetaReportWithAuthor {
  return {
    ...mapReport(row),
    authorUsername: toStrOrNull(row.author_username),
    authorHandle: toStrOrNull(row.author_handle),
    authorName: toStrOrNull(row.author_name),
  };
}

function mapShot(row: Row): BetaShot {
  return {
    id: String(row.id),
    playerId: toStrOrNull(row.player_id),
    slug: String(row.slug),
    blobPath: String(row.blob_path),
    blobUrl: toStrOrNull(row.blob_url),
    contentType: toStr(row.content_type),
    width: toInt(row.width),
    height: toInt(row.height),
    bytes: toInt(row.bytes),
    kind: toShotKind(row.kind) ?? "screenshot",
    status: toShotStatus(row.status) ?? "pending",
    createdAt: toIso(row.created_at),
    reviewedBy: toStrOrNull(row.reviewed_by),
    reviewedAt: toIsoOrNull(row.reviewed_at),
    promotedMediaId: toStrOrNull(row.promoted_media_id),
  };
}

function mapAward(row: Row): XpAward {
  return {
    id: toInt(row.id),
    amount: toInt(row.amount),
    reason: toStr(row.reason),
    reportId: row.report_id == null ? null : toInt(row.report_id),
    shotId: toStrOrNull(row.shot_id),
    createdAt: toIso(row.created_at),
  };
}

export type BetaStore = ReturnType<typeof createBetaStore>;

export function createBetaStore(sql: Sql) {
  return {
    // -----------------------------------------------------------------------
    // Membership
    // -----------------------------------------------------------------------

    /**
     * One player's membership row, revoked or not.
     *
     * Returns the row even when `revokedAt` is set so callers can tell "never a
     * tester" (null) from "was, isn't now" — the tester page shows a different
     * message for each, and collapsing them would tell a revoked tester they
     * were never in the programme.
     */
    async tester(playerId: string): Promise<BetaTester | null> {
      const rows = await sql`
        SELECT player_id, invited_by, invited_at, revoked_at, notes
        FROM beta_testers
        WHERE player_id = ${playerId}
      `;
      return rows.length > 0 ? mapTester(rows[0]) : null;
    },

    /** True only for a CURRENT member. The guard's actual question. */
    async isActiveTester(playerId: string): Promise<boolean> {
      const row = await this.tester(playerId);
      return row != null && row.revokedAt == null;
    },

    /**
     * The whole roster with per-tester counts, for the admin table.
     *
     * Aggregates are LATERAL subqueries rather than a chain of LEFT JOINs with
     * GROUP BY: joining three one-to-many tables at once multiplies rows before
     * aggregation, and the classic fix (count(DISTINCT …) three times) is both
     * slower and easy to get subtly wrong. The roster is at most a few dozen
     * rows, so a per-row subquery is the cheap, obviously-correct option.
     */
    async roster(): Promise<RosterEntry[]> {
      const rows = await sql`
        SELECT t.player_id, t.invited_by, t.invited_at, t.revoked_at, t.notes,
               p.username, p.handle, p.name, p.image,
               (SELECT COALESCE(sum(a.amount), 0)::int
                  FROM beta_xp_awards a WHERE a.player_id = t.player_id) AS xp,
               (SELECT count(*)::int FROM beta_assignments s
                  WHERE s.player_id = t.player_id
                    AND s.status IN ('assigned', 'in_progress')) AS open_assignments,
               (SELECT count(*)::int FROM beta_reports r
                  WHERE r.player_id = t.player_id) AS reports_filed,
               (SELECT count(*)::int FROM beta_reports r
                  WHERE r.player_id = t.player_id AND r.status = 'accepted')
                 AS reports_accepted
        FROM beta_testers t
        JOIN players p ON p.id = t.player_id
        ORDER BY t.revoked_at IS NOT NULL, t.invited_at DESC
      `;
      return rows.map(mapRoster);
    },

    /**
     * Invite a player, or reinstate one previously revoked.
     *
     * `revoked_at = NULL` on conflict is what makes this a reinstatement rather
     * than a no-op — without it, re-inviting a revoked tester would appear to
     * succeed while leaving them locked out.
     */
    async invite(playerId: string, invitedBy: string): Promise<void> {
      await sql`
        INSERT INTO beta_testers (player_id, invited_by)
        VALUES (${playerId}, ${invitedBy})
        ON CONFLICT (player_id)
        DO UPDATE SET revoked_at = NULL, invited_by = ${invitedBy}
      `;
    },

    /** Withdraw membership, keeping the row (and its XP ledger) intact. */
    async revoke(playerId: string): Promise<void> {
      await sql`
        UPDATE beta_testers SET revoked_at = now()
        WHERE player_id = ${playerId} AND revoked_at IS NULL
      `;
    },

    // -----------------------------------------------------------------------
    // Assignments
    // -----------------------------------------------------------------------

    /** One tester's queue, newest first. */
    async assignmentsFor(playerId: string): Promise<BetaAssignment[]> {
      const rows = await sql`
        SELECT id, player_id, slug, assigned_by, brief, status,
               created_at, updated_at, completed_at
        FROM beta_assignments
        WHERE player_id = ${playerId}
        ORDER BY created_at DESC
      `;
      return rows.map(mapAssignment);
    },

    /**
     * Everyone who has FINISHED a playtest, for the public credit on a game
     * page. Keyed by slug by the caller.
     *
     * Only `submitted` and `closed` count. Crediting someone the moment a game
     * is assigned would publish "this person is testing an unreleased game"
     * before they have done anything, and would keep crediting them if they
     * never got round to it.
     *
     * PUBLIC DISPLAY FIELDS ONLY — the same rule the roster follows, and it
     * matters more here: this feeds `/game/[slug]`, which IS indexed. A query
     * that cannot select `players.email` cannot leak one onto the open web.
     *
     * Reads the whole table in one go rather than per slug. It is bounded by the
     * number of assignments ever completed and the caller caches it under a
     * single tag, exactly as `readAllMediaCached` does — a per-slug cache would
     * key on a runtime argument and grow without bound.
     */
    async completedTesters(): Promise<
      { slug: string; handle: string | null; username: string | null }[]
    > {
      const rows = await sql`
        SELECT a.slug, p.handle, p.username
        FROM beta_assignments a
        JOIN players p ON p.id = a.player_id
        WHERE a.status IN ('submitted', 'closed')
        ORDER BY a.slug ASC, a.completed_at ASC NULLS LAST
      `;
      return rows.map((row) => ({
        slug: String(row.slug),
        handle: toStrOrNull(row.handle),
        username: toStrOrNull(row.username),
      }));
    },

    /** Every assignment, newest first — the admin overview. */
    async allAssignments(): Promise<BetaAssignment[]> {
      const rows = await sql`
        SELECT id, player_id, slug, assigned_by, brief, status,
               created_at, updated_at, completed_at
        FROM beta_assignments
        ORDER BY created_at DESC
      `;
      return rows.map(mapAssignment);
    },

    /**
     * Issue (or re-issue) a playtest.
     *
     * Re-assigning the same game to the same tester updates the brief and
     * REOPENS the assignment rather than stacking a duplicate in their queue —
     * that is what the UNIQUE (player_id, slug) constraint is for. Reopening is
     * the useful behaviour: an admin re-assigning a closed game means "look at
     * this again", not "ignore me".
     */
    async assign(input: {
      playerId: string;
      slug: string;
      assignedBy: string;
      brief?: string;
    }): Promise<void> {
      await sql`
        INSERT INTO beta_assignments (player_id, slug, assigned_by, brief)
        VALUES (${input.playerId}, ${input.slug}, ${input.assignedBy},
                ${input.brief ?? ""})
        ON CONFLICT (player_id, slug) DO UPDATE
          SET brief = ${input.brief ?? ""},
              assigned_by = ${input.assignedBy},
              status = 'assigned',
              updated_at = now(),
              completed_at = NULL
      `;
    },

    /**
     * Move an assignment along its lifecycle.
     *
     * `completed_at` is set by the same statement when the new status is
     * terminal, so the timestamp cannot drift from the status it describes.
     * Branches in JS rather than interpolating the status into one template.
     */
    async setAssignmentStatus(
      id: number,
      status: AssignmentStatus,
    ): Promise<void> {
      if (status === "submitted" || status === "closed") {
        await sql`
          UPDATE beta_assignments
          SET status = ${status}, updated_at = now(), completed_at = now()
          WHERE id = ${id}
        `;
        return;
      }
      await sql`
        UPDATE beta_assignments
        SET status = ${status}, updated_at = now(), completed_at = NULL
        WHERE id = ${id}
      `;
    },

    /** Withdraw an assignment entirely. */
    async unassign(id: number): Promise<void> {
      await sql`DELETE FROM beta_assignments WHERE id = ${id}`;
    },

    // -----------------------------------------------------------------------
    // Reports
    // -----------------------------------------------------------------------

    /**
     * File a report, returning its new id so a clip can be attached to it.
     *
     * `severity` must be null for a feature and non-null for a bug — the DB
     * CHECK (`beta_reports_severity_matches_kind`) enforces it, and the caller
     * normalises before arriving here.
     */
    async createReport(input: {
      playerId: string;
      assignmentId: number | null;
      slug: string;
      kind: ReportKind;
      severity: BugSeverity | null;
      title: string;
      body: string;
      device?: string;
      /** Evidence picked from the session's automatic grabs, if any. */
      shotBlobPath?: string | null;
      shotUrl?: string | null;
    }): Promise<number> {
      const rows = await sql`
        INSERT INTO beta_reports
          (player_id, assignment_id, slug, kind, severity, title, body, device,
           shot_blob_path, shot_url)
        VALUES (${input.playerId}, ${input.assignmentId}, ${input.slug},
                ${input.kind}, ${input.severity}, ${input.title}, ${input.body},
                ${input.device ?? ""},
                ${input.shotBlobPath ?? null}, ${input.shotUrl ?? null})
        RETURNING id
      `;
      return toInt(rows[0]?.id);
    },

    /** One report by id, or null. */
    async reportById(id: number): Promise<BetaReport | null> {
      const rows = await sql`
        SELECT id, player_id, assignment_id, slug, kind, severity, title, body,
               status, clip_blob_path, clip_bytes, clip_ms, shot_blob_path, shot_url,
               device, created_at,
               resolved_by, resolved_at
        FROM beta_reports
        WHERE id = ${id}
      `;
      return rows.length > 0 ? mapReport(rows[0]) : null;
    },

    /** One tester's own reports, newest first. */
    async reportsFor(playerId: string, limit = 50): Promise<BetaReport[]> {
      const rows = await sql`
        SELECT id, player_id, assignment_id, slug, kind, severity, title, body,
               status, clip_blob_path, clip_bytes, clip_ms, shot_blob_path, shot_url,
               device, created_at,
               resolved_by, resolved_at
        FROM beta_reports
        WHERE player_id = ${playerId}
        ORDER BY created_at DESC
        LIMIT ${Math.max(1, Math.min(200, limit))}
      `;
      return rows.map(mapReport);
    },

    /**
     * The admin triage queue: open reports first, newest first within a status.
     *
     * Joined to the author's PUBLIC display fields only. `players.email` is
     * never selected — an admin identifies a tester by username, and a query
     * that cannot return the address cannot leak it into a server component's
     * serialised props.
     */
    async reportQueue(limit = 100): Promise<BetaReportWithAuthor[]> {
      const rows = await sql`
        SELECT r.id, r.player_id, r.assignment_id, r.slug, r.kind, r.severity,
               r.title, r.body, r.status, r.clip_blob_path, r.clip_bytes,
               r.clip_ms, r.shot_blob_path, r.shot_url,
               r.device, r.created_at, r.resolved_by, r.resolved_at,
               p.username AS author_username,
               p.handle   AS author_handle,
               p.name     AS author_name
        FROM beta_reports r
        LEFT JOIN players p ON p.id = r.player_id
        ORDER BY (r.status = 'open') DESC, r.created_at DESC
        LIMIT ${Math.max(1, Math.min(500, limit))}
      `;
      return rows.map(mapReportWithAuthor);
    },

    /**
     * Record a triage decision and pay the XP it earns, in ONE statement.
     *
     * The UPDATE is guarded by `status = 'open'`, so a decision made against a
     * stale queue matches nothing and awards nothing. The award INSERT selects
     * FROM the update's RETURNING, so it can only fire when the update did.
     * `ON CONFLICT DO NOTHING` against the partial unique index on `report_id`
     * makes a double-submitted form idempotent.
     *
     * Branches in JS on whether there is anything to pay, rather than embedding a
     * conditional in SQL: a zero-XP decision (rejected) should write no ledger
     * row at all, not a row worth nothing that clutters the tester's history.
     */
    async triageReport(input: {
      id: number;
      status: ReportStatus;
      severity: BugSeverity | null;
      resolvedBy: string;
      xp: number;
      reason: string;
    }): Promise<boolean> {
      if (input.xp > 0) {
        const rows = await sql`
          WITH updated AS (
            UPDATE beta_reports
            SET status = ${input.status},
                severity = COALESCE(${input.severity}, severity),
                resolved_by = ${input.resolvedBy},
                resolved_at = now()
            WHERE id = ${input.id} AND status = 'open'
            RETURNING id, player_id
          ), paid AS (
            INSERT INTO beta_xp_awards
              (player_id, amount, reason, report_id, awarded_by)
            SELECT player_id, ${input.xp}, ${input.reason}, id, ${input.resolvedBy}
            FROM updated
            WHERE player_id IS NOT NULL
            ON CONFLICT (report_id) WHERE report_id IS NOT NULL DO NOTHING
            RETURNING id
          )
          SELECT id FROM updated
        `;
        return rows.length > 0;
      }
      const rows = await sql`
        UPDATE beta_reports
        SET status = ${input.status},
            severity = COALESCE(${input.severity}, severity),
            resolved_by = ${input.resolvedBy},
            resolved_at = now()
        WHERE id = ${input.id} AND status = 'open'
        RETURNING id
      `;
      return rows.length > 0;
    },

    /** Attach an uploaded clip to a report the tester just filed. */
    async attachClip(input: {
      reportId: number;
      playerId: string;
      blobPath: string;
      bytes: number;
      ms: number;
    }): Promise<void> {
      // Scoped to the author so a guessed report id cannot have a clip stapled
      // to it by another tester.
      await sql`
        UPDATE beta_reports
        SET clip_blob_path = ${input.blobPath},
            clip_bytes = ${input.bytes},
            clip_ms = ${input.ms}
        WHERE id = ${input.reportId} AND player_id = ${input.playerId}
      `;
    },

    /** Forget a clip after its object has been deleted from Blob. */
    async clearClip(reportId: number): Promise<void> {
      await sql`
        UPDATE beta_reports
        SET clip_blob_path = NULL, clip_bytes = 0, clip_ms = 0
        WHERE id = ${reportId}
      `;
    },

    /** Clips older than `days`, for the retention sweep. */
    async expiredClips(days: number): Promise<{ id: number; blobPath: string }[]> {
      const rows = await sql`
        SELECT id, clip_blob_path
        FROM beta_reports
        WHERE clip_blob_path IS NOT NULL
          AND created_at < now() - make_interval(days => ${Math.max(1, days)})
      `;
      return rows.map((row) => ({
        id: toInt(row.id),
        blobPath: String(row.clip_blob_path),
      }));
    },

    /** Reports filed by one player inside the rate-limit window. */
    async recentReportCount(
      playerId: string,
      windowSeconds: number,
    ): Promise<number> {
      const rows = await sql`
        SELECT count(*)::int AS n
        FROM beta_reports
        WHERE player_id = ${playerId}
          AND created_at > now() - make_interval(secs => ${windowSeconds})
      `;
      return toInt(rows[0]?.n);
    },

    // -----------------------------------------------------------------------
    // Shots
    // -----------------------------------------------------------------------

    /** Stage a submitted image for review. */
    async createShot(input: {
      id: string;
      playerId: string;
      slug: string;
      blobPath: string;
      blobUrl: string;
      contentType: string;
      width: number;
      height: number;
      bytes: number;
      kind: ShotKind;
    }): Promise<void> {
      await sql`
        INSERT INTO beta_shots
          (id, player_id, slug, blob_path, blob_url, content_type,
           width, height, bytes, kind)
        VALUES (${input.id}, ${input.playerId}, ${input.slug}, ${input.blobPath},
                ${input.blobUrl}, ${input.contentType}, ${input.width},
                ${input.height}, ${input.bytes}, ${input.kind})
      `;
    },

    /** One shot by id, or null. */
    async shotById(id: string): Promise<BetaShot | null> {
      const rows = await sql`
        SELECT id, player_id, slug, blob_path, blob_url, content_type, width,
               height, bytes, kind, status, created_at, reviewed_by, reviewed_at,
               promoted_media_id
        FROM beta_shots
        WHERE id = ${id}
      `;
      return rows.length > 0 ? mapShot(rows[0]) : null;
    },

    /** The review queue: pending first, newest first within a status. */
    async shotQueue(limit = 100): Promise<BetaShot[]> {
      const rows = await sql`
        SELECT id, player_id, slug, blob_path, blob_url, content_type, width,
               height, bytes, kind, status, created_at, reviewed_by, reviewed_at,
               promoted_media_id
        FROM beta_shots
        ORDER BY (status = 'pending') DESC, created_at DESC
        LIMIT ${Math.max(1, Math.min(500, limit))}
      `;
      return rows.map(mapShot);
    },

    /** One tester's own submissions, newest first. */
    async shotsFor(playerId: string, limit = 50): Promise<BetaShot[]> {
      const rows = await sql`
        SELECT id, player_id, slug, blob_path, blob_url, content_type, width,
               height, bytes, kind, status, created_at, reviewed_by, reviewed_at,
               promoted_media_id
        FROM beta_shots
        WHERE player_id = ${playerId}
        ORDER BY created_at DESC
        LIMIT ${Math.max(1, Math.min(200, limit))}
      `;
      return rows.map(mapShot);
    },

    /**
     * Record a review decision and pay for an acceptance, in ONE statement.
     *
     * Same shape as {@link BetaStore.triageReport}: guarded on `pending`, award
     * selected from the update's RETURNING, idempotent against the partial
     * unique index on `(shot_id, reason)`. The reason is part of that index so a
     * later cover promotion can pay a SECOND time under a different reason
     * without colliding with the acceptance award.
     */
    async reviewShot(input: {
      id: string;
      status: ShotStatus;
      reviewedBy: string;
      xp: number;
      reason: string;
      promotedMediaId?: string | null;
    }): Promise<boolean> {
      if (input.xp > 0) {
        const rows = await sql`
          WITH updated AS (
            UPDATE beta_shots
            SET status = ${input.status},
                reviewed_by = ${input.reviewedBy},
                reviewed_at = now(),
                promoted_media_id = ${input.promotedMediaId ?? null}
            WHERE id = ${input.id} AND status = 'pending'
            RETURNING id, player_id
          ), paid AS (
            INSERT INTO beta_xp_awards
              (player_id, amount, reason, shot_id, awarded_by)
            SELECT player_id, ${input.xp}, ${input.reason}, id, ${input.reviewedBy}
            FROM updated
            WHERE player_id IS NOT NULL
            ON CONFLICT (shot_id, reason) WHERE shot_id IS NOT NULL DO NOTHING
            RETURNING id
          )
          SELECT id FROM updated
        `;
        return rows.length > 0;
      }
      const rows = await sql`
        UPDATE beta_shots
        SET status = ${input.status},
            reviewed_by = ${input.reviewedBy},
            reviewed_at = now()
        WHERE id = ${input.id} AND status = 'pending'
        RETURNING id
      `;
      return rows.length > 0;
    },

    /** Shots submitted by one player inside the rate-limit window. */
    async recentShotCount(
      playerId: string,
      windowSeconds: number,
    ): Promise<number> {
      const rows = await sql`
        SELECT count(*)::int AS n
        FROM beta_shots
        WHERE player_id = ${playerId}
          AND created_at > now() - make_interval(secs => ${windowSeconds})
      `;
      return toInt(rows[0]?.n);
    },

    // -----------------------------------------------------------------------
    // XP
    // -----------------------------------------------------------------------

    /**
     * A player's total XP.
     *
     * `COALESCE(sum(...), 0)` because `sum()` over no rows is NULL, not 0 — the
     * common case on a tester's first day.
     */
    async xpFor(playerId: string): Promise<number> {
      const rows = await sql`
        SELECT COALESCE(sum(amount), 0)::int AS xp
        FROM beta_xp_awards
        WHERE player_id = ${playerId}
      `;
      return toInt(rows[0]?.xp);
    },

    /** A player's ledger, newest first — the "how did I earn this" list. */
    async awardsFor(playerId: string, limit = 50): Promise<XpAward[]> {
      const rows = await sql`
        SELECT id, amount, reason, report_id, shot_id, created_at
        FROM beta_xp_awards
        WHERE player_id = ${playerId}
        ORDER BY created_at DESC
        LIMIT ${Math.max(1, Math.min(200, limit))}
      `;
      return rows.map(mapAward);
    },

    /**
     * Pay XP outside the triage flow (a manual bonus, say).
     *
     * Carries no `report_id`/`shot_id`, so the partial unique indexes do not
     * apply and repeated calls DO stack. That is deliberate — a manual award is
     * an admin choosing to pay again.
     */
    async award(input: {
      playerId: string;
      amount: number;
      reason: string;
      awardedBy: string;
    }): Promise<void> {
      await sql`
        INSERT INTO beta_xp_awards (player_id, amount, reason, awarded_by)
        VALUES (${input.playerId}, ${Math.max(0, Math.floor(input.amount))},
                ${input.reason}, ${input.awardedBy})
      `;
    },
  };
}
