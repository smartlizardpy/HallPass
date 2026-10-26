/**
 * HallPass — the championship registry. Pure, client-safe.
 *
 * Every championship HallPass has ever run is listed here and stays listed: its
 * id keys stored runs, grants and its public page, which must keep working after
 * the event (final standings, never a 404). An event that is over is not removed;
 * its `enabled` flag only stops new runs from being offered.
 */

import { FRIGHT_FEST_2026 } from "./fright-fest-2026";
import type { ChampionshipConfig, ChampionshipGame } from "./types";

export const CHAMPIONSHIPS: readonly ChampionshipConfig[] = [FRIGHT_FEST_2026];

const BY_ID = new Map(CHAMPIONSHIPS.map((c) => [c.id, c] as const));

/** The championship with this id, or `undefined`. */
export function championshipById(id: string): ChampionshipConfig | undefined {
  return BY_ID.get(id);
}

/** Whether the code switch for this championship is on. Unknown ids are off. */
export function championshipEnabled(id: string): boolean {
  return BY_ID.get(id)?.enabled === true;
}

/**
 * The enabled championship and game that own a board id, or `undefined` for every
 * ordinary board. This is what the leaderboard route asks before it touches
 * `scores`: a board id that is a championship board never reaches the ordinary
 * path, whether or not the championship is currently accepting runs.
 */
export function championshipBoard(
  boardId: string,
): { championship: ChampionshipConfig; game: ChampionshipGame } | undefined {
  for (const championship of CHAMPIONSHIPS) {
    if (!championship.enabled) continue;
    const game = championship.games.find((g) => g.board === boardId);
    if (game) return { championship, game };
  }
  return undefined;
}

/** The game in a championship with this catalogue slug, or `undefined`. */
export function championshipGame(c: ChampionshipConfig, slug: string): ChampionshipGame | undefined {
  return c.games.find((g) => g.slug === slug);
}

/**
 * The enabled championships a catalogue game belongs to (for its store-page
 * panel). Usually zero or one.
 */
export function championshipsForGame(slug: string): ChampionshipConfig[] {
  return CHAMPIONSHIPS.filter((c) => c.enabled && c.games.some((g) => g.slug === slug));
}
