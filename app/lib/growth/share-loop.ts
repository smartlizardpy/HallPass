import "server-only";

/**
 * HallPass — the SHARE LOOP, measured from our own database.
 *
 * This is the one growth panel that does not depend on analytics reaching a
 * third party, and that is the entire reason it is built this way.
 *
 * Every challenge link is already a row: `kind = 'link'` is an invitation
 * somebody minted, `kind = 'link_claim'` is one person taking it up, and
 * `resolved_at` on a claim means they actually beat the score. Nothing had ever
 * read those rows as a growth measure. Reading them is exact — no sampling, no
 * ad blocker, no school content filter between us and the number, and no
 * migration, because the challenge feature already writes all of it.
 *
 * SO WHEN THIS PANEL AND THE POSTHOG PANEL DISAGREE, THIS ONE IS RIGHT. The
 * dashboard says so in words, because somebody will eventually ask.
 *
 * WHAT `opens` IS AND IS NOT. `challenges.opens` counts presses of "Beat it", not
 * page views — the column's own comment explains why, and it matters here: a
 * funnel built on views would inflate on every prefetch and refresh and would
 * flatter the loop. Opens is intent; claims are people.
 *
 * FAIL-SOFT LIKE `overview.ts`. Migrations in this repo are applied by hand, so a
 * database predating `022_challenges.sql` / `025_challenge_links.sql` simply has
 * no table. That is caught and reported as `available: false` so the page renders
 * a notice, rather than pretending the loop measured zero.
 */

import { sql, isMissingColumnError } from "@/app/lib/db";
import {
  SHARE_LOOP_WEEKS,
  claimsPerLink,
  fillWeeks,
  type ShareWeek,
} from "./config";

export type { ShareWeek } from "./config";

/** One game's share activity, ranked by links minted. */
export type SharedGame = {
  slug: string;
  links: number;
  claims: number;
};

export type ShareLoop = {
  /** Links minted, ever. One per (owner, board) — resharing refreshes, not mints. */
  links: number;
  /** Of those, currently revoked. A health signal for the feature, not growth. */
  revoked: number;
  /** Presses of "Beat it" across every link. Intent, not people. */
  opens: number;
  /** People who took a link up. */
  claims: number;
  /** Claims where the taker actually beat the score. */
  claimsBeaten: number;
  /**
   * Claims per link — the loop's branching factor, and the closest thing this
   * site has to a K-factor.
   *
   * NOT a viral coefficient, and the panel must not label it as one: a claim is
   * somebody playing, not somebody who went on to share a link of their own.
   * A true K would divide new SHARERS by sharers. This is the honest, weaker
   * number we can actually compute today.
   */
  claimsPerLink: number | null;
  /** How many distinct players have ever minted a link. */
  sharers: number;
  topGames: SharedGame[];
  weekly: ShareWeek[];
  /** False when the database is unconfigured, unreachable, or pre-migration. */
  available: boolean;
};

const EMPTY: ShareLoop = {
  links: 0,
  revoked: 0,
  opens: 0,
  claims: 0,
  claimsBeaten: 0,
  claimsPerLink: null,
  sharers: 0,
  topGames: [],
  weekly: [],
  available: false,
};

export async function getShareLoop(): Promise<ShareLoop> {
  try {
    const [totals, top, weekly] = await Promise.all([
      /**
       * Every headline in one pass with conditional aggregation, matching the
       * KPI query in `stats.ts`. `opens` is summed only over links, since the
       * column is link-only by CHECK and a claim's value is always 0 — summing
       * across both would work today and quietly break if that ever changed.
       */
      sql`
        SELECT
          count(*) FILTER (WHERE kind = 'link')::int AS links,
          count(*) FILTER (WHERE kind = 'link' AND revoked_at IS NOT NULL)::int AS revoked,
          coalesce(sum(opens) FILTER (WHERE kind = 'link'), 0)::int AS opens,
          count(*) FILTER (WHERE kind = 'link_claim')::int AS claims,
          count(*) FILTER (WHERE kind = 'link_claim' AND resolved_at IS NOT NULL)::int AS claims_beaten,
          count(DISTINCT challenger_id) FILTER (WHERE kind = 'link')::int AS sharers
        FROM challenges
        WHERE kind IN ('link', 'link_claim')
      `,
      /**
       * Games ranked by links minted.
       *
       * Claims are counted through `parent_id` rather than by joining boards
       * twice: a claim row's own `board_id` is the same board, but going via the
       * parent is what guarantees a claim is attributed to the link it came
       * from even if that link is later revoked.
       *
       * `game_slug` is nullable on `boards`, so a board that was never attached
       * to a game is excluded rather than rendered as an empty row.
       */
      sql`
        SELECT b.game_slug AS slug,
               count(*)::int AS links,
               coalesce(sum(c.claims), 0)::int AS claims
        FROM challenges l
        JOIN boards b ON b.id = l.board_id
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS claims
          FROM challenges k
          WHERE k.kind = 'link_claim' AND k.parent_id = l.id
        ) c ON true
        WHERE l.kind = 'link' AND b.game_slug IS NOT NULL
        GROUP BY b.game_slug
        ORDER BY links DESC, claims DESC
        LIMIT 8
      `,
      sql`
        SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
               count(*) FILTER (WHERE kind = 'link')::int AS links,
               count(*) FILTER (WHERE kind = 'link_claim')::int AS claims
        FROM challenges
        WHERE kind IN ('link', 'link_claim')
          AND created_at >= date_trunc('week', now()) - make_interval(weeks => ${SHARE_LOOP_WEEKS - 1})
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ]);

    const t = (totals[0] ?? {}) as Record<string, number>;
    const links = t.links ?? 0;
    const claims = t.claims ?? 0;

    return {
      links,
      revoked: t.revoked ?? 0,
      opens: t.opens ?? 0,
      claims,
      claimsBeaten: t.claims_beaten ?? 0,
      claimsPerLink: claimsPerLink(links, claims),
      sharers: t.sharers ?? 0,
      topGames: top as SharedGame[],
      weekly: fillWeeks(weekly as ShareWeek[], SHARE_LOOP_WEEKS, new Date()),
      available: true,
    };
  } catch (error) {
    // A database that predates the challenges migrations has no table to read.
    // Anything else is a genuine outage; both render the same "unavailable"
    // notice, which is the honest thing to show either way.
    if (!isMissingColumnError(error)) {
      console.error("[growth] getShareLoop failed", error);
    }
    return { ...EMPTY };
  }
}
