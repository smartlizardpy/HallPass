/**
 * HallPass — collectibles store. Every statement collectibles runs.
 *
 * A factory over an injected `sql` (the house pattern: `createChampionshipStore`),
 * so tests pass a fake and the barrel binds the live Neon client. No
 * `server-only` import here for the same reason; the barrel has it.
 *
 * ONE STATEMENT PER CHANGE, ONE TRANSACTION FOR THE OPENING. The Neon HTTP driver
 * cannot hold a transaction open across calls, so every write is a single
 * statement whose WHERE clause is its own guard, and every admin change writes its
 * `collectibles_log` row in the same statement (a data-modifying CTE). The one
 * exception is `openPack`, which uses `sql.transaction([...])` (one HTTP request,
 * one Postgres transaction) so that an advisory lock on the player is held while
 * the opening statement computes `was_new`.
 *
 * THE OPENING IS THE ONLY PLACE CONTENTS EXIST. A grant is a cheap idempotent
 * insert. Contents are rolled here, in TypeScript with the crypto RNG, from the
 * version the grant PINNED, then written together with `opened_at` in one
 * statement. A pack cannot be opened without its pulls, and pulls cannot exist
 * without an opened pack. An opened pack IS its pulls, so a refresh, a retry, a
 * closed tab or a second device all just re-read them.
 *
 * THE DATABASE CLOCK DECIDES. Every timestamp is `now()` in the statement.
 *
 * PRIVACY. Player rows are selected for `public_id`, `handle`, `username` and the
 * meme-avatar choice only. Never `name`, `email` or `image` (the Google name is
 * often a child's real name).
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { memeAvatarFor } from "../avatars";
import { publicScoreName } from "../scoreboard/display-name";
import { CATALOGUE, currentVersion, getCollectible, getPack, packVersion } from "./catalogue";
import { rollPack, type RandomInt } from "./catalogue/roll";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_FEATURED = 6;
export const PACK_SOURCES = ["championship", "admin", "event"] as const;
export type PackSource = (typeof PACK_SOURCES)[number];

const toIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export interface PlayerPack {
  /** The only id that goes on the wire. */
  publicId: string;
  packId: string;
  packVersion: number;
  source: PackSource;
  grantedAt: string;
  openedAt: string | null;
  revokedAt: string | null;
}

export interface Pull {
  slot: number;
  collectibleId: string;
  wasNew: boolean;
}

export interface OpenedPack {
  pack: PlayerPack;
  pulls: Pull[];
}

export type OpenResult =
  | { status: "ok"; alreadyOpened: boolean; pack: PlayerPack; pulls: Pull[] }
  | { status: "not-found" }
  | { status: "revoked" };

export interface BinderEntry {
  collectibleId: string;
  /** Unrevoked copies owned. */
  owned: number;
  firstPulledAt: string;
  favourite: boolean;
  featuredPosition: number | null;
  /** True until the player has seen the card in their binder. */
  isNew: boolean;
}

export interface PrefsResult {
  favourite: boolean;
  featuredPosition: number | null;
}

export interface GrantInput {
  playerId: string;
  packId: string;
  /** The idempotency key. Callers own their scheme, e.g. `fright-fest-2026:overall:<player>`. */
  grantKey: string;
  source: PackSource;
  sourceRef?: string | null;
  grantedBy?: string | null;
  /** Defaults to the pack's current version. A grant pins it. */
  packVersion?: number;
}

export interface AdminLogEntry {
  id: number;
  actorEmail: string;
  action: string;
  publicId: string | null;
  name: string | null;
  reason: string;
  data: unknown;
  createdAt: string;
}

export interface ShowcasePlayer {
  playerId: string;
  publicId: string;
  name: string;
  avatar: string;
}

/** A reason an admin typed: required, trimmed, at most 500 characters. */
export function cleanReason(reason: string): string {
  const r = reason.trim();
  if (!r || r.length > 500) throw new Error("A reason of 1 to 500 characters is required");
  return r;
}

const mapPack = (r: Row): PlayerPack => ({
  publicId: String(r.public_id),
  packId: String(r.pack_id),
  packVersion: Number(r.pack_version),
  source: (PACK_SOURCES as readonly string[]).includes(String(r.source)) ? (r.source as PackSource) : "event",
  grantedAt: toIso(r.granted_at)!,
  openedAt: toIso(r.opened_at),
  revokedAt: toIso(r.revoked_at),
});

const mapPull = (r: Row): Pull => ({ slot: Number(r.slot), collectibleId: String(r.collectible_id), wasNew: r.was_new === true });

export function createCollectiblesStore(sql: Sql) {
  /** The player's pack by public id, or `null` when it is not theirs (or does not exist). */
  async function readPack(playerId: string, publicId: string): Promise<PlayerPack | null> {
    if (!UUID_RE.test(publicId)) return null;
    const rows = (await sql`
      SELECT pp.public_id, pp.pack_id, pp.pack_version, pp.source, pp.granted_at, pp.opened_at, pp.revoked_at
      FROM player_packs pp
      WHERE pp.public_id = ${publicId}::uuid AND pp.player_id = ${playerId}
    `) as Row[];
    return rows[0] ? mapPack(rows[0]) : null;
  }

  /** The stored pulls of one of the player's packs, in slot order. */
  async function readPulls(playerId: string, publicId: string): Promise<Pull[]> {
    const rows = (await sql`
      SELECT c.slot, c.collectible_id, c.was_new
      FROM collectible_pulls c JOIN player_packs pp ON pp.id = c.player_pack_id
      WHERE pp.public_id = ${publicId}::uuid AND pp.player_id = ${playerId}
      ORDER BY c.slot
    `) as Row[];
    return rows.map(mapPull);
  }

  /**
   * Grant a pack, once per `grantKey`: `ON CONFLICT (grant_key) DO NOTHING`, then
   * a re-read says `created: false` for the repeat. The grant pins a pack
   * version; nothing is rolled here.
   */
  async function grantPack(input: GrantInput): Promise<{ created: boolean; pack: PlayerPack }> {
    const def = getPack(input.packId);
    if (!def) throw new Error(`Unknown pack "${input.packId}"`);
    const version = input.packVersion ?? currentVersion(def).v;
    if (!packVersion(input.packId, version)) throw new Error(`Unknown version ${version} of pack "${input.packId}"`);
    const rows = (await sql`
      INSERT INTO player_packs (player_id, pack_id, pack_version, grant_key, source, source_ref, granted_by)
      VALUES (${input.playerId}, ${input.packId}, ${version}, ${input.grantKey}, ${input.source},
              ${input.sourceRef ?? null}, ${input.grantedBy ?? null})
      ON CONFLICT (grant_key) DO NOTHING
      RETURNING public_id, pack_id, pack_version, source, granted_at, opened_at, revoked_at
    `) as Row[];
    if (rows[0]) return { created: true, pack: mapPack(rows[0]) };
    const again = (await sql`
      SELECT pp.public_id, pp.pack_id, pp.pack_version, pp.source, pp.granted_at, pp.opened_at, pp.revoked_at
      FROM player_packs pp WHERE pp.grant_key = ${input.grantKey}
    `) as Row[];
    if (!again[0]) throw new Error("grant_key conflicted but no row was found");
    return { created: false, pack: mapPack(again[0]) };
  }

  /** An admin grant: the pack and its `collectibles_log` row in one statement. The reason is required. */
  async function adminGrantPack(input: GrantInput & { actorEmail: string; reason: string }): Promise<{ created: boolean; pack: PlayerPack }> {
    const reason = cleanReason(input.reason);
    const def = getPack(input.packId);
    if (!def) throw new Error(`Unknown pack "${input.packId}"`);
    const version = input.packVersion ?? currentVersion(def).v;
    if (!packVersion(input.packId, version)) throw new Error(`Unknown version ${version} of pack "${input.packId}"`);
    const rows = (await sql`
      WITH ins AS (
        INSERT INTO player_packs (player_id, pack_id, pack_version, grant_key, source, source_ref, granted_by)
        VALUES (${input.playerId}, ${input.packId}, ${version}, ${input.grantKey}, 'admin',
                ${input.sourceRef ?? null}, ${input.actorEmail})
        ON CONFLICT (grant_key) DO NOTHING
        RETURNING id, player_id, public_id, pack_id, pack_version, source, granted_at, opened_at, revoked_at
      ), log AS (
        INSERT INTO collectibles_log (actor_email, action, player_id, player_pack_id, reason, data)
        SELECT ${input.actorEmail}, 'grant-pack', ins.player_id, ins.id, ${reason},
               json_build_object('packId', ins.pack_id, 'packVersion', ins.pack_version, 'grantKey', ${input.grantKey}::text)::jsonb
        FROM ins
        RETURNING id
      )
      SELECT ins.public_id, ins.pack_id, ins.pack_version, ins.source, ins.granted_at, ins.opened_at, ins.revoked_at FROM ins
    `) as Row[];
    if (rows[0]) return { created: true, pack: mapPack(rows[0]) };
    const again = (await sql`
      SELECT pp.public_id, pp.pack_id, pp.pack_version, pp.source, pp.granted_at, pp.opened_at, pp.revoked_at
      FROM player_packs pp WHERE pp.grant_key = ${input.grantKey}
    `) as Row[];
    if (!again[0]) throw new Error("grant_key conflicted but no row was found");
    return { created: false, pack: mapPack(again[0]) };
  }

  /** The player's sealed packs (unopened, unrevoked), oldest first. */
  async function listSealed(playerId: string): Promise<PlayerPack[]> {
    const rows = (await sql`
      SELECT pp.public_id, pp.pack_id, pp.pack_version, pp.source, pp.granted_at, pp.opened_at, pp.revoked_at
      FROM player_packs pp
      WHERE pp.player_id = ${playerId} AND pp.opened_at IS NULL AND pp.revoked_at IS NULL
      ORDER BY pp.granted_at, pp.id
    `) as Row[];
    return rows.map(mapPack);
  }

  /** The player's most recent openings with their pulls, newest first. */
  async function listOpened(playerId: string, limit = 10): Promise<OpenedPack[]> {
    const rows = (await sql`
      SELECT pp.public_id, pp.pack_id, pp.pack_version, pp.source, pp.granted_at, pp.opened_at, pp.revoked_at,
             COALESCE(
               (SELECT json_agg(json_build_object('slot', c.slot, 'collectible_id', c.collectible_id, 'was_new', c.was_new)
                                ORDER BY c.slot)
                  FROM collectible_pulls c WHERE c.player_pack_id = pp.id),
               '[]'::json
             ) AS pulls
      FROM player_packs pp
      WHERE pp.player_id = ${playerId} AND pp.opened_at IS NOT NULL
      ORDER BY pp.opened_at DESC, pp.id DESC
      LIMIT ${limit}
    `) as Row[];
    return rows.map((r) => ({
      pack: mapPack(r),
      pulls: (Array.isArray(r.pulls) ? (r.pulls as Row[]) : []).map(mapPull),
    }));
  }

  /**
   * Open a pack: idempotent, atomic, and never a second roll.
   *
   * 1. Not the player's pack: `not-found`. Revoked: `revoked`. Already opened:
   *    its stored pulls (`alreadyOpened`).
   * 2. Roll the PINNED version with the crypto RNG.
   * 3. ONE transaction: take the player's advisory lock, then ONE statement that
   *    marks the pack opened only if it is still unopened, unrevoked and theirs,
   *    and inserts the pulls from that RETURNING with `was_new` computed in SQL
   *    (never owned before AND the first of its kind within this pack). If a
   *    concurrent open won, the UPDATE matches nothing and nothing is inserted.
   * 4. If this transaction inserted nothing, re-read and return the winner's pulls.
   */
  async function openPack(input: { playerId: string; publicId: string; randomInt?: RandomInt }): Promise<OpenResult> {
    const { playerId, publicId } = input;
    const existing = await readPack(playerId, publicId);
    if (!existing) return { status: "not-found" };
    if (existing.revokedAt) return { status: "revoked" };
    if (existing.openedAt) return { status: "ok", alreadyOpened: true, pack: existing, pulls: await readPulls(playerId, publicId) };

    const def = packVersion(existing.packId, existing.packVersion);
    if (!def) throw new Error(`Pack ${existing.packId} v${existing.packVersion} is not in the catalogue`);
    const ids = rollPack(CATALOGUE, def.version, input.randomInt);

    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended(${"collectibles:" + playerId}, 0))`,
      tx`
        WITH opened AS (
          UPDATE player_packs SET opened_at = now()
          WHERE public_id = ${publicId}::uuid AND player_id = ${playerId}
            AND opened_at IS NULL AND revoked_at IS NULL
          RETURNING id, player_id
        ), drawn AS (
          SELECT o.id AS player_pack_id, o.player_id, r.collectible_id, r.slot::smallint AS slot,
                 row_number() OVER (PARTITION BY r.collectible_id ORDER BY r.slot) AS nth
          FROM opened o CROSS JOIN unnest(${ids}::text[]) WITH ORDINALITY AS r(collectible_id, slot)
        ), ins AS (
          INSERT INTO collectible_pulls (player_id, collectible_id, player_pack_id, slot, was_new, source)
          SELECT d.player_id, d.collectible_id, d.player_pack_id, d.slot,
                 (d.nth = 1 AND NOT EXISTS (
                    SELECT 1 FROM collectible_pulls p
                    WHERE p.player_id = d.player_id AND p.collectible_id = d.collectible_id AND p.revoked_at IS NULL
                 )),
                 'pack'
          FROM drawn d
          RETURNING slot, collectible_id, was_new
        )
        SELECT slot, collectible_id, was_new FROM ins ORDER BY slot
      `,
    ]);
    const inserted = ((results[1] ?? []) as Row[]).map(mapPull);
    const after = await readPack(playerId, publicId);
    if (!after) return { status: "not-found" };
    if (inserted.length) return { status: "ok", alreadyOpened: false, pack: after, pulls: inserted };
    if (after.revokedAt) return { status: "revoked" };
    if (!after.openedAt) throw new Error("Pack was neither opened nor revoked after the opening statement");
    return { status: "ok", alreadyOpened: true, pack: after, pulls: await readPulls(playerId, publicId) };
  }

  /** The player's binder: every card they own, with copies, first pull and their choices. */
  async function binder(playerId: string): Promise<BinderEntry[]> {
    const rows = (await sql`
      WITH owned AS (
        SELECT collectible_id, count(*)::int AS owned, min(pulled_at) AS first_pulled_at
        FROM collectible_pulls
        WHERE player_id = ${playerId} AND revoked_at IS NULL
        GROUP BY collectible_id
      )
      SELECT o.collectible_id, o.owned, o.first_pulled_at,
             COALESCE(pf.favourite, false) AS favourite, pf.featured_position, pf.seen_at
      FROM owned o
      LEFT JOIN player_collectible_prefs pf ON pf.player_id = ${playerId} AND pf.collectible_id = o.collectible_id
      ORDER BY o.collectible_id
    `) as Row[];
    return rows.map((r) => ({
      collectibleId: String(r.collectible_id),
      owned: Number(r.owned),
      firstPulledAt: toIso(r.first_pulled_at)!,
      favourite: r.favourite === true,
      featuredPosition: r.featured_position == null ? null : Number(r.featured_position),
      isNew: r.seen_at == null,
    }));
  }

  /**
   * Set a favourite and/or a featured slot (1 to 6, `null` to unfeature) on a
   * card the player owns. Moving a card into a slot clears the previous holder
   * in the same statement (the unique constraint is deferred). `null` when the
   * player does not own the card.
   */
  async function setPrefs(input: {
    playerId: string;
    collectibleId: string;
    favourite?: boolean;
    featuredPosition?: number | null;
  }): Promise<PrefsResult | null> {
    const pos = input.featuredPosition;
    if (pos != null && (!Number.isInteger(pos) || pos < 1 || pos > MAX_FEATURED)) throw new Error("featuredPosition must be 1 to 6");
    if (!getCollectible(input.collectibleId)) return null;
    const setPos = pos !== undefined;
    const fav = input.favourite ?? null;
    const needOwn = input.favourite === true || (pos != null);
    const rows = (await sql`
      WITH owned AS (
        SELECT EXISTS (
          SELECT 1 FROM collectible_pulls
          WHERE player_id = ${input.playerId} AND collectible_id = ${input.collectibleId} AND revoked_at IS NULL
        ) AS ok
      ), clear AS (
        UPDATE player_collectible_prefs SET featured_position = NULL, updated_at = now()
        WHERE player_id = ${input.playerId} AND collectible_id <> ${input.collectibleId}
          AND ${setPos}::boolean AND featured_position = ${pos ?? null}::smallint
          AND (SELECT ok FROM owned)
        RETURNING 1
      ), up AS (
        INSERT INTO player_collectible_prefs (player_id, collectible_id, favourite, featured_position)
        SELECT ${input.playerId}, ${input.collectibleId}, COALESCE(${fav}::boolean, false),
               CASE WHEN ${setPos}::boolean THEN ${pos ?? null}::smallint END
        WHERE NOT ${needOwn}::boolean OR (SELECT ok FROM owned)
        ON CONFLICT (player_id, collectible_id) DO UPDATE SET
          favourite = COALESCE(${fav}::boolean, player_collectible_prefs.favourite),
          featured_position = CASE WHEN ${setPos}::boolean THEN ${pos ?? null}::smallint
                                   ELSE player_collectible_prefs.featured_position END,
          updated_at = now()
        RETURNING favourite, featured_position
      )
      SELECT favourite, featured_position FROM up
    `) as Row[];
    const r = rows[0];
    return r ? { favourite: r.favourite === true, featuredPosition: r.featured_position == null ? null : Number(r.featured_position) } : null;
  }

  /** Clear the NEW dot on cards the player owns. Returns how many were marked. */
  async function markSeen(playerId: string, collectibleIds: string[]): Promise<number> {
    const ids = [...new Set(collectibleIds)].filter((id) => getCollectible(id)).slice(0, 100);
    if (!ids.length) return 0;
    const rows = (await sql`
      INSERT INTO player_collectible_prefs (player_id, collectible_id, seen_at)
      SELECT ${playerId}, c.id, now() FROM unnest(${ids}::text[]) AS c(id)
      WHERE EXISTS (
        SELECT 1 FROM collectible_pulls p
        WHERE p.player_id = ${playerId} AND p.collectible_id = c.id AND p.revoked_at IS NULL
      )
      ON CONFLICT (player_id, collectible_id) DO UPDATE
        SET seen_at = COALESCE(player_collectible_prefs.seen_at, now()), updated_at = now()
      RETURNING collectible_id
    `) as Row[];
    return rows.length;
  }

  /** A player by username, only when their profile is public. Public name and avatar only. */
  async function findPublicPlayer(username: string): Promise<ShowcasePlayer | null> {
    const rows = (await sql`
      SELECT p.id, p.public_id, p.handle, p.username, p.avatar_meme, p.avatar_colour
      FROM players p
      WHERE p.username = ${username} AND p.profile_visibility = 'public'
    `) as Row[];
    const r = rows[0];
    if (!r) return null;
    const publicId = String(r.public_id);
    return {
      playerId: String(r.id),
      publicId,
      name: publicScoreName({ handle: str(r.handle), username: str(r.username), publicId }),
      avatar: memeAvatarFor(publicId, { meme: r.avatar_meme, colour: r.avatar_colour }),
    };
  }

  /** The cards a player features, in slot order. Only cards they still own. */
  async function featured(playerId: string): Promise<{ position: number; collectibleId: string }[]> {
    const rows = (await sql`
      SELECT pf.featured_position, pf.collectible_id
      FROM player_collectible_prefs pf
      WHERE pf.player_id = ${playerId} AND pf.featured_position IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM collectible_pulls p
          WHERE p.player_id = pf.player_id AND p.collectible_id = pf.collectible_id AND p.revoked_at IS NULL
        )
      ORDER BY pf.featured_position
    `) as Row[];
    return rows.map((r) => ({ position: Number(r.featured_position), collectibleId: String(r.collectible_id) }));
  }

  /** Revoke a SEALED pack, with a reason, logged in the same statement. `false` when it was not sealed. */
  async function revokePack(input: { publicId: string; actorEmail: string; reason: string }): Promise<boolean> {
    const reason = cleanReason(input.reason);
    if (!UUID_RE.test(input.publicId)) return false;
    const rows = (await sql`
      WITH rev AS (
        UPDATE player_packs SET revoked_at = now(), revoked_by = ${input.actorEmail}, revoked_reason = ${reason}
        WHERE public_id = ${input.publicId}::uuid AND opened_at IS NULL AND revoked_at IS NULL
        RETURNING id, player_id, pack_id, pack_version
      ), log AS (
        INSERT INTO collectibles_log (actor_email, action, player_id, player_pack_id, reason, data)
        SELECT ${input.actorEmail}, 'revoke-pack', rev.player_id, rev.id, ${reason},
               json_build_object('packId', rev.pack_id, 'packVersion', rev.pack_version)::jsonb
        FROM rev
        RETURNING id
      )
      SELECT id FROM rev
    `) as Row[];
    return rows.length > 0;
  }

  /** Revoke one pull (the card stops counting as owned), with a reason, logged in the same statement. */
  async function revokePull(input: { pullId: number; actorEmail: string; reason: string }): Promise<boolean> {
    const reason = cleanReason(input.reason);
    const rows = (await sql`
      WITH rev AS (
        UPDATE collectible_pulls SET revoked_at = now(), revoked_by = ${input.actorEmail}, revoked_reason = ${reason}
        WHERE id = ${input.pullId} AND revoked_at IS NULL
        RETURNING id, player_id, player_pack_id, collectible_id
      ), log AS (
        INSERT INTO collectibles_log (actor_email, action, player_id, player_pack_id, pull_id, reason, data)
        SELECT ${input.actorEmail}, 'revoke-pull', rev.player_id, rev.player_pack_id, rev.id, ${reason},
               json_build_object('collectibleId', rev.collectible_id)::jsonb
        FROM rev
        RETURNING id
      )
      SELECT id FROM rev
    `) as Row[];
    return rows.length > 0;
  }

  /** The admin audit log, newest first, naming players by their PUBLIC name only. */
  async function readLog(limit = 100): Promise<AdminLogEntry[]> {
    const rows = (await sql`
      SELECT l.id, l.actor_email, l.action, l.reason, l.data, l.created_at,
             p.public_id AS p_public_id, p.handle AS p_handle, p.username AS p_username
      FROM collectibles_log l LEFT JOIN players p ON p.id = l.player_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${limit}
    `) as Row[];
    return rows.map((r) => {
      const publicId = r.p_public_id == null ? null : String(r.p_public_id);
      return {
        id: Number(r.id),
        actorEmail: String(r.actor_email),
        action: String(r.action),
        publicId,
        name: publicId ? publicScoreName({ handle: str(r.p_handle), username: str(r.p_username), publicId }) : null,
        reason: String(r.reason),
        data: r.data ?? null,
        createdAt: toIso(r.created_at)!,
      };
    });
  }

  return {
    readPack, readPulls, grantPack, adminGrantPack, listSealed, listOpened, openPack, binder,
    setPrefs, markSeen, findPublicPlayer, featured, revokePack, revokePull, readLog,
  };
}

export type CollectiblesStore = ReturnType<typeof createCollectiblesStore>;
