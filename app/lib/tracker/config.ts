/**
 * HallPass — project tracker vocabulary.
 *
 * Mirrors `reviews/config.ts`, `beta/config.ts` and `scoreboard/config.ts`: pure,
 * no `server-only`, no database. Read by the store, the pages AND the server
 * actions, so the lanes the UI draws cannot drift from the values the CHECK
 * constraint in `021_tracker.sql` will accept.
 *
 * Whenever a value here changes, the matching CHECK in BOTH
 * `scoreboard/migrations/021_tracker.sql` and `tracker/schema.sql` changes with
 * it. `config.test.ts` asserts the invariants that a mismatch would break.
 */

import type { Role } from "@/app/lib/dashboard-users";

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/**
 * The role required by the two controls only the person building should hold.
 *
 * WHY THIS IS A CONSTANT AND NOT `"super_admin"` WRITTEN TWICE. A permission has
 * two halves that must agree: the guard the server action enforces, and the
 * condition the page renders the control under. Written out separately they
 * drift, and the drift is silent in the dangerous direction — a control that
 * still renders for somebody the action now refuses looks like a broken page,
 * and one the action still accepts after the control was hidden is an
 * unenforced rule that nobody notices until it matters. Both halves import from
 * here, so there is one fact.
 *
 * `import type` keeps this module pure: `Role` is erased at compile time, so
 * config still pulls in no database and no `server-only`.
 */
export const TRACKER_DEV_ROLE = "super_admin" as const;

/**
 * May this role move an item between lanes?
 *
 * Status is super-admin-only while everything else on the board is not, and the
 * asymmetry is deliberate. Briefs, tags and progress notes are collaborative —
 * the board exists so somebody can paste in what they want built. The STATUS is
 * a claim about the work itself ("this is being built right now", "this is
 * live"), and only the person actually building it can make that claim
 * truthfully. It is also the one field the database ties to another:
 * `tracker_items_done_at_matches_status` rewrites `done_at` on every move in and
 * out of a terminal lane.
 */
export function canMoveStatus(role: Role): boolean {
  return role === TRACKER_DEV_ROLE;
}

/**
 * May this role permanently delete an item?
 *
 * Distinct from archiving, which stays open to every admin: an archive is one
 * click from being undone and keeps the brief, the notes and the trail, so
 * sharing it costs nothing. A delete is unrecoverable — the row goes, and
 * `tracker_item_tags` and `tracker_updates` CASCADE away with it.
 */
export function canDeleteItem(role: Role): boolean {
  return role === TRACKER_DEV_ROLE;
}

/**
 * Where an item sits, worst-to-best left to right on the board.
 *
 * This array IS the lane order — the board maps over it — so it is ordered for
 * reading, not alphabetically.
 *
 * Deliberately worded for the person READING the board rather than the person
 * building. `parked` and `declined` are separate values and that is the sharpest
 * decision here: collapsing them destroys the one answer this board exists to
 * give — "we still want it" versus "we already said no" — and without it the
 * same request gets pasted in again every few months.
 */
export const TRACKER_STATUSES = [
  "new",
  "planned",
  "building",
  "shipped",
  "parked",
  "declined",
] as const;

export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

/**
 * Statuses that mean the work is finished, one way or the other.
 *
 * MUST match the `tracker_items_done_at_matches_status` CHECK exactly: the
 * database enforces `status IN (terminal) = (done_at IS NOT NULL)`, so a value
 * added here without being added there produces an insert that fails at runtime
 * on a screen nobody tested. `config.test.ts` pins the pair.
 */
export const TERMINAL_STATUSES = ["shipped", "declined"] as const;

/** True when `status` stamps `done_at`. */
export function isTerminalStatus(status: TrackerStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Lane heading. */
export const STATUS_LABEL: Record<TrackerStatus, string> = {
  new: "New",
  planned: "Planned",
  building: "Building",
  shipped: "Shipped",
  parked: "Parked",
  declined: "Declined",
};

/**
 * What each lane promises the reader, shown under the heading.
 *
 * These are load-bearing rather than decorative: the difference between `parked`
 * and `declined` only exists if both are explained on the screen where somebody
 * chooses between them.
 */
export const STATUS_HINT: Record<TrackerStatus, string> = {
  new: "Pasted in, not looked at yet",
  planned: "Agreed and queued",
  building: "Being built right now",
  shipped: "Live on the site",
  parked: "Not now, still want it",
  declined: "Not doing this",
};

/**
 * Tailwind classes per lane chip. Written out in full because Tailwind v4 scans
 * source text for class names — a template-built string like
 * `bg-${tone}-100` is not in the output CSS and silently renders unstyled.
 */
export const STATUS_CHIP_CLASS: Record<TrackerStatus, string> = {
  new: "bg-surface-2 text-muted",
  planned: "bg-blue-100 text-blue-800",
  building: "bg-amber-100 text-amber-900",
  shipped: "bg-emerald-100 text-emerald-800",
  parked: "bg-surface-2 text-muted",
  declined: "bg-rose-100 text-rose-800",
};

/** Default for a freshly pasted item. Matches the column DEFAULT. */
export const DEFAULT_STATUS: TrackerStatus = "new";

/** Narrow an untrusted string (a form field) to a status, or `null`. */
export function toStatus(value: unknown): TrackerStatus | null {
  return (TRACKER_STATUSES as readonly string[]).includes(String(value))
    ? (value as TrackerStatus)
    : null;
}

// ---------------------------------------------------------------------------
// Lengths — each mirrors a CHECK constraint
// ---------------------------------------------------------------------------

export const TITLE_MAX = 140;

/**
 * Brief length cap.
 *
 * Generous on purpose. "Paste in the details" means somebody will drop a whole
 * spec, a chat log or a bullet list in here, and hitting a limit at that exact
 * moment is how a tool stops being used. The cost of a long brief is a taller
 * page; the cost of a short cap is that the tracker does not get used.
 */
export const BRIEF_MAX = 20000;

export const UPDATE_BODY_MAX = 4000;

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Mirrors the `tracker_item_tags_format` CHECK. Free-form rather than a fixed
 * enum, because the useful labels here are not predictable in advance (`pwa`,
 * `mobile`, `stealth`, `perf`, `needs-art`) and a fixed set would need somebody
 * to maintain it.
 */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;

/** How many tags one item may carry. A cap, not a target. */
export const MAX_TAGS_PER_ITEM = 8;

/**
 * Normalise one free-typed tag: trim, lowercase, collapse whitespace and
 * underscores to hyphens, drop anything else, and squeeze repeated hyphens.
 *
 * Done in code rather than left to the CHECK because the CHECK's only move is to
 * reject the whole write. Somebody typing "Needs Art" means `needs-art`, and
 * failing their paste over a capital letter is the wrong trade.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
    // A trailing hyphen can reappear after the slice.
    .replace(/-$/, "");
  return TAG_PATTERN.test(tag) ? tag : null;
}

/**
 * Parse a comma- or newline-separated tag field into a clean, deduplicated,
 * capped list. Invalid fragments are dropped rather than failing the submit —
 * see {@link normalizeTag}.
 *
 * Splits on commas and newlines but NOT spaces, which is the whole reason
 * {@link normalizeTag} turns whitespace into hyphens: someone typing
 * "needs art, mobile" means two tags, `needs-art` and `mobile`. Splitting on
 * spaces would silently give them three, one of which is `art`.
 */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]+/)) {
    const tag = normalizeTag(part);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS_PER_ITEM) break;
  }
  return [...seen];
}
