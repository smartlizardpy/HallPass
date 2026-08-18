/**
 * A TAG's landing page — `/tag/local-co-op`.
 *
 * The catalogue's second axis, finally routed. `resolveTags()` has counted these
 * for the dashboard's curation page for a long time, and `GameStore`'s spec
 * sheet has rendered them as plain text with a docblock explaining that there
 * was nowhere to link them to. This is that somewhere.
 *
 * WHY IT IS WORTH A PAGE AT ALL: in this niche each game title is its own query,
 * which is what makes the catalogue's size the ceiling. A tag is a query that is
 * NOT a title — "unblocked shooter games", "2 player unblocked games" — so it is
 * one of the few surfaces here that can rank without a new game behind it.
 *
 * IT MUST STAY STATICALLY PRERENDERABLE, exactly as `app/game/[slug]/page.tsx`
 * must and for the same reason: no `auth()`, no `cookies()`, no `headers()`, no
 * `searchParams`, directly or through anything it renders on the server. Going
 * dynamic drops it from `prerender-manifest.json`, which drops it from the
 * service-worker precache, silently and with no error.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArcadeShell } from "../../components/ArcadeShell";
import { TagListing } from "../../components/TagListing";
import { resolveCategories, resolveGames, resolveTags } from "../../lib/games-store";
import { SITE_URL as BASE } from "../../lib/site";
import { landingTags, resolveTagFromSlug, tagPath, tagShelf } from "../../lib/tags";

/** How many other tags the page offers as onward navigation. */
const RELATED_TAGS = 12;

/**
 * Prerender a page for every tag that earns one. `landingTags` applies the
 * floor, so a tag on a single game never becomes a route — and because
 * `resolveTagFromSlug` applies the same floor, its URL 404s rather than
 * rendering an orphan page nothing links to.
 */
export async function generateStaticParams() {
  return landingTags(await resolveTags()).map(({ tag }) => ({
    tag: tagPath(tag).replace("/tag/", ""),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const resolved = resolveTagFromSlug(tag, await resolveTags());
  if (!resolved) return { title: "Tag not found" };

  const title = `${resolved} Games — Play Unblocked Free`;
  const description = `Play free unblocked ${resolved.toLowerCase()} games on HALLPASS. No download, no account, works offline.`;
  return {
    title,
    description,
    // `skipTrailingSlashRedirect: true` means `/tag/<slug>/` serves this same
    // page with no 308, so the trailing-slash form is a genuine duplicate URL —
    // the argument the game page's canonical is written under, unchanged.
    alternates: { canonical: tagPath(resolved) },
    openGraph: {
      type: "website",
      title,
      description,
      url: tagPath(resolved),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const [games, categories, tags] = await Promise.all([
    resolveGames(),
    resolveCategories(),
    resolveTags(),
  ]);

  const resolved = resolveTagFromSlug(tag, tags);
  if (!resolved) notFound();

  const shelf = tagShelf(resolved, games);
  // The floor guarantees a shelf, but the two reads above are separate cached
  // calls: a tag counted from one snapshot could in principle be listed by a
  // newer one. An empty shelf is a 404 rather than a page that says nothing.
  if (shelf.length === 0) notFound();

  const related = landingTags(tags)
    .filter((t) => t.tag !== resolved)
    .slice(0, RELATED_TAGS);

  const url = `${BASE}${tagPath(resolved)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: `${resolved} Games`,
        description: `Free unblocked ${resolved.toLowerCase()} games on HALLPASS.`,
        url,
        // Every entry is a link to a page that exists and lists the same game —
        // the list markup describes exactly what is rendered below it.
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
          {
            "@type": "ListItem",
            position: 2,
            name: `${resolved} Games`,
            item: url,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <ArcadeShell games={games} categories={categories}>
        <TagListing tag={resolved} games={shelf} related={related} />
      </ArcadeShell>
    </>
  );
}
