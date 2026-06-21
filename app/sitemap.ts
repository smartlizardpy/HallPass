import type { MetadataRoute } from "next";
import { games, categories } from "./lib/games";

const BASE = "https://hallpass.gg";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${BASE}/scoreboard`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
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
