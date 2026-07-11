import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Arcade } from "../../components/Arcade";
import { resolveCategories, resolveGames } from "../../lib/games-store";
import { SITE_URL as BASE } from "../../lib/site";
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
  const title = `${resolved} Games — Play Unblocked Free`;
  const description = `Play free unblocked ${resolved} games on HALLPASS.`;
  // Encode to match the sitemap/nav category URLs (app/sitemap.ts).
  const path = `/category/${encodeURIComponent(resolved.toLowerCase())}`;
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
  const resolved = resolveCategory(category, categories);
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
        item: `${BASE}/category/${encodeURIComponent(resolved.toLowerCase())}`,
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
