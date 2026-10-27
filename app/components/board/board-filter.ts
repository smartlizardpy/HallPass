/**
 * Pure search/category filtering for the board library, kept out of the component
 * so the rules can be tested without a DOM.
 *
 * Categories come from the games actually passed in, not from the static
 * `categories` export, because the board is handed the RESOLVED catalogue
 * (dashboard-added and external games included) and a category that only exists
 * there must still be filterable.
 */

import type { Game } from "@/app/lib/games";

export interface LibraryFilter {
  query: string;
  /** `null` means "All". */
  category: string | null;
}

export const NO_FILTER: LibraryFilter = { query: "", category: null };

/** Lower-cased, accent-folded, whitespace-collapsed — so "  Zombie  " matches "zombie". */
export function normaliseQuery(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isFiltering(f: LibraryFilter): boolean {
  return normaliseQuery(f.query) !== "" || f.category !== null;
}

/**
 * Games whose NAME contains every word of the query, within the chosen category.
 * Search is by name only (the brief's requirement); order of `games` is kept.
 */
export function filterGames(games: Game[], f: LibraryFilter): Game[] {
  const words = normaliseQuery(f.query).split(" ").filter(Boolean);
  return games.filter((g) => {
    if (f.category !== null && g.category !== f.category) return false;
    if (words.length === 0) return true;
    const title = normaliseQuery(g.title);
    return words.every((w) => title.includes(w));
  });
}

export interface CategoryCount {
  category: string;
  count: number;
}

/** Categories present in `games`, alphabetical, with how many games each holds. */
export function categoryCounts(games: Game[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const g of games) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * The featured game is the one an editor flagged `isFeatured` — nothing is
 * inferred from plays or ranking. `null` when none is flagged, in which case the
 * board shows no featured strip rather than guessing.
 */
export function pickFeatured(games: Game[]): Game | null {
  return games.find((g) => g.isFeatured) ?? null;
}
