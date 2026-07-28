/**
 * HallPass — player identity store over Neon.
 *
 * A "player" is a verified Google identity used to TAG leaderboard scores. This
 * is a SEPARATE concern from `dashboard-users` (the dashboard access allow-list):
 * any Google account may be a player, and an admin is also a player. See
 * `app/lib/players.sql` for the `players` table this layer reads and writes.
 *
 * Like `dashboard-users.ts` (and unlike the scoreboard store's `createStore(sql)`
 * factory), this module talks to the shared, server-only `sql` from `@/app/lib/db`
 * directly.
 *
 * SQL safety — the load-bearing rule, carried over from the scoreboard store:
 *   The `neon()` tagged template parameterises interpolated VALUES; it does NOT
 *   reliably splice raw SQL fragments. So we NEVER interpolate a fragment
 *   variable — only ever BOUND values (`id`, `email`, `handle`, ...).
 *
 * Privacy invariant — the load-bearing rule of THIS module:
 *   `email` is stored (UNIQUE/NOT NULL, for dedup/support) but is NEVER exposed.
 *   The public projection {@link PlayerIdentity} is email-free by construction;
 *   only the server-side {@link Player} carries the address. Keep it that way.
 *
 * Identity keying: the PRIMARY KEY is the Google subject id (Auth.js `user.id` /
 * `profile.sub`), passed in as `id`. Emails are lowercased on the way in so the
 * UNIQUE constraint and any lookup stay canonical.
 *
 * Timestamp note: Postgres `timestamptz` columns come back from the HTTP driver
 * as strings; egress is funnelled through {@link toIso} so the surface of this
 * module is plain JSON-safe strings.
 */

import { sql } from "@/app/lib/db";

/** A player as stored server-side (carries `email` — never send this to clients). */
export interface Player {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  handle: string | null;
  createdAt: string;
  lastLogin: string | null;
}

/**
 * The PUBLIC projection of a player: email-free, with the effective display name
 * already resolved. `name` and `handle` both carry the effective display so a
 * consumer can use either field without re-deriving it.
 */
export interface PlayerIdentity {
  id: string;
  name: string;
  image: string | null;
  handle: string;
}

/** A row as returned by the driver (column names as keys). */
type Row = Record<string, unknown>;

/** Canonical email form used for every store/compare. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Coerce a driver timestamp to an ISO-ish string (falls back to `String`). */
function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** Max length of a stored/displayed handle, in characters. */
const HANDLE_MAX_LENGTH = 24;

/**
 * Reduce a free-form handle to a safe display string: trim, drop control
 * characters, collapse internal whitespace, and cap the length. Returns "" when
 * nothing usable remains (the caller then reverts the stored handle to NULL).
 */
function sanitizeHandle(raw: string): string {
  return raw
    // C0 and C1 control characters + DEL.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    // Zero-width and BOM characters — would render an invisible/blank handle.
    .replace(/[​-‍﻿]/g, "")
    // Bidirectional overrides/isolates — can visually reorder a public,
    // verified-badged leaderboard row.
    .replace(/[‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HANDLE_MAX_LENGTH)
    .trim();
}

/**
 * The effective DISPLAY name for a player: their chosen `handle` if set,
 * otherwise their Google `name`, otherwise a generic "Player". Both inputs are
 * trimmed; this is the single source of truth used by reads and by
 * {@link getPublicIdentity}.
 */
export function effectiveHandle(p: { handle: string | null; name: string | null }): string {
  return p.handle?.trim() || p.name?.trim() || "Player";
}

/**
 * The display name for a PUBLIC surface: the chosen handle, else "@username",
 * else a generic "Player".
 *
 * The difference from {@link effectiveHandle} is the whole point, and it is a
 * privacy difference, not a cosmetic one: `effectiveHandle` falls back to
 * `players.name`, which is the GOOGLE ACCOUNT NAME — for most people, their real
 * name. That fallback is fine on owner-facing surfaces (the account page, "signed
 * in as …"), where the viewer is the person themselves. It is not fine on a
 * profile page at a guessable URL, in a friends list, or beside a comment, where
 * it would publish a child's real name to anyone who can read the page.
 *
 * Use THIS on anything another player can see. Use `effectiveHandle` only where
 * the viewer is the owner.
 *
 * Known related gap, out of scope here: `getTopScores` in
 * `app/lib/scoreboard/store.ts` still falls back to the Google name on public
 * leaderboards, so real names are already published there today. Same bug, its
 * own fix.
 */
export function publicDisplayName(p: {
  handle: string | null;
  username: string | null;
}): string {
  const handle = p.handle?.trim();
  if (handle) return handle;
  const username = p.username?.trim();
  return username ? `@${username}` : "Player";
}

function mapPlayer(row: Row): Player {
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    image: row.image == null ? null : String(row.image),
    handle: row.handle == null ? null : String(row.handle),
    createdAt: toIso(row.created_at),
    lastLogin: row.last_login == null ? null : toIso(row.last_login),
  };
}

/**
 * Provision/refresh a player's row on sign-in. Profile fields (`email`, `name`,
 * `image`) and `last_login` are refreshed from the verified Google identity; the
 * player-chosen `handle` is NEVER touched — a login must not clobber a player's
 * deliberate display choice. Email is lowercased to keep the UNIQUE key canonical.
 */
export async function upsertPlayerOnLogin(p: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}): Promise<void> {
  const email = normalizeEmail(p.email);
  const name = p.name ?? null;
  const image = p.image ?? null;
  await sql`
    INSERT INTO players (id, email, name, image, last_login)
    VALUES (${p.id}, ${email}, ${name}, ${image}, now())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      image = EXCLUDED.image,
      last_login = now()
  `;
}

/** A single player by Google subject id, or `null` if unknown. */
export async function getPlayerById(id: string): Promise<Player | null> {
  const rows = await sql`
    SELECT id, email, name, image, handle, created_at, last_login
    FROM players
    WHERE id = ${id}
  `;
  return rows.length > 0 ? mapPlayer(rows[0]) : null;
}

/**
 * The PUBLIC, email-free identity for a player by id, with the effective display
 * resolved. Returns `null` for an unknown id. Use this anywhere an identity
 * crosses to a client/API surface — `getPlayerById` carries the email and must
 * stay server-side.
 */
export async function getPublicIdentity(id: string): Promise<PlayerIdentity | null> {
  const player = await getPlayerById(id);
  if (!player) return null;
  const display = effectiveHandle(player);
  return { id: player.id, name: display, image: player.image, handle: display };
}

/**
 * Set (or clear) a player's chosen handle. The input is sanitised to a safe
 * display string and capped; if nothing usable remains the handle is set to NULL
 * — reverting the effective display to the Google `name`. Both the bound handle
 * (or null) and `id` are interpolated as VALUES, never spliced.
 */
export async function setPlayerHandle(id: string, handle: string): Promise<void> {
  const clean = sanitizeHandle(handle);
  const next = clean.length > 0 ? clean : null;
  await sql`
    UPDATE players SET handle = ${next} WHERE id = ${id}
  `;
}

/**
 * The handle a deleted player's historical scores are rewritten to. Fits the
 * anonymous-submission charset in `scoreboard/guard.ts` (`[A-Za-z0-9 _#-]`, ≤12)
 * so it renders like any other leaderboard row.
 */
export const DELETED_PLAYER_HANDLE = "Deleted";

/**
 * Delete a player's identity row by Google subject id. Returns `true` if a row
 * was removed, `false` for an unknown id (the `RETURNING id` lets us distinguish
 * the two without a follow-up read). `id` is interpolated as a bound VALUE, never
 * spliced.
 *
 * Scores DE-TAG, they are NOT destroyed: `scores.player_id` references
 * `players(id)` with `ON DELETE SET NULL` (the FK added in
 * `migrations/002_player_identity.sql`), so deleting a player nulls the link on
 * each of their scores — their historical entries simply revert to ANONYMOUS
 * (the same state as a never-tagged score) rather than disappearing from the
 * leaderboard.
 *
 * ERASURE, and why the first statement is load-bearing:
 *   De-tagging alone does NOT erase the person. `scores.handle` is `TEXT NOT
 *   NULL` — a SNAPSHOT of the display name taken at submit time — and
 *   `getTopScores` falls back to it once `player_id` is null. For a player who
 *   never set a handle, that snapshot is their Google `name`, i.e. very often
 *   their REAL NAME. So "delete my account" used to leave the person's real name
 *   on every leaderboard they ever entered, permanently and unreachably (once
 *   `player_id` is null there is no key left to find those rows by). This rewrite
 *   is the only chance to do it.
 *
 * Order is deliberate and NOT interchangeable. The `neon()` HTTP driver has no
 * cross-statement transaction, so these two statements can interleave with a
 * failure. Anonymising FIRST means the worst case is "scores anonymised but the
 * account still exists" — recoverable, and the user can simply retry. Deleting
 * first would null every `player_id` and leave the real names permanently
 * orphaned with no key to reach them: an unrecoverable privacy failure.
 */
export async function deletePlayer(id: string): Promise<boolean> {
  await sql`
    UPDATE scores SET handle = ${DELETED_PLAYER_HANDLE} WHERE player_id = ${id}
  `;
  const rows = await sql`
    DELETE FROM players WHERE id = ${id} RETURNING id
  `;
  return rows.length > 0;
}
