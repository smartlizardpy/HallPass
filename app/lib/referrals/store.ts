/**
 * Fright Fest referrals — the store. A factory over the Neon client so the SQL is
 * testable with a fake `sql` (store.test.ts); the live binding is index.ts.
 *
 * WHAT A REFERRAL IS. Player A has a token. A visitor lands with it and the token
 * rides a first-party cookie. When that visitor is a signed-in NEW account, the
 * first token wins and a `referrals` row is written `pending` (`claim`). When the
 * friend's first ranked run is ACCEPTED, A is paid candy (`qualifyReferrer`).
 * Copying a link, clicking it or sharing a post pays nothing.
 *
 * THE REWARD IS ONE TRANSACTION, UNDER A PER-REFERRER LOCK. Lock, credit the
 * ledger (`ON CONFLICT (award_key) DO NOTHING`, so a repeat or a race writes
 * nothing), mark the referral rewarded from the ledger row that exists, then mark
 * what is left over as `capped`. The cap is a COUNT inside that same transaction
 * (rewarded + revoked: a fraudulent referral does not free its slot), so two
 * friends qualifying at once cannot both take the last slot. Everything is
 * derived from the database clock and the database's own rows; the browser
 * supplies a token and nothing else.
 *
 * `qualifyReferrer` is idempotent and safe to call on every read: it is called
 * when a friend's run is accepted AND when the referrer opens the panel, so a
 * failed hook is repaired by the next visit.
 *
 * PRIVACY. Nothing here puts a player id on the wire. Admin lists carry public
 * names and public ids only; the referred friend's name is shown to the admin,
 * never to the referrer (who sees counts only).
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { generateInviteCode } from "../invites/code";
import { publicScoreName } from "../scoreboard/display-name";
import {
  REFERRAL_FRIGHT_FEST_2026,
  REFERRAL_TOKEN_RE,
  inWindow,
  rulesFrom,
  type ReferralConfig,
  type ReferralRules,
} from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

export const COUNTER_KINDS = ["post_copy", "comment_copy", "link_copy", "message_copy", "invite_open"] as const;
export type CounterKind = (typeof COUNTER_KINDS)[number];

export const REFERRAL_STATUSES = ["pending", "rewarded", "capped", "ineligible", "revoked"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const statusOf = (v: unknown): ReferralStatus =>
  (REFERRAL_STATUSES as readonly string[]).includes(String(v)) ? (v as ReferralStatus) : "pending";

export function cleanReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 500);
}

/** What the referrer sees: counts only, never who. */
export interface MyReferrals {
  token: string;
  rules: ReferralRules;
  /** Friends who landed, signed in as new accounts and have not played a ranked run yet. */
  pending: number;
  /** Friends who paid out (a revoked one still uses its slot). */
  rewarded: number;
  /** Candy earned from referrals, revoked credits excluded. */
  candy: number;
  /** Rewards still available: `max(0, cap - rewarded)`. */
  remaining: number;
  visits: number;
  windowOpen: boolean;
}

export interface QualifyResult {
  /** Friends paid by THIS call (0 on a repeat). */
  rewarded: number;
  /** Candy those credits are worth. */
  amount: number;
}

export type ClaimResult = "attributed" | "returning" | "ignored";

export interface AdminReferral {
  id: number;
  status: ReferralStatus;
  reason: string | null;
  referrer: { publicId: string; name: string };
  referred: { publicId: string; name: string };
  attributedAt: string;
  qualifiedAt: string | null;
  amount: number;
  ledgerId: number | null;
  flags: string[];
}

export interface ReferralStats {
  codes: number;
  visits: number;
  /** Friends attributed (every status but ineligible). */
  attributed: number;
  qualified: number;
  rewarded: number;
  capped: number;
  ineligible: number;
  revoked: number;
  candyAwarded: number;
  counters: Record<CounterKind, number>;
}

/** Burst: three or more of one referrer's friends created accounts within this many seconds. */
const BURST_SECONDS = 600;
const BURST_COUNT = 3;
/** A referrer whose own account is younger than this when their friend joined looks like a second account. */
const YOUNG_REFERRER_SECONDS = 3600;

export function createReferralStore(sql: Sql, config: ReferralConfig = REFERRAL_FRIGHT_FEST_2026) {
  const event = config.eventId;
  const lockKey = (referrerId: string) => `referral:${referrerId}`;

  async function rules(): Promise<ReferralRules> {
    const rows = (await sql`
      SELECT enabled, bonus, cap FROM referral_settings WHERE event_id = ${event}
    `) as Row[];
    const r = rows[0];
    return rulesFrom(config, r ? { enabled: Boolean(r.enabled), bonus: num(r.bonus), cap: num(r.cap) } : null);
  }

  /** The player's token, minted on first use. Idempotent; a token collision rerolls. */
  async function getOrCreateCode(playerId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rows = (await sql`
        WITH ins AS (
          INSERT INTO referral_codes (player_id, event_id, token)
          VALUES (${playerId}, ${event}, ${generateInviteCode()})
          ON CONFLICT DO NOTHING
          RETURNING token
        )
        SELECT token FROM ins
        UNION ALL
        SELECT token FROM referral_codes WHERE player_id = ${playerId} AND event_id = ${event}
        LIMIT 1
      `) as Row[];
      if (rows[0]?.token) return String(rows[0].token);
    }
    throw new Error("referral code could not be created");
  }

  /** Count a landing on a token. True when the token exists. Counts are analytics only; nothing is paid for them. */
  async function recordVisit(token: string): Promise<boolean> {
    if (!REFERRAL_TOKEN_RE.test(token)) return false;
    const rows = (await sql`
      UPDATE referral_codes SET visits = visits + 1 WHERE token = ${token} AND event_id = ${event} RETURNING 1 AS ok
    `) as Row[];
    return rows.length > 0;
  }

  /** Count a copy / open. No player, no device: a day's tally. */
  async function track(kind: CounterKind): Promise<void> {
    if (!(COUNTER_KINDS as readonly string[]).includes(kind)) return;
    await sql`
      INSERT INTO referral_counters (event_id, kind, day, count)
      VALUES (${event}, ${kind}, (now() AT TIME ZONE 'Europe/London')::date, 1)
      ON CONFLICT (event_id, kind, day) DO UPDATE SET count = referral_counters.count + 1
    `;
  }

  /**
   * First-touch attribution of a signed-in player to a token. The FIRST referral
   * row for a player stands (UNIQUE (event, referred)); a later link never
   * overwrites it. No row for: an unknown token, the player's own token, a
   * request outside the window or with the feature off.
   *
   * 'attributed' = pending. 'returning' = recorded as ineligible because the
   * account is older than the event or already has a run (they may play, they
   * just earn nobody a reward). 'ignored' = nothing written.
   */
  async function claim(playerId: string, token: string, nowMs: number = Date.now()): Promise<ClaimResult> {
    if (!REFERRAL_TOKEN_RE.test(token) || !inWindow(config, nowMs)) return "ignored";
    if (!(await rules()).enabled) return "ignored";
    const rows = (await sql`
      WITH me AS (
        SELECT p.id, p.created_at,
               (p.created_at >= ${config.opensAt}::timestamptz
                AND NOT EXISTS (SELECT 1 FROM championship_runs r WHERE r.player_id = p.id AND r.event_id = ${event} AND r.status <> 'issued')
                AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.player_id = p.id AND s.created_at >= ${config.opensAt}::timestamptz)
               ) AS is_new
        FROM players p WHERE p.id = ${playerId}
      )
      INSERT INTO referrals (event_id, referrer_id, referred_id, token, status, reason)
      SELECT ${event}, c.player_id, me.id, c.token,
             CASE WHEN me.is_new THEN 'pending' ELSE 'ineligible' END,
             CASE WHEN me.is_new THEN NULL ELSE 'Not a new player' END
      FROM referral_codes c CROSS JOIN me
      WHERE c.token = ${token} AND c.event_id = ${event} AND c.player_id <> me.id
        AND now() >= ${config.opensAt}::timestamptz AND now() < ${config.closesAt}::timestamptz
      ON CONFLICT (event_id, referred_id) DO NOTHING
      RETURNING status
    `) as Row[];
    if (!rows[0]) return "ignored";
    return rows[0].status === "pending" ? "attributed" : "returning";
  }

  /**
   * Pay every referral of this referrer whose friend has an accepted ranked run,
   * oldest first, up to the cap. One transaction under the referrer's lock; a
   * repeat writes nothing. See the header.
   */
  async function qualifyReferrer(referrerId: string): Promise<QualifyResult> {
    const rl = await rules();
    if (!rl.enabled) return { rewarded: 0, amount: 0 };
    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(referrerId)}, 0))`,
      // 1. Credit. Skipped (no rows) when the bonus is 0, which the ledger's CHECK would refuse.
      tx`
        INSERT INTO candy_ledger (player_id, event_id, amount, kind, award_key, ref)
        SELECT q.referrer_id, q.event_id, ${rl.bonus}::int, 'referral',
               'candy:' || q.event_id || ':referral:' || q.referrer_id || ':' || q.referred_id,
               'referral#' || q.id
        FROM (
          SELECT r.*, row_number() OVER (ORDER BY f.first_at, r.id) AS n
          FROM referrals r
          JOIN LATERAL (
            SELECT min(cr.submitted_at) AS first_at
            FROM championship_runs cr
            WHERE cr.player_id = r.referred_id AND cr.event_id = r.event_id AND cr.status = 'accepted'
              AND cr.submitted_at >= ${config.opensAt}::timestamptz AND cr.submitted_at < ${config.closesAt}::timestamptz
          ) f ON f.first_at IS NOT NULL
          WHERE r.event_id = ${event} AND r.referrer_id = ${referrerId} AND r.status = 'pending'
        ) q
        WHERE ${rl.bonus}::int > 0
          AND q.n <= GREATEST(0, ${rl.cap}::int - (
            SELECT count(*) FROM referrals u
            WHERE u.event_id = ${event} AND u.referrer_id = ${referrerId} AND u.status IN ('rewarded','revoked')))
        ON CONFLICT (award_key) DO NOTHING
        RETURNING amount
      `,
      // 2. Mark rewarded FROM the ledger row that exists (also repairs a half-finished earlier attempt).
      tx`
        UPDATE referrals r
        SET status = 'rewarded', qualified_at = now(), amount = l.amount, award_key = l.award_key, ledger_id = l.id
        FROM candy_ledger l
        WHERE r.event_id = ${event} AND r.referrer_id = ${referrerId} AND r.status = 'pending'
          AND l.award_key = 'candy:' || r.event_id || ':referral:' || r.referrer_id || ':' || r.referred_id
          AND l.revoked_at IS NULL
        RETURNING r.id
      `,
      // 3. Whatever qualified but found the cap full is capped: kept for the record, pays nothing.
      tx`
        UPDATE referrals r
        SET status = 'capped', qualified_at = now(), reason = 'Referrer was at the reward cap'
        WHERE r.event_id = ${event} AND r.referrer_id = ${referrerId} AND r.status = 'pending'
          AND EXISTS (
            SELECT 1 FROM championship_runs cr
            WHERE cr.player_id = r.referred_id AND cr.event_id = r.event_id AND cr.status = 'accepted'
              AND cr.submitted_at >= ${config.opensAt}::timestamptz AND cr.submitted_at < ${config.closesAt}::timestamptz)
          AND (SELECT count(*) FROM referrals u
               WHERE u.event_id = ${event} AND u.referrer_id = ${referrerId} AND u.status IN ('rewarded','revoked')) >= ${rl.cap}::int
        RETURNING r.id
      `,
    ]);
    const credits = (results[1] ?? []) as Row[];
    return { rewarded: credits.length, amount: credits.reduce((a, r) => a + num(r.amount), 0) };
  }

  /**
   * A friend's run was just accepted: pay their referrer if there is one pending.
   * Returns null when this player was not referred (the common case).
   */
  async function qualifyReferred(referredId: string): Promise<QualifyResult | null> {
    const rows = (await sql`
      SELECT referrer_id FROM referrals
      WHERE event_id = ${event} AND referred_id = ${referredId} AND status = 'pending' LIMIT 1
    `) as Row[];
    const referrer = rows[0]?.referrer_id;
    return referrer ? qualifyReferrer(String(referrer)) : null;
  }

  /** The panel's numbers. Reconciles first, so a missed hook is repaired by looking. */
  async function mine(playerId: string, nowMs: number = Date.now()): Promise<MyReferrals> {
    const [token, rl] = await Promise.all([getOrCreateCode(playerId), rules()]);
    await qualifyReferrer(playerId);
    const rows = (await sql`
      SELECT
        (SELECT count(*) FROM referrals WHERE event_id = ${event} AND referrer_id = ${playerId} AND status = 'pending') AS pending,
        (SELECT count(*) FROM referrals WHERE event_id = ${event} AND referrer_id = ${playerId} AND status IN ('rewarded','revoked')) AS used,
        (SELECT COALESCE(sum(amount), 0) FROM referrals WHERE event_id = ${event} AND referrer_id = ${playerId} AND status = 'rewarded') AS candy,
        (SELECT visits FROM referral_codes WHERE player_id = ${playerId} AND event_id = ${event}) AS visits
    `) as Row[];
    const r = rows[0] ?? {};
    const used = num(r.used);
    return {
      token,
      rules: rl,
      pending: num(r.pending),
      rewarded: used,
      candy: num(r.candy),
      remaining: Math.max(0, rl.cap - used),
      visits: num(r.visits),
      windowOpen: inWindow(config, nowMs),
    };
  }

  // ── admin ───────────────────────────────────────────────────────────────────

  async function stats(): Promise<ReferralStats> {
    const [counts, counters] = await Promise.all([
      sql`
        SELECT
          (SELECT count(*) FROM referral_codes WHERE event_id = ${event}) AS codes,
          (SELECT COALESCE(sum(visits), 0) FROM referral_codes WHERE event_id = ${event}) AS visits,
          count(*) FILTER (WHERE status <> 'ineligible') AS attributed,
          count(*) FILTER (WHERE status IN ('rewarded','capped','revoked')) AS qualified,
          count(*) FILTER (WHERE status = 'rewarded') AS rewarded,
          count(*) FILTER (WHERE status = 'capped') AS capped,
          count(*) FILTER (WHERE status = 'ineligible') AS ineligible,
          count(*) FILTER (WHERE status = 'revoked') AS revoked,
          COALESCE(sum(amount) FILTER (WHERE status = 'rewarded'), 0) AS candy
        FROM referrals WHERE event_id = ${event}
      `,
      sql`SELECT kind, COALESCE(sum(count), 0) AS n FROM referral_counters WHERE event_id = ${event} GROUP BY kind`,
    ]);
    const c = ((counts as Row[])[0] ?? {}) as Row;
    const tally = Object.fromEntries(COUNTER_KINDS.map((k) => [k, 0])) as Record<CounterKind, number>;
    for (const row of counters as Row[]) {
      const k = String(row.kind) as CounterKind;
      if (k in tally) tally[k] = num(row.n);
    }
    return {
      codes: num(c.codes),
      visits: num(c.visits),
      attributed: num(c.attributed),
      qualified: num(c.qualified),
      rewarded: num(c.rewarded),
      capped: num(c.capped),
      ineligible: num(c.ineligible),
      revoked: num(c.revoked),
      candyAwarded: num(c.candy),
      counters: tally,
    };
  }

  /** Newest referrals first, with PUBLIC names only and the suspicious-activity flags. */
  async function listReferrals(limit = 100): Promise<AdminReferral[]> {
    const rows = (await sql`
      SELECT r.id, r.status, r.reason, r.attributed_at, r.qualified_at, r.amount, r.ledger_id, r.referrer_id,
             a.public_id AS a_pub, a.handle AS a_handle, a.username AS a_user, a.created_at AS a_created,
             b.public_id AS b_pub, b.handle AS b_handle, b.username AS b_user, b.created_at AS b_created
      FROM referrals r
      JOIN players a ON a.id = r.referrer_id
      JOIN players b ON b.id = r.referred_id
      WHERE r.event_id = ${event}
      ORDER BY r.attributed_at DESC, r.id DESC
      LIMIT ${Math.max(1, Math.min(limit, 300))}
    `) as Row[];
    const byReferrer = new Map<string, number[]>();
    for (const r of rows) {
      const list = byReferrer.get(String(r.referrer_id)) ?? [];
      list.push(Date.parse(iso(r.b_created)));
      byReferrer.set(String(r.referrer_id), list);
    }
    const bursty = new Set<string>();
    for (const [referrer, times] of byReferrer) if (hasBurst(times)) bursty.add(referrer);
    return rows.map((r) => {
      const flags: string[] = [];
      if (bursty.has(String(r.referrer_id))) flags.push("burst");
      const gap = (Date.parse(iso(r.b_created)) - Date.parse(iso(r.a_created))) / 1000;
      if (gap >= 0 && gap < YOUNG_REFERRER_SECONDS) flags.push("young-referrer");
      return {
        id: num(r.id),
        status: statusOf(r.status),
        reason: r.reason ? String(r.reason) : null,
        referrer: { publicId: String(r.a_pub), name: publicScoreName({ handle: r.a_handle as string, username: r.a_user as string, publicId: String(r.a_pub) }) },
        referred: { publicId: String(r.b_pub), name: publicScoreName({ handle: r.b_handle as string, username: r.b_user as string, publicId: String(r.b_pub) }) },
        attributedAt: iso(r.attributed_at),
        qualifiedAt: r.qualified_at ? iso(r.qualified_at) : null,
        amount: num(r.amount),
        ledgerId: r.ledger_id == null ? null : num(r.ledger_id),
        flags,
      };
    });
  }

  /**
   * Revoke a rewarded referral: the candy credit stops counting, the referral is
   * marked revoked (and keeps using its slot), and both audit logs record it, in
   * ONE transaction. False when the referral is not currently rewarded.
   */
  async function revoke(input: { referralId: number; actorEmail: string; reason: string }): Promise<boolean> {
    const reason = cleanReason(input.reason);
    if (!reason || !Number.isSafeInteger(input.referralId) || input.referralId <= 0) return false;
    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended('referral:' || r.referrer_id, 0)) FROM referrals r WHERE r.id = ${input.referralId}`,
      tx`
        WITH target AS (
          SELECT id, ledger_id, referrer_id, amount FROM referrals WHERE id = ${input.referralId} AND status = 'rewarded'
        ), led AS (
          UPDATE candy_ledger l
          SET revoked_at = now(), revoked_by = ${input.actorEmail}, revoked_reason = ${reason}
          FROM target t WHERE l.id = t.ledger_id AND l.revoked_at IS NULL
          RETURNING l.id
        ), ref AS (
          UPDATE referrals r SET status = 'revoked', reason = ${reason}
          FROM target t WHERE r.id = t.id
          RETURNING r.id
        ), clog AS (
          INSERT INTO candy_log (actor_email, action, player_id, ledger_id, reason, data)
          SELECT ${input.actorEmail}, 'revoke-credit', t.referrer_id, t.ledger_id, ${reason},
                 json_build_object('kind', 'referral', 'amount', t.amount, 'referral', t.id)::jsonb
          FROM target t WHERE EXISTS (SELECT 1 FROM led)
          RETURNING id
        ), rlog AS (
          INSERT INTO referral_log (actor_email, action, referral_id, reason)
          SELECT ${input.actorEmail}, 'revoke', t.id, ${reason} FROM target t
          RETURNING id
        )
        SELECT id FROM ref
      `,
    ]);
    return ((results[1] ?? []) as Row[]).length > 0;
  }

  /** Save the admin's overrides. The bounds mirror the table's CHECKs; false on a bad value. */
  async function setSettings(input: { enabled: boolean; bonus: number; cap: number; actorEmail: string }): Promise<boolean> {
    const { bonus, cap } = input;
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > 100 || !Number.isInteger(cap) || cap < 0 || cap > 20) return false;
    await sql.transaction((tx) => [
      tx`
        INSERT INTO referral_settings (event_id, enabled, bonus, cap, updated_by, updated_at)
        VALUES (${event}, ${input.enabled}, ${bonus}, ${cap}, ${input.actorEmail}, now())
        ON CONFLICT (event_id) DO UPDATE
          SET enabled = EXCLUDED.enabled, bonus = EXCLUDED.bonus, cap = EXCLUDED.cap,
              updated_by = EXCLUDED.updated_by, updated_at = now()
      `,
      tx`
        INSERT INTO referral_log (actor_email, action, data)
        VALUES (${input.actorEmail}, 'set-settings', ${JSON.stringify({ enabled: input.enabled, bonus, cap })}::jsonb)
      `,
    ]);
    return true;
  }

  return { rules, getOrCreateCode, recordVisit, track, claim, qualifyReferrer, qualifyReferred, mine, stats, listReferrals, revoke, setSettings };
}

export type ReferralStore = ReturnType<typeof createReferralStore>;

/** Three or more account-creation times inside {@link BURST_SECONDS} of each other. */
export function hasBurst(timesMs: readonly number[]): boolean {
  const t = [...timesMs].filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 0; i + BURST_COUNT - 1 < t.length; i += 1) {
    if (t[i + BURST_COUNT - 1] - t[i] <= BURST_SECONDS * 1000) return true;
  }
  return false;
}
