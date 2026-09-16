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
 *      public id, drawn from the shared stem list in `sdk/src/names.ts`.
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

import {
  GENERATED_STEMS,
  NAME_DIGITS,
  formatGeneratedName,
  stemAt,
} from "@/sdk/src/names";

/**
 * Re-exported so callers in this folder keep importing the name rule from one
 * place. The list itself lives in `sdk/src/names.ts` — see there for why it is
 * shared with the browser SDK rather than copied.
 */
export { GENERATED_STEMS };

/**
 * A stable, non-identifying stand-in name for a player who has neither a chosen
 * handle nor a username: `AuraFarmer#0417`, `SkibidiToilet#1194`, and so on.
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
 * Four digits across {@link GENERATED_STEMS} is tens of thousands of names, so
 * two nameless players sharing one is possible. That is acceptable because this
 * is a PLACEHOLDER, not an identity: it replaces "Player", which collided with
 * every other nameless player, and nothing in the product treats it as a key.
 *
 * It is also not a claim of authenticity. A signed-in player may set a handle
 * that looks like one of these (`sanitizeHandle` in `lib/players.ts` caps at 24
 * characters, and the longest of these is 19), so a reader cannot conclude from
 * the shape alone that a row is unnamed. A guest cannot type one that long:
 * anonymous handles are capped at 12 characters by `scoreboard/guard.ts`.
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
  if (tail.length < NAME_DIGITS || !/^[0-9a-f]+$/i.test(tail)) return "Player";

  const number = Number.parseInt(tail, 16);
  if (!Number.isFinite(number)) return "Player";

  // THE STEM AND THE NUMBER COME FROM DIFFERENT ENDS of the id, so they vary
  // independently. Deriving both from one slice would make two players who
  // collide on the number collide on the whole name; this way they usually
  // differ in one or the other.
  const head = hex.slice(0, 8);
  const seed = /^[0-9a-f]+$/i.test(head) ? Number.parseInt(head, 16) : number;

  return formatGeneratedName(stemAt(seed), number);
}

/**
 * The shape the guest generator minted BEFORE it shared a stem with the
 * signed-in placeholder. Four digits exactly, which is all it ever produced.
 */
const LEGACY_GUEST = /^Guest#(\d{4})$/;

/**
 * The published name for one ANONYMOUS row: the guest's own stored handle,
 * except that a name the OLD generator minted is re-stemmed on the way out.
 *
 * ── WHY THIS IS A RENDERING RULE AND NOT A MIGRATION ──────────────────────
 *
 * `scores.handle` is not merely a label for a guest row: it IS that guest's
 * identity. `getTopScores` dedupes anonymous rows by `'g:' || s.handle`, and the
 * SDK persists the same string in `localStorage` and resends it with every later
 * score. Rewriting the stored value — in the database or in the browser — would
 * therefore split one guest across two identities: their old scores under
 * `Guest#1053` and their new ones under `DeluluDemon#1053`, as two rows on
 * one board wearing the same name. Renaming only the OUTPUT leaves the identity
 * exactly where it was.
 *
 * THE NUMBER IS KEPT. It is the only thing distinguishing one guest from
 * another, and a returning player who was `#1053` last week is still `#1053`.
 *
 * Only an anonymous row goes through here. A signed-in player who deliberately
 * chose `Guest#1053` as their handle keeps it verbatim — they typed it, and this
 * function never sees it.
 */
export function publicGuestName(storedHandle: string): string {
  const match = LEGACY_GUEST.exec(storedHandle.trim());
  if (!match) return storedHandle;
  // The stem is derived FROM THE NUMBER, not drawn at random: this runs on every
  // render, and a random pick would rename the same row on every page load.
  const number = Number(match[1]);
  return formatGeneratedName(stemAt(number), number);
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
