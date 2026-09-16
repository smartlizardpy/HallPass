/**
 * HallPass — the stems every auto-assigned player name is built from.
 *
 * Pure: an array and four total functions. No imports, no side effects, no DOM,
 * no `server-only`. That is what lets it be the ONE list, shared by every place
 * that mints a name or has to recognise one:
 *
 *   `sdk/src/handle.ts`             mints a guest's name in the browser
 *   `app/lib/scoreboard/guard.ts`   mints it server-side when none is submitted
 *   `app/lib/scoreboard/display-name.ts`  derives one for a signed-in player
 *
 * ── WHY THIS IS SHARED RATHER THAN COPIED ──────────────────────────────────
 *
 * The minter and the recogniser must agree EXACTLY. A generated name is longer
 * than the cap on typed input, so each sanitiser exempts it by matching it —
 * and a stem that one side can mint but the other cannot match would be
 * truncated on its way back through, renaming the player mid-session and, since
 * a guest is identified by their handle string, splitting them across two
 * leaderboard rows. Two lists free to drift is that bug waiting to happen, so
 * there is one list.
 *
 * It lives under `sdk/src/` because the browser SDK cannot import from `app/`,
 * while the server can and does import from here. It is deliberately NOT
 * re-exported from `sdk/src/index.ts`: it is shared implementation, not part of
 * the published `window.HallPass` surface.
 *
 * ── EDITING THE LIST ───────────────────────────────────────────────────────
 *
 * Add, remove or reorder freely — nothing is stored by index and no name is a
 * key, so the only effect is which name a given player shows next. Two rules
 * the tests enforce:
 *
 *   1. `[A-Za-z0-9]` ONLY. Anything else is stripped by the handle sanitisers,
 *      which would leave a minted name unable to match itself.
 *   2. At most {@link MAX_STEM_LENGTH} characters, so a full name stays inside
 *      the 24-character cap a player's chosen handle is held to and does not
 *      render as something no human could have typed.
 *
 * The register is deliberately silly. These are assigned TO children, so the
 * list stays clear of anything sexual, anatomical or slur-adjacent — that rules
 * out several otherwise-obvious entries in this genre.
 */

/** Longest stem permitted, leaving room for `#NNNN` inside a 24-char handle. */
export const MAX_STEM_LENGTH = 14;

/** Digits in the discriminator that follows the stem. */
export const NAME_DIGITS = 4;

/**
 * The stems, in no meaningful order. `SigmaAlphaMale` leads because it was the
 * whole list when this started and is the name already sitting in stored guest
 * handles; nothing depends on it being first.
 */
export const GENERATED_STEMS: readonly string[] = [
  "SigmaAlphaMale",
  "SkibidiToilet",
  "OhioFinalBoss",
  "RizzMaster",
  "GigaChad",
  "NPCEnergy",
  "BussinFr",
  "MewingMogger",
  "GoatedGamer",
  "DeluluDemon",
  "AuraFarmer",
  "SheeshLord",
  "FanumTax",
  "BackroomsKid",
  "GrimaceShake",
  "LowTaperFade",
  "BrainrotBoss",
  "YapMaster",
];

/**
 * Matches a name this codebase minted, and nothing else. Anchored, with the
 * stems alternated verbatim — they are plain alphanumerics, so no escaping is
 * needed and a test pins that.
 */
const GENERATED_NAME = new RegExp(
  `^(?:${GENERATED_STEMS.join("|")})#\\d{${NAME_DIGITS}}$`,
);

/** Is `value` exactly a name minted by {@link formatGeneratedName}? */
export function isGeneratedName(value: string): boolean {
  return GENERATED_NAME.test(value);
}

/**
 * Assemble a name from a stem and a number, zero-padding the discriminator so
 * the column does not jitter between `#42` and `#4821`. The number is taken
 * modulo the digit width, so any non-negative integer is usable as a seed.
 */
export function formatGeneratedName(stem: string, n: number): string {
  const modulus = 10 ** NAME_DIGITS;
  const digits = String(Math.abs(Math.trunc(n)) % modulus).padStart(NAME_DIGITS, "0");
  return `${stem}#${digits}`;
}

/**
 * The stem at `index`, wrapping. Negative and oversized indexes are folded
 * rather than rejected: every caller derives the index from a hash or a random
 * draw, and a name is a label — there is no input here worth failing over.
 */
export function stemAt(index: number): string {
  const count = GENERATED_STEMS.length;
  const safe = Math.abs(Math.trunc(index)) % count;
  return GENERATED_STEMS[safe];
}

/** A stem picked at random, for the one caller that mints rather than derives. */
export function randomStem(): string {
  return GENERATED_STEMS[Math.floor(Math.random() * GENERATED_STEMS.length)];
}
