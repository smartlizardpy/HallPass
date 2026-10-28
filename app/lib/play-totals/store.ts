import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * HallPass — the permanent per-game play totals (`game_play_totals`).
 *
 * A factory over the tagged-template `sql`, free of `server-only`, so it is
 * unit-tested with a fake template exactly like `social/store.ts`. The live
 * instance is bound in `./index.ts`.
 */
export function createPlayTotalsStore(sql: NeonQueryFunction<false, false>) {
  return {
    /**
     * Count one play. One statement, no read-first.
     *
     * The upsert keeps the table flat at the size of the catalogue; the row is
     * created on a game's first play.
     */
    async recordPlay(slug: string): Promise<void> {
      await sql`
        INSERT INTO game_play_totals (slug, plays)
        VALUES (${slug}, 1)
        ON CONFLICT (slug) DO UPDATE SET
          plays      = game_play_totals.plays + 1,
          updated_at = now()
      `;
    },

    /**
     * Every game's permanent total: the seeded history plus the plays counted
     * since. Neon returns BIGINT as a string, hence the coercion.
     */
    async totals(): Promise<Record<string, number>> {
      const rows = await sql`
        SELECT slug, (baseline + plays) AS total FROM game_play_totals
      `;
      const out: Record<string, number> = {};
      for (const row of rows) {
        const total = Number(row.total);
        if (row.slug && Number.isFinite(total)) out[String(row.slug)] = total;
      }
      return out;
    },
  };
}

export type PlayTotalsStore = ReturnType<typeof createPlayTotalsStore>;
