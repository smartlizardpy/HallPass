import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Arcade } from "../../components/Arcade";
import {
  categoryPath,
  resolveCategoryFromSlug,
  routedCategories,
} from "../../lib/categories";
import { resolveCategories, resolveGames } from "../../lib/games-store";
import { SITE_URL as BASE } from "../../lib/site";
import { getGamePlayCounts } from "../../lib/stats";

export async function generateStaticParams() {
  return routedCategories(await resolveCategories()).map((c) => ({
    category: c.toLowerCase(),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const resolved = resolveCategoryFromSlug(category, await resolveCategories());
  if (!resolved) return { title: "Category not found" };
  const title = `${resolved} Games — Play Unblocked Free`;
  const description = `Play free unblocked ${resolved} games on HALLPASS.`;
  // One encoding, shared with the sitemap, the nav and the breadcrumb below.
  const path = categoryPath(resolved);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title,
      description,
      url: path,
    },
    twitter: {
      card: "summary_large_image",
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
  const resolved = resolveCategoryFromSlug(category, categories);
  if (!resolved) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "HALLPASS", item: BASE },
      {
        "@type": "ListItem",
        position: 2,
        name: `${resolved} Games`,
        item: `${BASE}${categoryPath(resolved)}`,
      },
    ],
  };

  return (
    <>
      <h1 className="sr-only">{resolved} Games — Unblocked</h1>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Arcade
        games={games}
        categories={categories}
        initialCategory={resolved}
        playCounts={playCounts}
      />
    </>
  );
}
