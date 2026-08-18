import type { Game } from "@/app/lib/games";

/**
 * HallPass — the category vocabulary, in one place.
 *
 * A category is a REAL field on a game (`game.category`, dashboard-editable via
 * `setGameCategory`), so the live list comes from `resolveCategories()`. What
 * this module owns is the part that is not in the data: the two VIRTUAL shelves
 * the site also routes as categories, and the case-insensitive mapping from a
 * URL segment back to the name a game actually carries.
 *
 * It exists because that mapping had started to be written twice. The route knew
 * about `New` and `Trending`; so did the sitemap, in its own literal. A third
 * copy was about to be written for the category's social card, and the failure
 * mode of a drifted copy is quiet: a shelf that renders but is never linked, or
 * a URL in the sitemap that 404s.
 *
 * PURE, and deliberately free of `server-only` — it takes the resolved category
 * list as an argument rather than reading it, so it unit tests in the plain
 * `node` environment and can be called from either side.
 */

/**
 * Shelves that are routed like categories but are not a value of
 * `game.category`: `New` is `isNew`, `Trending` is a play-count ranking. Both
 * are resolved by `Arcade` itself, which is why they can never appear in
 * `resolveCategories()` and must be named here.
 */
export const VIRTUAL_CATEGORIES = ["New", "Trending"] as const;

/**
 * The full routed category list: the virtual shelves first, then the live ones.
 * The order is the sitemap's; it carries no ranking meaning.
 */
export function routedCategories(categories: string[]): string[] {
  return [...VIRTUAL_CATEGORIES, ...categories];
}

/**
 * Resolve a URL segment to the category name as it is WRITTEN — `shooter` →
 * `Shooter`, `bullet hell` → `Bullet Hell` — or `null` when nothing matches.
 *
 * Case-insensitive because the links are all lowercased (`sitemap.ts`, the nav,
 * the breadcrumbs) while the stored name is not, and because a URL typed by hand
 * should still land. The segment arrives already percent-decoded by the router;
 * categories may contain spaces, so this must never assume otherwise.
 */
export function resolveCategoryFromSlug(
  slug: string,
  categories: string[],
): string | null {
  const lower = slug.toLowerCase();
  const virtual = VIRTUAL_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (virtual) return virtual;
  return categories.find((c) => c.toLowerCase() === lower) ?? null;
}

/** The canonical path for a category — the ONE encoding every link uses. */
export function categoryPath(category: string): string {
  return `/category/${encodeURIComponent(category.toLowerCase())}`;
}

/**
 * How many games the `Trending` shelf holds. `Arcade` imports this rather than
 * repeating the 6, because the shelf's LENGTH is part of its definition: the
 * category page filters its grid down to exactly the games in this ranking, so a
 * card built against a different number would advertise games the page does not
 * show.
 */
export const TRENDING_COUNT = 6;

/**
 * The games ON a shelf, in the order the shelf shows them.
 *
 * `Arcade` does this filtering client-side for the page itself and keeps doing
 * it; this exists for the surfaces that must know the same answer WITHOUT
 * mounting the arcade — today the category's social card, which would otherwise
 * advertise a shelf using the wrong games' art. The two definitions of `New` and
 * `Trending` must agree, so the ones here are written to match `Arcade`'s
 * exactly: `New` is `isNew`, `Trending` is the top {@link TRENDING_COUNT} by
 * play count over the whole catalogue.
 *
 * `playCounts` is optional and defaults to the seeded `plays` on each game, so a
 * caller with no PostHog read still gets a sensible order rather than an empty
 * shelf — the same fallback `playsFor` uses in `Arcade`.
 */
export function categoryShelf(
  category: string,
  games: Game[],
  playCounts: Record<string, number> = {},
): Game[] {
  const plays = (g: Game) => playCounts[g.slug] ?? g.plays ?? 0;
  if (category === "New") return games.filter((g) => g.isNew);
  if (category === "Trending")
    return [...games].sort((a, b) => plays(b) - plays(a)).slice(0, TRENDING_COUNT);
  return games.filter((g) => g.category === category);
}
