import type { Game } from "@/app/lib/games";

/**
 * HallPass — tag URLs, and which tags earn a page at all.
 *
 * Tags are the catalogue's second axis. Every game carries a few (`Shooter`,
 * `Local Co-op`, `Bullet Hell`), the dashboard curates them, and until `/tag/…`
 * existed they rendered as PLAIN TEXT on the store page — `GameStore`'s spec
 * sheet said so in a docblock, and said why: there was no route to land on.
 *
 * ── A TAG IS NOT AN IDENTIFIER, AND THE URL CANNOT PRETEND OTHERWISE ───────
 * `renameTag()` rewrites a tag across the whole catalogue from the dashboard, so
 * the string is editable display copy that happens to be routable. Two
 * consequences, both accepted deliberately (see `discovery-design.md` §3):
 *   - Renaming a tag CHANGES ITS URL and 404s the old one. No redirect table is
 *     built for that; it is the same shape of problem as revocable `ref` codes,
 *     and the same answer applies — it earns itself when real usage demands it.
 *   - Resolution goes through the LIVE tag list, never through a stored id. A
 *     slug that matches nothing is a 404, not an empty shelf.
 *
 * ── THE FLOOR ──────────────────────────────────────────────────────────────
 * A tag on ONE game is that game's store page with extra steps: same art, same
 * copy, one link — a thin duplicate competing with the page it duplicates.
 * {@link TAG_PAGE_MIN_GAMES} is the floor, and tags under it stay unlinked
 * plain text exactly as they were.
 *
 * PURE, and deliberately free of `server-only`: the resolved tag list is passed
 * in rather than read here, so this unit tests in the plain `node` environment
 * and the game page can ask the same questions on the server that the route does.
 */

/**
 * Fewest games a tag needs before it gets a landing page.
 *
 * Two, not three: at two the page is already a genuine comparison — "these are
 * the local co-op ones" — which is the thing a store page cannot be. At one it
 * is a duplicate.
 */
export const TAG_PAGE_MIN_GAMES = 2;

/**
 * A tag as it appears in a URL: lowercase, spaces and punctuation collapsed to
 * single hyphens. `Local Co-op` → `local-co-op`, `Bullet Hell` → `bullet-hell`,
 * `3D` → `3d`.
 *
 * Hyphens rather than percent-encoded spaces, which is the one place this
 * deliberately parts company with `categoryPath()`. Categories were already
 * routed as `/category/bullet%20hell` before any of this and their URLs are
 * indexed under it; tags have no history to preserve, and a tag URL is the one
 * somebody reads off a poster.
 */
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The canonical path for a tag — the ONE encoding every link uses. */
export function tagPath(tag: string): string {
  return `/tag/${tagSlug(tag)}`;
}

/**
 * The tags that get a landing page: those carried by at least
 * {@link TAG_PAGE_MIN_GAMES} games, in the order `resolveTags()` returns them
 * (count DESC, then alphabetical).
 *
 * A tag whose slug is empty — one written entirely in punctuation or in a script
 * this slugger cannot romanise — is dropped rather than routed at `/tag/`.
 */
export function landingTags(
  tags: { tag: string; count: number }[],
): { tag: string; count: number }[] {
  return tags.filter(
    (t) => t.count >= TAG_PAGE_MIN_GAMES && tagSlug(t.tag) !== "",
  );
}

/**
 * Resolve a URL segment back to the tag as it is WRITTEN, or `null`.
 *
 * Resolves ONLY against tags that earn a page, so a below-floor tag's URL is a
 * 404 rather than a page nothing links to. Where two tags collide on one slug
 * (`Co-op` and `Co op`, say), the first wins — which, given the sort order
 * `resolveTags()` uses, is the one on more games.
 */
export function resolveTagFromSlug(
  slug: string,
  tags: { tag: string; count: number }[],
): string | null {
  const wanted = tagSlug(slug);
  if (wanted === "") return null;
  return landingTags(tags).find((t) => tagSlug(t.tag) === wanted)?.tag ?? null;
}

/**
 * The games carrying a tag, in catalogue order.
 *
 * Case-insensitive on the tag itself: `resolveTags()` counts tags exactly as
 * stored, and two games can disagree about capitalising `co-op` without either
 * being wrong. Matching loosely here means such a page lists both rather than
 * silently half of them.
 */
export function tagShelf(tag: string, games: Game[]): Game[] {
  const wanted = tag.toLowerCase();
  return games.filter((g) => g.tags.some((t) => t.toLowerCase() === wanted));
}
