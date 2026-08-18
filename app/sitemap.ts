import type { MetadataRoute } from "next";
import { categoryPath, routedCategories } from "@/app/lib/categories";
import { resolveGames, resolveCategories } from "@/app/lib/games-store";
import { SITE_URL } from "@/app/lib/site";

const BASE = SITE_URL;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [games, categories] = await Promise.all([
    resolveGames(),
    resolveCategories(),
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

  return [...staticPages, ...categoryPages, ...gamePages];
}
