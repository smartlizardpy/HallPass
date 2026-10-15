import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Arcade } from "../../components/Arcade";
import Link from "next/link";
import {
  categoryPath,
  categoryShelf,
  categorySummary,
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
  const [categories, games] = await Promise.all([resolveCategories(), resolveGames()]);
  const resolved = resolveCategoryFromSlug(category, categories);
  if (!resolved) return { title: "Category not found" };
  // The site title template appends " · HALLPASS".
  const title = `${resolved} Games — Play Free in Your Browser`;
  const description = `${categorySummary(resolved, categoryShelf(resolved, games))} Free unblocked ${resolved.toLowerCase()} games for school or home.`;
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

  const shelf = categoryShelf(resolved, games, playCounts);
  const summary = categorySummary(resolved, shelf);
  const otherCategories = categories.filter((c) => c !== resolved);
  const url = `${BASE}${categoryPath(resolved)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: `${resolved} Games`,
        description: summary,
        url,
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: shelf.length,
          itemListElement: shelf.map((g, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: g.title,
            url: `${BASE}/game/${g.slug}`,
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "HALLPASS", item: BASE },
          { "@type": "ListItem", position: 2, name: `${resolved} Games`, item: url },
        ],
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
      {/* Server-rendered so it is in the HTML crawlers receive: a plain summary,
          the games on this shelf, and onward links to the other genres. */}
      <section
        aria-label={`About ${resolved} games`}
        className="mx-auto max-w-5xl px-4 pb-10 text-sm text-foreground-2"
      >
        <p>{summary}</p>
        {shelf.length > 0 && (
          <p className="mt-2">
            Play:{" "}
            {shelf.map((g, i) => (
              <span key={g.slug}>
                {i > 0 && ", "}
                <Link href={`/game/${g.slug}`} className="underline underline-offset-2 hover:text-brand">
                  {g.title}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
        {otherCategories.length > 0 && (
          <p className="mt-2">
            More genres:{" "}
            {otherCategories.map((c, i) => (
              <span key={c}>
                {i > 0 && ", "}
                <Link href={categoryPath(c)} className="underline underline-offset-2 hover:text-brand">
                  {c}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </section>
    </>
  );
}
