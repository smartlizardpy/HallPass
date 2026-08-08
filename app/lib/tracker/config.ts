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
