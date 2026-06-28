import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Arcade } from "../../components/Arcade";
import { games } from "../../lib/games";
import { resolveCategories, resolveGame, resolveGames } from "../../lib/games-store";
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
  const title = `Play ${game.title} free`;
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
  return (
    <Arcade
      games={games}
      categories={categories}
      initialPlaying={slug}
      initialCategory={game.category}
      playCounts={playCounts}
    />
  );
}
