/**
 * HallPass — the advanced-Vercel-Blob-operation registry and its kill switches.
 *
 * ── WHAT AN "ADVANCED OPERATION" IS ─────────────────────────────────────────
 * Vercel meters Blob usage in two classes with very different allowances. On
 * Hobby: 10,000 SIMPLE operations a month (`head`, `del`) and only 2,000
 * ADVANCED ones (`put`, `copy`, `list`). Advanced is the scarce one, and it is
 * the one that takes the whole publishing surface down with it — when the
 * allowance is spent, `put()` fails, so no game can be uploaded, no screenshot
 * accepted and no cover cached until the month rolls over.
 *
 * `app/lib/game-blob-index.ts` removed the recurring spend: the `list()` over
 * `games/**` was 98% of it and is now a Neon table. What is left is a `put` or a
 * `copy` per file a human deliberately publishes — small, but not zero, and not
 * something a deploy should be needed to stop.
 *
 * ── WHAT THIS MODULE IS ─────────────────────────────────────────────────────
 * A registry of every feature that still spends an advanced operation, plus a
 * per-feature switch a super admin flips from `/dashboard/blob`. Turning one off
 * makes its action refuse cleanly, BEFORE it touches Blob, with a banner saying
 * what was turned off and where to turn it back on — instead of letting an admin
 * hit a raw "operation limit exceeded" from the store mid-upload.
 *
 * ADDING A FEATURE THAT SPENDS AN ADVANCED OPERATION MEANS ADDING IT HERE. The
 * registry is what the settings page renders and what the "disable everything"
 * button iterates, so an unlisted feature is one nobody can turn off in the
 * month they need to.
 *
 * ── THE ENV LOCK, FOR WHEN THE DATABASE IS NOT AN OPTION ────────────────────
 * The switches live in `app_settings`, which means they need migration 026 to
 * have been applied — and the moment you most want to stop spending is a moment
 * when running a migration may not be possible. `BLOB_READ_ONLY=1` in the
 * environment forces EVERY switch off without reading the database at all, so a
 * deploy is the only thing between an operator and a hard stop.
 *
 * It is a LOCK, not a default: it beats whatever the table says, and while it is
 * set the dashboard's toggles are inert and say so rather than pretending to
 * write. Unset it (and redeploy) to hand control back to the table.
 *
 * ── THE FAIL-SOFT DIRECTION, AND WHY IT IS THIS ONE ─────────────────────────
 * A switch that cannot be read reads as ENABLED. Neon being unreachable must not
 * silently freeze the entire admin surface behind a message claiming somebody
 * turned it off; the operator would be hunting a setting nobody set. The cost of
 * that choice is honest and small: during a database outage a disabled feature
 * may spend an operation it was told not to, and the admin sees Blob's own error
 * rather than ours — which is exactly what they would have seen before this
 * module existed.
 */

import "server-only";
import {
  APP_SETTINGS_CACHE_TAG,
  readAppSettings,
  writeAppSetting,
  writeAppSettings,
} from "@/app/lib/app-settings";

/** Every feature that spends an advanced Blob operation. */
export type BlobOpId =
  | "game_source"
  | "game_media"
  | "external_covers"
  | "beta_shots"
  | "beta_clips"
  | "shot_promotion"
  | "blob_reindex";

export type AdvancedBlobOp = {
  id: BlobOpId;
  /** What the settings page calls it. */
  label: string;
  /** The Vercel primitive it spends, named so the page can group by cost. */
  operation: "put" | "copy" | "list";
  /** What it does, and therefore what stops when it is off. */
  effect: string;
  /** How the spend scales — the number that decides what to turn off first. */
  cost: string;
  /** The banner the gated action shows when it refuses. */
  disabledMessage: string;
};

/**
 * The registry, ordered by how much an operator is likely to want it OFF first:
 * the bulk spenders at the top, the recovery tool last.
 *
 * `blob_reindex` is in here even though it is the tool that FIXES a drifted
 * index, because "disable everything" has to mean everything when the allowance
 * reads zero — a `list()` that is going to fail is not worth attempting. It is
 * also the one entry an operator should turn back on first.
 */
export const ADVANCED_BLOB_OPS: readonly AdvancedBlobOp[] = [
  {
    id: "game_source",
    label: "Game source publishing",
    operation: "put",
    effect:
      "Uploading, pasting or bundling a game's HTML from the game control center.",
    cost: "One operation per file. A multi-file bundle spends one per file — a 300-file zip is 300.",
    disabledMessage:
      "Game source publishing is switched off to conserve Blob operations. A super admin can re-enable it in Dashboard → Blob ops.",
  },
  {
    id: "game_media",
    label: "Game media uploads",
    operation: "put",
    effect: "Adding a screenshot or hero image to a game's store gallery.",
    cost: "One operation per image, up to 8 per game.",
    disabledMessage:
      "Media uploads are switched off to conserve Blob operations. A super admin can re-enable them in Dashboard → Blob ops.",
  },
  {
    id: "beta_clips",
    label: "Beta replay clips",
    operation: "put",
    effect:
      "Attaching a recorded replay to a beta report. Testers can still file reports without one.",
    cost: "One operation per clip, uploaded straight from the browser.",
    disabledMessage:
      "Replay clips are switched off right now. Your report will still be filed — just without the recording.",
  },
  {
    id: "beta_shots",
    label: "Beta screenshot evidence",
    operation: "put",
    effect:
      "Attaching a screenshot to a beta report, and submitting a standalone shot.",
    cost: "One operation per image.",
    disabledMessage:
      "Screenshot uploads are switched off right now. Your report will still be filed — just without the image.",
  },
  {
    id: "external_covers",
    label: "External game cover caching",
    operation: "put",
    effect:
      "Re-hosting a registered external game's cover image on our own blob store.",
    cost: "One operation per external game created or re-cached.",
    disabledMessage:
      "Cover caching is switched off to conserve Blob operations. The game keeps its placeholder cover; re-cache it later from Dashboard → Blob ops.",
  },
  {
    id: "shot_promotion",
    label: "Promote beta shots to the gallery",
    operation: "copy",
    effect:
      "Copying an accepted beta screenshot into a game's public gallery. Accepting a shot still pays its XP.",
    cost: "One operation per promoted shot.",
    disabledMessage:
      "Promoting shots to the gallery is switched off to conserve Blob operations. The shot stays accepted and can be promoted once it is re-enabled.",
  },
  {
    id: "blob_reindex",
    label: "Rebuild the blob index",
    operation: "list",
    effect:
      "Resynchronising the Neon mirror of games/** from the object store. The only list() left in the app.",
    cost: "One operation per page of results — a few per sweep. Manual, never on a request path.",
    disabledMessage:
      "The reindex sweep is switched off. Re-enable it below before rebuilding the index.",
  },
] as const;

/** The registry keyed by id, for O(1) lookup from a gated action. */
const BY_ID = new Map(ADVANCED_BLOB_OPS.map((op) => [op.id, op]));

/** The `app_settings` key holding one switch. */
function settingKey(id: BlobOpId): string {
  return `blob_op:${id}`;
}

/**
 * Values of `BLOB_READ_ONLY` that mean "on".
 *
 * An explicit allow-list rather than JS truthiness, because the string "0" and
 * the string "false" are both truthy in JavaScript and both obviously mean off
 * to the person typing them into Vercel's env editor. Anything unrecognised —
 * including empty and unset — is off, so a typo fails OPEN and leaves the
 * database in charge rather than silently freezing publishing.
 */
const READ_ONLY_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Whether the environment forces read-only mode.
 *
 * Synchronous and database-free ON PURPOSE: that is the whole point of it — it
 * has to work on a deployment whose migrations have not run, or whose Neon is
 * unreachable. Read per call rather than captured at module scope so a value
 * injected per cold start is picked up without reasoning about import order.
 *
 * Vercel materialises env vars at deploy time, so changing this takes effect on
 * the next deployment, not the next request.
 */
export function isBlobReadOnly(): boolean {
  return READ_ONLY_VALUES.has(
    (process.env.BLOB_READ_ONLY ?? "").trim().toLowerCase(),
  );
}

/** What the dashboard tells a super admin whose toggles are locked out. */
export const BLOB_READ_ONLY_NOTICE =
  "BLOB_READ_ONLY is set in the environment, so every advanced-blob feature is forced off and these switches cannot be changed. Remove the variable and redeploy to hand control back to the settings table.";

/**
 * The state of every switch at once — what the dashboard renders, what its form
 * posts back, and what a save is diffed against.
 *
 * Total over the registry on purpose: a partial record would make "absent" mean
 * both "unchanged" and "off" depending on who was reading it, which is exactly
 * the confusion the checkbox form below would otherwise introduce.
 */
export type BlobOpSwitches = Record<BlobOpId, boolean>;

/** Every switch set the same way — what the "disable everything" submit asks for. */
export function allBlobOpSwitches(enabled: boolean): BlobOpSwitches {
  const state = {} as BlobOpSwitches;
  for (const op of ADVANCED_BLOB_OPS) state[op.id] = enabled;
  return state;
}

/**
 * Decode what the dashboard's checkbox form posted: PRESENT MEANS ON, ABSENT
 * MEANS OFF.
 *
 * That is the browser's own rule — an unchecked checkbox submits nothing — and
 * it is only safe to read it that way because the registry is a closed set the
 * server already knows. Every id gets an answer here, so a switch the operator
 * turned off is genuinely "off" rather than "not mentioned", and there is no
 * hidden-input twin per row to keep in sync with its checkbox.
 *
 * Unknown ids are dropped rather than trusted, for the same reason the old
 * single-switch action narrowed its `id`: a hand-crafted POST must not be able
 * to write arbitrary `blob_op:<anything>` keys into `app_settings`.
 */
export function switchesFromEnabledIds(ids: Iterable<string>): BlobOpSwitches {
  const on = new Set(ids);
  const state = {} as BlobOpSwitches;
  for (const op of ADVANCED_BLOB_OPS) state[op.id] = on.has(op.id);
  return state;
}

/**
 * Every switch, defaulting to enabled for any key that has never been written.
 * Fail-soft to all-enabled via `readAppSettings()` — see the module docblock for
 * why that is the right direction.
 */
export async function readBlobOpSwitches(): Promise<BlobOpSwitches> {
  const state = {} as BlobOpSwitches;

  // The env lock short-circuits BEFORE the database read, not after it. That is
  // not an optimisation: the situation it exists for is one where `app_settings`
  // may not exist yet, so a lock that had to query first would be a lock that
  // could not be trusted in the only case it is for.
  if (isBlobReadOnly()) {
    for (const op of ADVANCED_BLOB_OPS) state[op.id] = false;
    return state;
  }

  const settings = await readAppSettings();
  for (const op of ADVANCED_BLOB_OPS) {
    // Anything other than an explicit "0" is on: an unwritten key, and a value
    // some future writer got wrong, both mean "nobody turned this off".
    state[op.id] = settings.get(settingKey(op.id)) !== "0";
  }
  return state;
}

/**
 * Whether one feature may spend its advanced operation.
 *
 * Call this IMMEDIATELY BEFORE the Blob call and nowhere else — checking it at
 * the top of an action would let a long-running upload sail past a switch thrown
 * while it was reading the file, and checking it in the UI only would leave the
 * action itself ungated.
 */
export async function isBlobOpEnabled(id: BlobOpId): Promise<boolean> {
  return (await readBlobOpSwitches())[id] ?? true;
}

/** One switch that moves in a save, carrying the registry entry that names it. */
export type BlobOpChange = {
  op: AdvancedBlobOp;
  /** The state being written — `true` for on. */
  enabled: boolean;
};

/**
 * Which switches a save actually moves, in registry order.
 *
 * THE POINT OF DIFFING RATHER THAN WRITING THE WHOLE PANEL. A batch form knows
 * the state of all seven switches, so the lazy implementation writes all seven
 * every time — and then two super admins with the page open at once clobber each
 * other: the second save re-asserts a baseline it loaded before the first one
 * happened, silently undoing it. Writing only the rows that moved means two
 * operators touching different features do not fight, and the banner can name
 * exactly what changed instead of claiming credit for five untouched rows.
 *
 * Ordering follows `ADVANCED_BLOB_OPS` so the banner reads in the same order as
 * the page, rather than in whatever order a form serialised its fields.
 */
export function diffBlobOpSwitches(
  current: BlobOpSwitches,
  desired: BlobOpSwitches,
): BlobOpChange[] {
  const changes: BlobOpChange[] = [];
  for (const op of ADVANCED_BLOB_OPS) {
    // `current` comes from a read that fails soft to all-enabled, so a switch
    // missing from it reads as ON — the same direction every other reader takes.
    if ((current[op.id] ?? true) !== desired[op.id]) {
      changes.push({ op, enabled: desired[op.id] });
    }
  }
  return changes;
}

/** The refusal banner for a switched-off feature. */
export function blobOpDisabledMessage(id: BlobOpId): string {
  return (
    BY_ID.get(id)?.disabledMessage ??
    "That feature is switched off to conserve Blob operations."
  );
}

// ---------------------------------------------------------------------------
// Mutations — uncached. Callers `updateTag(APP_SETTINGS_CACHE_TAG)`.
// ---------------------------------------------------------------------------

/** Re-exported so the settings actions have one import site for everything. */
export { APP_SETTINGS_CACHE_TAG };

/** Turn one feature on or off. THROWS so a failed save is never reported as done. */
export async function setBlobOpEnabled(
  id: BlobOpId,
  enabled: boolean,
  actor: string | null,
): Promise<void> {
  await writeAppSetting(settingKey(id), enabled ? "1" : "0", actor);
}

/**
 * Turn EVERY feature on or off in one statement — the panic button for the day
 * the allowance reads 100%, and the single click that undoes it afterwards.
 */
export async function setAllBlobOps(
  enabled: boolean,
  actor: string | null,
): Promise<void> {
  await writeAppSettings(
    ADVANCED_BLOB_OPS.map((op) => [settingKey(op.id), enabled ? "1" : "0"] as const),
    actor,
  );
}
