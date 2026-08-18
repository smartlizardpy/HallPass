import type { MetadataRoute } from "next";
import { categoryPath, routedCategories } from "@/app/lib/categories";
import { resolveGames, resolveCategories, resolveTags } from "@/app/lib/games-store";
import { landingTags, tagPath } from "@/app/lib/tags";
import { SITE_URL } from "@/app/lib/site";

const BASE = SITE_URL;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [games, categories, tags] = await Promise.all([
    resolveGames(),
    resolveCategories(),
    resolveTags(),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  const categoryPages: MetadataRoute.Sitemap = routedCategories(categories).map(
    (cat) => ({
      url: `${BASE}${categoryPath(cat)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }),
  );

  // Tag pages are the catalogue's second axis — a query that is not a title.
  // `landingTags` applies the floor, so this lists exactly the tags that have a
  // page: a URL here that 404s is worse than a page Google has to find on its
  // own, and the route resolves against the same floor.
  const tagPages: MetadataRoute.Sitemap = landingTags(tags).map(({ tag }) => ({
    url: `${BASE}${tagPath(tag)}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    // Below categories, which are the curated axis and carry the nav, and below
    // the game pages they lead to.
    priority: 0.6,
  }));

  // Game pages are the money pages — the ones built to rank for
  // "play <game> unblocked" — so they get the strongest signal after the home
  // grid, and `weekly` rather than `monthly` because reviews, achievements and
  // media now change them.
  const gamePages: MetadataRoute.Sitemap = games.map((g) => ({
    url: `${BASE}/game/${g.slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...categoryPages, ...tagPages, ...gamePages];
}
