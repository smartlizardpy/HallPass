/**
 * HallPass — who counts as an admin, for notification purposes.
 *
 * ── THE AUDIENCE IS RESOLVED AT SEND TIME, NEVER STORED ────────────────────
 * There is no `is_admin` column on a player and no admin flag on a notification
 * preference. Every delivery asks who the admins are NOW, so somebody who is
 * removed from `dashboard_users` stops being told without a cleanup step, and
 * somebody promoted starts being told without a backfill. The alternative —
 * denormalising the audience onto the player — is a second source of truth for
 * authorization, which is the one thing this codebase is most careful about
 * (`dashboard-users.ts`: "The dashboard's authorization model is OURS").
 *
 * ── TWO SOURCES, BECAUSE THE ENV LIST WINS UNCONDITIONALLY ─────────────────
 * `getUserRole` treats `SUPER_ADMIN_EMAILS` as authoritative even for an address
 * with no `dashboard_users` row at all. So a query over the table alone would
 * miss exactly the people with the most access — including, on a fresh deploy,
 * every one of them.
 *
 * ── AN ADMIN WITH NO ARCADE ACCOUNT IS SILENCE, NOT AN ERROR ───────────────
 * `dashboard_users` is keyed by EMAIL and notifications are owned by a
 * `players.id`. An admin who has never signed into the arcade itself has no
 * player row, so there is nowhere to file a notification. That is a real and
 * expected state — the dashboard and the arcade are separate sign-ins — and it
 * resolves to "no recipient" rather than a failed delivery.
 */

import "server-only";
import { sql } from "@/app/lib/db";
import { getUserRole } from "@/app/lib/dashboard-users";
import type { NotificationAudience } from "./config";

/** Canonical email form, matching `dashboard-users.ts` exactly. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The env-driven super-admin allow-list, normalised. Read lazily, as there. */
function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Every admin who has an arcade account, as player ids.
 *
 * ONE statement over both sources. `dashboard_users` is a subquery rather than a
 * join so the env list can be OR'd in at the same level — the two are
 * alternatives, not a set to intersect.
 *
 * Emails are compared `lower()`-ed on both sides. `dashboard_users` normalises
 * on write and `players` does not, so the two tables genuinely can disagree
 * about case for the same person, and an admin missing their notifications
 * because they once signed in with a capital letter is the sort of bug that
 * takes months to notice.
 *
 * FAIL-SOFT TO `[]`. The caller is a delivery path running behind somebody
 * else's successful action; an unreachable `dashboard_users` must cost an admin
 * notification, never the review that triggered it.
 */
export async function adminPlayerIds(): Promise<string[]> {
  try {
    const envEmails = superAdminEmails();
    const rows = (await sql`
      SELECT id
        FROM players
       WHERE email IS NOT NULL
         AND (
           lower(email) IN (SELECT lower(email) FROM dashboard_users)
           OR lower(email) = ANY(${envEmails}::text[])
         )
    `) as Record<string, unknown>[];
    return rows.map((row) => String(row.id));
  } catch (error) {
    console.error("[notifications] adminPlayerIds failed:", error);
    return [];
  }
}

/**
 * Which set of kinds this person may see and set.
 *
 * Fail-soft to `"player"`. Degrading the OTHER way would show the moderation
 * settings — and, on the notifications page, the fact that those kinds exist at
 * all — to whoever happened to load the page during a database blip.
 */
export async function audienceFor(
  email: string | null | undefined,
): Promise<NotificationAudience> {
  if (!email) return "player";
  try {
    return (await getUserRole(normalizeEmail(email))) ? "admin" : "player";
  } catch (error) {
    console.error("[notifications] audienceFor failed:", error);
    return "player";
  }
}
