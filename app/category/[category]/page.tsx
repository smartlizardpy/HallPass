import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Arcade } from "../../components/Arcade";
import { resolveCategories, resolveGames } from "../../lib/games-store";
import { getGamePlayCounts } from "../../lib/stats";

const VIRTUAL = ["New", "Trending"];

export async function generateStaticParams() {
  const categories = await resolveCategories();
  return [...VIRTUAL, ...categories].map((c) => ({
    category: c.toLowerCase(),
  }));
}

/** Validate a URL slug against the VIRTUAL + RESOLVED category list. */
function resolveCategory(slug: string, categories: string[]): string | null {
  const lower = slug.toLowerCase();
  const virtual = VIRTUAL.find((c) => c.toLowerCase() === lower);
  if (virtual) return virtual;
  return categories.find((c) => c.toLowerCase() === lower) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const resolved = resolveCategory(category, await resolveCategories());
  if (!resolved) return { title: "Category not found" };
  const title = `${resolved} games`;
  const description = `Play free unblocked ${resolved} games on HALLPASS.`;
  return {
    title,
    description,
    alternates: { canonical: `/category/${resolved.toLowerCase()}` },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/category/${resolved.toLowerCase()}`,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const [games, categories, playCounts] = await Promise.all([
    resolveGames(),
    resolveCategories(),
    getGamePlayCounts(),
  ]);
  const resolved = resolveCategory(category, categories);
  if (!resolved) notFound();
  return (
    <Arcade
      games={games}
      categories={categories}
      initialCategory={resolved}
      playCounts={playCounts}
    />
  );
}
