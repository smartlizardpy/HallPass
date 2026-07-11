import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Arcade } from "../../components/Arcade";
import { games } from "../../lib/games";
import { resolveCategories, resolveGame, resolveGames } from "../../lib/games-store";
import { SITE_URL as BASE } from "../../lib/site";
import { getGamePlayCounts } from "../../lib/stats";

export function generateStaticParams() {
  return games.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = await resolveGame(slug);
  if (!game) return { title: "Game not found" };
  const cover = `/games/${game.slug}/cover.png`;
  const title = `Play ${game.title} Unblocked — Free Online`;
  return {
    title,
    description: game.description,
    keywords: [game.title, game.category, ...game.tags, "unblocked", "free"],
    alternates: { canonical: `/game/${game.slug}` },
    openGraph: {
      type: "website",
      title: game.title,
      description: game.description,
      url: `/game/${game.slug}`,
      images: [{ url: cover, width: 659, height: 561, alt: game.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: game.title,
      description: game.tagline,
      images: [cover],
    },
  };
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = await resolveGame(slug);
  if (!game) notFound();
  const [games, categories, playCounts] = await Promise.all([
    resolveGames(),
    resolveCategories(),
    getGamePlayCounts(),
  ]);

  const url = `${BASE}/game/${game.slug}`;
  const image = `${BASE}/games/${game.slug}/cover.png`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "VideoGame",
        name: game.title,
        description: game.description,
        url,
        image,
        genre: game.category,
        keywords: game.tags.join(", "),
        applicationCategory: "Game",
        gamePlatform: "Web Browser",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "HALLPASS", item: BASE },
          {
            "@type": "ListItem",
            position: 2,
            name: game.category,
            // Encode to match the sitemap/nav category URLs (categories are
            // free-form/dashboard-editable, so may contain spaces or symbols).
            item: `${BASE}/category/${encodeURIComponent(game.category.toLowerCase())}`,
          },
          { "@type": "ListItem", position: 3, name: game.title, item: url },
        ],
      },
    ],
  };

  return (
    <>
      <h1 className="sr-only">{game.title} — Unblocked</h1>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Arcade
        games={games}
        categories={categories}
        initialPlaying={slug}
        initialCategory={game.category}
        playCounts={playCounts}
      />
    </>
  );
}
