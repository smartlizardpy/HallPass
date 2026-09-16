/**
 * HallPass — the name a SCOREBOARD row is published under.
 *
 * Pure: no IO, no `server-only`, no DOM. The store imports it while still taking
 * its `sql` as an argument, which is what keeps `store.test.ts` runnable without
 * a database — the same reason `reviews/store.ts` inlines its own copy of this
 * rule rather than importing `lib/players.ts`. This module exists so the two
 * scoreboard surfaces do not each get a copy that is free to disagree.
 *
 * The chain, in order:
 *
 *   1. the player's CHOSEN HANDLE — what they asked to be called;
 *   2. else `@username` — the unique public name their profile lives at;
 *   3. else {@link placeholderName} — a stable stand-in derived from their
 *      public id.
 *
 * `players.name` — the Google account name, for most players their REAL NAME —
 * is not in the chain and is not selected by the queries that feed it. That was
 * a real leak on the most public surface this site has; see `getTopScores`.
 *
 * ── WHY A PLACEHOLDER AND NOT "PLAYER" ─────────────────────────────────────
 *
 * A board of fifteen rows where four of them read "Player" tells the reader
 * nothing, and worse, reads as four entries by the same person. The placeholder
 * is stable per player and different between players, so the board stays legible
 * without anybody being named.
 */

/** The stem every generated placeholder is built from. */
export const PLACEHOLDER_STEM = "SigmaAlphaMale";

/** Digits in a placeholder's discriminator, zero-padded. */
const PLACEHOLDER_DIGITS = 4;

/**
 * A stable, non-identifying stand-in name for a player who has neither a chosen
 * handle nor a username: `SigmaAlphaMale#0417`.
 *
 * ── THE NUMBER COMES FROM `public_id`, AND ONLY FROM `public_id` ───────────
 *
 * That column is a random UUID which is already this codebase's wire identifier
 * for a player, so digits taken from it are public information the row was
 * carrying anyway, and they are stable for as long as the account is — the same
 * player is the same `#0417` on every board, every visit.
 *
 * NEVER `players.id`. That is the Google subject: a durable cross-site
 * identifier for a minor, which is why `ReviewRow`'s `#tag` is a SALTED hash of
 * it rather than the thing itself. No salt is needed here precisely because the
 * input is not sensitive — it is random and already published.
 *
 * The last hex digits are used rather than the first: a v4 UUID spends bits in
 * the middle on its version and variant, and the tail is the part that is purely
 * random.
 *
 * ── HONEST LIMITS ──────────────────────────────────────────────────────────
 *
 * Four digits is ten thousand values, so two nameless players sharing a number is
 * possible — likely somewhere on the site once a few hundred of them exist. That
 * is acceptable because this is a PLACEHOLDER, not an identity: it replaces
 * "Player", which collides with every other nameless player, and nothing in the
 * product treats it as a key.
 *
 * It is also not a claim of authenticity. A signed-in player may set a handle
 * that looks like one of these (`sanitizeHandle` in `lib/players.ts` caps at 24
 * characters, and this is 19), so a reader cannot conclude from the shape alone
 * that a row is unnamed. A GUEST cannot: anonymous handles are capped at 12
 * characters by `scoreboard/guard.ts`, which is shorter than the stem.
 *
 * Returns the bare "Player" when there is no usable id — unreachable in practice
 * (`public_id` is NOT NULL), and a generic name is a better answer there than a
 * fabricated number that would collide with a real one.
 */
export function placeholderName(publicId: string | null | undefined): string {
  const hex = typeof publicId === "string" ? publicId.replace(/-/g, "") : "";
  // 8 hex digits comfortably exceed the 4 decimal ones we keep, and stay inside
  // the range `parseInt` represents exactly.
  const tail = hex.slice(-8);
  if (tail.length < PLACEHOLDER_DIGITS || !/^[0-9a-f]+$/i.test(tail)) return "Player";

  const parsed = Number.parseInt(tail, 16);
  if (!Number.isFinite(parsed)) return "Player";

  const modulus = 10 ** PLACEHOLDER_DIGITS;
  const number = String(parsed % modulus).padStart(PLACEHOLDER_DIGITS, "0");
  return `${PLACEHOLDER_STEM}#${number}`;
}

/**
 * The published name for one scoreboard row belonging to a VERIFIED player.
 *
 * Anonymous rows never come through here: their handle is the guest's own
 * submission, already charset-clamped by `scoreboard/guard.ts`, and rewriting it
 * would be overwriting something a person actually typed.
 */
export function publicScoreName(player: {
  handle: string | null | undefined;
  username: string | null | undefined;
  publicId: string | null | undefined;
}): string {
  const handle = player.handle?.trim();
  if (handle) return handle;
  const username = player.username?.trim();
  if (username) return `@${username}`;
  return placeholderName(player.publicId);
}
