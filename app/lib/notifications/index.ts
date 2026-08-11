/**
 * HallPass — the notifications barrel: the live store bound to the shared Neon
 * client, plus the read wrappers every surface actually calls.
 *
 * Mirrors `challenges/index.ts`, `push/index.ts` and `social/index.ts`. The
 * factory in `store.ts` stays free of `server-only` so it can be unit-tested
 * against a fake tagged template; THIS module reaches for the real connection,
 * so it is the one that must never reach a client bundle.
 *
 * ── WHY THE FAIL-SOFT READ WRAPPERS EXIST ──────────────────────────────────
 * Schema here is applied BY HAND (see `scoreboard/migrations/`, and `HANDOFF.md`
 * for a live case where a migration never reached production), so there is
 * always a window where this code runs against a database with no
 * `notifications` table. Reads degrade to an empty inbox.
 *
 * That matters more for the bell than for most surfaces, because the bell is
 * mounted in the SITE HEADER — on every page, for every visitor. A read that
 * threw would not cost a notification list, it would cost the header, and with
 * it the search field and the way home.
 *
 * They swallow the RESULT but not the SIGNAL: a missing table or an
 * unconfigured `DATABASE_URL` is expected during that window and stays quiet,
 * while anything else is logged before degrading.
 *
 * WRITES ARE NOT WRAPPED. A route has to tell "refused" from "the database is
 * down" to choose a status code, so `markSeen` and `setPref` throw and the
 * caller decides. Delivery is the exception and handles its own failure — see
 * `deliver.ts`, which must never turn somebody else's successful action into an
 * error because a notification could not be filed.
 *
 * ── PREFERENCE FILTERING HAPPENS HERE, NOT IN SQL ──────────────────────────
 * A broadcast row is SHARED, so whether a given player wants it cannot be a
 * property of the row — and the answer depends on the DEFAULTS in `config.ts`,
 * which are code and deliberately not in the database. Filtering in the store
 * would have meant either duplicating those defaults into SQL or assuming no
 * default is ever `off`; both are the kind of quiet coupling that survives right
 * up until somebody changes a default.
 *
 * The same filter is applied to PERSONAL rows even though `deliver.ts` already
 * declines to write a kind somebody has switched off. That is not redundant: it
 * is what makes turning a kind off apply to what is ALREADY in the inbox, so
 * "off" means the same thing looking backwards as forwards. It is reversible —
 * nothing is deleted, and turning the kind back on brings the history back.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import {
  BELL_LIST_LIMIT,
  NOTIFICATION_LIST_LIMIT,
  deliversToBell,
  isNotificationKind,
  resolveChannel,
  type NotificationChannel,
  type NotificationKind,
} from "./config";
import { createNotificationStore, type StoredNotification } from "./store";

/** The live store. Use it directly where you want errors to surface (writes). */
export const notifications = createNotificationStore(sql);

export type { StoredNotification, InboxPage } from "./store";

/** One notification as a surface renders it. */
export type InboxItem = StoredNotification & {
  /**
   * Newer than this player's watermark.
   *
   * Computed rather than stored — see `024_notifications.sql` for why read state
   * is a single timestamp per player rather than a column per row.
   */
  isNew: boolean;
};

/** What the bell and the notifications page both read. */
export type Inbox = {
  items: InboxItem[];
  /**
   * How many of `items` are unread.
   *
   * COUNTED OVER THE FETCHED PAGE, not the whole table, and that is a deliberate
   * limit rather than an oversight: retention caps a player at
   * `NOTIFICATIONS_KEEP_PER_PLAYER` rows anyway, and a badge is a prompt to look
   * rather than an inventory. The UI caps the number it draws regardless.
   */
  unread: number;
};

/**
 * True when `error` is the expected "schema is not here yet" pair — no table, or
 * no `DATABASE_URL` at all. Anything else is a real fault.
 */
function isExpectedMissingSchema(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

/** Log unless the failure is the expected missing-schema window. */
function reportUnexpected(what: string, error: unknown): void {
  if (!isExpectedMissingSchema(error)) {
    console.error(`[notifications] ${what} failed:`, error);
  }
}

/** The empty answer, shared so every degraded path returns the same shape. */
const EMPTY_INBOX: Inbox = { items: [], unread: 0 };

/**
 * Drop what this player should not see, and mark what is new.
 *
 * Two reasons a row is dropped, and they are different:
 *
 *   * AN UNKNOWN KIND. `kind` is free TEXT with no CHECK (024 says why), so a
 *     row written by a newer deploy can be read by an older one. Rendering it
 *     would mean a notification with no label, no icon and no setting behind it.
 *   * A KIND SWITCHED OFF. `off` means "do not tell me", and it means that about
 *     the backlog too.
 */
function toInbox(
  page: { items: StoredNotification[]; seenAt: string | null },
  prefs: Record<string, string>,
): Inbox {
  // `null` means the bell has never been opened, so everything is unread.
  const seen = page.seenAt === null ? null : Date.parse(page.seenAt);

  const items: InboxItem[] = [];
  for (const item of page.items) {
    if (!isNotificationKind(item.kind)) continue;
    if (!deliversToBell(resolveChannel(item.kind, prefs[item.kind]))) continue;
    items.push({
      ...item,
      isNew: seen === null || Date.parse(item.createdAt) > seen,
    });
  }

  return { items, unread: items.filter((item) => item.isNew).length };
}

/**
 * This player's inbox, already filtered and marked up. `EMPTY_INBOX` if the
 * schema is not there.
 *
 * The two reads run CONCURRENTLY rather than in sequence: they are independent,
 * and the bell polls this on a timer from the site header, so the round trip
 * that pair costs is paid on every page by every signed-in visitor.
 */
export async function getInbox(
  playerId: string,
  limit: number = NOTIFICATION_LIST_LIMIT,
): Promise<Inbox> {
  try {
    const [page, prefs] = await Promise.all([
      notifications.listFor(playerId, limit),
      notifications.prefsFor(playerId),
    ]);
    return toInbox(page, prefs);
  } catch (error) {
    reportUnexpected("getInbox", error);
    return EMPTY_INBOX;
  }
}

/** The bell dropdown's shorter page. Same read, smaller limit. */
export async function getBellInbox(playerId: string): Promise<Inbox> {
  return getInbox(playerId, BELL_LIST_LIMIT);
}

/**
 * Every channel in force for this player, for every kind they may set —
 * defaults included, so the settings page can render without knowing which of
 * them came from a stored row.
 *
 * Fail-soft to the pure defaults: a settings page that cannot reach the database
 * should show what the site would do rather than refuse to render, and saving is
 * what will report the real failure.
 */
export async function getResolvedPrefs(
  playerId: string,
  kinds: NotificationKind[],
): Promise<Record<NotificationKind, NotificationChannel>> {
  let stored: Record<string, string> = {};
  try {
    stored = await notifications.prefsFor(playerId);
  } catch (error) {
    reportUnexpected("getResolvedPrefs", error);
  }

  const resolved = {} as Record<NotificationKind, NotificationChannel>;
  for (const kind of kinds) resolved[kind] = resolveChannel(kind, stored[kind]);
  return resolved;
}

/**
 * Whether the notifications schema is reachable, so a surface can stay silent
 * rather than rendering a convincingly empty bell.
 *
 * Deliberately a probe rather than a flag threaded out of every read: the reads
 * above already degrade to `EMPTY_INBOX`, and an empty inbox and an absent table
 * are indistinguishable from their return values alone. That ambiguity is the
 * whole reason this exists — the same argument `isChallengesReady` makes.
 */
export async function isNotificationsReady(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM notifications LIMIT 1`;
    return true;
  } catch (error) {
    if (isExpectedMissingSchema(error)) return false;
    // A real outage is NOT "not ready" — let the caller's own error handling
    // deal with it rather than mislabelling Neon being down as a missing
    // migration.
    throw error;
  }
}
