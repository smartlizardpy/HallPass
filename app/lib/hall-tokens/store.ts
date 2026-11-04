/**
 * HallPass — the Hall Tokens store: earn, balance, buy a market pack, sell a
 * duplicate card back.
 *
 * A factory over the tagged-template `sql` (free of `server-only`, so it is
 * unit-tested with a fake template like `candy/store.ts`, which this mirrors).
 * The live instance is bound in `./index.ts`.
 *
 * EVERY WRITE IS IDEMPOTENT AND SERIALISED. Each takes the player's advisory lock
 * first, then runs ONE statement that checks its own precondition (the balance
 * covers the price, the daily cap has room, the player holds a spare copy) and
 * inserts only if it holds. A double tap, a retry or a second tab hits
 * `ON CONFLICT (award_key)` and writes nothing, so nothing can double-spend.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { currentVersion, getCollectible, getPack } from "../collectibles/catalogue";
import {
  DAILY_PLAY_CAP,
  MARKET_PRICES,
  PLAY_TOKENS,
  STREAK_BONUS_MAX_DAYS,
  STREAK_TOKENS_PER_DAY,
  sellBackValue,
} from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BuyResult =
  | { status: "ok"; alreadyBought: boolean; packPublicId: string; packId: string; price: number; balance: number }
  | { status: "bad-pack" }
  | { status: "bad-request" }
  | { status: "insufficient"; balance: number; price: number };

export type SellResult =
  | { status: "ok"; collectibleId: string; credited: number; balance: number }
  | { status: "bad-card" }
  | { status: "no-spare-copy" };

const num = (v: unknown): number => Number(v) || 0;

export function createHallTokensStore(sql: Sql) {
  const lockKey = (playerId: string) => `tokens:${playerId}`;
  const lock = (tx: Sql, playerId: string) =>
    tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(playerId)}, 0))`;

  async function balance(playerId: string): Promise<number> {
    const rows = (await sql`
      SELECT COALESCE(sum(amount), 0)::int AS n
      FROM token_ledger WHERE player_id = ${playerId} AND revoked_at IS NULL
    `) as Row[];
    return num(rows[0]?.n);
  }

  async function history(playerId: string, limit = 25): Promise<{ amount: number; kind: string; ref: string | null; at: string }[]> {
    const rows = (await sql`
      SELECT amount, kind, ref, created_at FROM token_ledger
      WHERE player_id = ${playerId} AND revoked_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `) as Row[];
    return rows.map((r) => ({
      amount: num(r.amount),
      kind: String(r.kind),
      ref: r.ref == null ? null : String(r.ref),
      at: new Date(String(r.created_at)).toISOString(),
    }));
  }

  /**
   * Credit one play. `day` is the UK calendar day, supplied by the caller (one
   * clock, tested). One token award per distinct game per day, and the day's
   * play credits never pass `DAILY_PLAY_CAP`; the streak bonus is once a day.
   * Returns the tokens newly credited (0 on a repeat or at the cap).
   */
  async function earnForPlay(playerId: string, slug: string, day: string): Promise<number> {
    if (!SLUG_RE.test(slug) || !DAY_RE.test(day)) return 0;
    const ref = `${day}#${slug}`;
    const results = await sql.transaction((tx) => [
      lock(tx as unknown as Sql, playerId),
      tx`
        INSERT INTO token_ledger (player_id, amount, kind, award_key, ref)
        SELECT ${playerId}::text, ${PLAY_TOKENS}::int, 'play', ${`tokens:play:${playerId}:${ref}`}::text, ${ref}::text
        WHERE (
          SELECT COALESCE(sum(amount), 0) FROM token_ledger
          WHERE player_id = ${playerId} AND kind = 'play' AND revoked_at IS NULL AND ref LIKE ${day + "#%"}
        ) + ${PLAY_TOKENS}::int <= ${DAILY_PLAY_CAP}::int
        ON CONFLICT (award_key) DO NOTHING
        RETURNING amount
      `,
      tx`
        INSERT INTO token_ledger (player_id, amount, kind, award_key, ref)
        SELECT ${playerId}::text, LEAST(s.current_streak, ${STREAK_BONUS_MAX_DAYS}::int) * ${STREAK_TOKENS_PER_DAY}::int,
               'streak', ${`tokens:streak:${playerId}:${day}`}::text, ${day}::text
        FROM player_streaks s WHERE s.player_id = ${playerId} AND s.current_streak >= 2
        ON CONFLICT (award_key) DO NOTHING
        RETURNING amount
      `,
    ]);
    return [results[1], results[2]].reduce<number>(
      (sum, rows) => sum + ((rows ?? []) as Row[]).reduce((a, r) => a + num(r.amount), 0),
      0,
    );
  }

  /**
   * Buy a market pack: the debit and the sealed pack are one statement in one
   * transaction, so a failure leaves neither. A repeat of the same `requestId`
   * returns the same pack.
   */
  async function buyPack(playerId: string, packId: string, requestId: string): Promise<BuyResult> {
    const def = getPack(packId);
    const price = Object.hasOwn(MARKET_PRICES, packId) ? MARKET_PRICES[packId] : undefined;
    if (!def || price === undefined) return { status: "bad-pack" };
    if (!REQUEST_ID_RE.test(requestId)) return { status: "bad-request" };
    const key = `tokens:spend:${playerId}:${requestId}`;
    const version = currentVersion(def).v;

    const results = await sql.transaction((tx) => [
      lock(tx as unknown as Sql, playerId),
      tx`
        WITH bal AS (
          SELECT COALESCE(sum(amount), 0)::int AS n FROM token_ledger
          WHERE player_id = ${playerId} AND revoked_at IS NULL
        ), pk AS (
          INSERT INTO player_packs (player_id, pack_id, pack_version, grant_key, source, source_ref)
          SELECT ${playerId}::text, ${packId}::text, ${version}::int, ${key}::text, 'market', 'hall-tokens'
          FROM bal WHERE bal.n >= ${price}::int
          ON CONFLICT (grant_key) DO NOTHING
          RETURNING id, public_id
        ), debit AS (
          INSERT INTO token_ledger (player_id, amount, kind, award_key, ref, player_pack_id)
          SELECT ${playerId}::text, ${-price}::int, 'spend', ${key}::text, ${packId}::text, pk.id FROM pk
          ON CONFLICT (award_key) DO NOTHING
          RETURNING id
        )
        SELECT pk.public_id, (SELECT n FROM bal) - ${price}::int AS balance FROM pk
      `,
    ]);
    const bought = ((results[1] ?? []) as Row[])[0];
    if (bought) {
      return { status: "ok", alreadyBought: false, packPublicId: String(bought.public_id), packId, price, balance: num(bought.balance) };
    }
    const prior = (await sql`
      SELECT l.ref, pp.public_id FROM token_ledger l JOIN player_packs pp ON pp.id = l.player_pack_id
      WHERE l.award_key = ${key} AND l.player_id = ${playerId}
    `) as Row[];
    if (prior[0]) {
      if (String(prior[0].ref) !== packId) return { status: "bad-request" };
      return { status: "ok", alreadyBought: true, packPublicId: String(prior[0].public_id), packId, price, balance: await balance(playerId) };
    }
    return { status: "insufficient", balance: await balance(playerId), price };
  }

  /**
   * Sell back ONE spare copy of a card for `SELL_BACK_PCT` of its base value.
   * Only a duplicate sells (the player must keep one of each), and it is the
   * newest copy that goes, so the first pull's "new" flag is never disturbed. The
   * pull's revocation and the credit are one statement; the credit's key is the
   * pull id, so a pull can be sold once.
   */
  async function sellBack(playerId: string, collectibleId: string): Promise<SellResult> {
    const card = getCollectible(collectibleId);
    if (!card) return { status: "bad-card" };
    const credit = sellBackValue(card.rarity);
    if (credit <= 0) return { status: "bad-card" };

    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended(${"collectibles:" + playerId}, 0))`,
      lock(tx as unknown as Sql, playerId),
      tx`
        WITH spare AS (
          SELECT id FROM collectible_pulls
          WHERE player_id = ${playerId} AND collectible_id = ${collectibleId} AND revoked_at IS NULL
            AND (SELECT count(*) FROM collectible_pulls
                 WHERE player_id = ${playerId} AND collectible_id = ${collectibleId} AND revoked_at IS NULL) > 1
          ORDER BY pulled_at DESC, id DESC LIMIT 1
        ), sold AS (
          UPDATE collectible_pulls SET revoked_at = now(), revoked_by = 'market', revoked_reason = 'sold back'
          WHERE id IN (SELECT id FROM spare) AND revoked_at IS NULL
          RETURNING id
        ), paid AS (
          INSERT INTO token_ledger (player_id, amount, kind, award_key, ref)
          SELECT ${playerId}::text, ${credit}::int, 'sell_back', 'tokens:sell:' || sold.id::text, ${collectibleId}::text FROM sold
          ON CONFLICT (award_key) DO NOTHING
          RETURNING id
        )
        SELECT (SELECT count(*)::int FROM paid) AS credited
      `,
    ]);
    const credited = num(((results[2] ?? []) as Row[])[0]?.credited);
    if (credited < 1) return { status: "no-spare-copy" };
    return { status: "ok", collectibleId, credited: credit, balance: await balance(playerId) };
  }

  return { balance, history, earnForPlay, buyPack, sellBack };
}

export type HallTokensStore = ReturnType<typeof createHallTokensStore>;
