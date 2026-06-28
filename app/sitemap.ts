import type { MetadataRoute } from "next";
import { resolveGames, resolveCategories } from "@/app/lib/games-store";

const BASE = "https://hallpass.gg";

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

  const categoryPages: MetadataRoute.Sitemap = [
    ...categories,
    "New",
    "Trending",
  ].map((cat) => ({
    url: `${BASE}/category/${encodeURIComponent(cat.toLowerCase())}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const gamePages: MetadataRoute.Sitemap = games.map((g) => ({
    url: `${BASE}/game/${g.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...categoryPages, ...gamePages];
}
