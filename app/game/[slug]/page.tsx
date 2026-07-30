/**
 * A game's STORE PAGE.
 *
 * This route used to render `<Arcade initialPlaying={slug}>` — the entire catalog
 * with the fullscreen player already open over it. That meant all ~30 game pages
 * shipped a near-identical body differentiated only by `<title>` and an `sr-only`
 * h1, while the `description` and `tagline` in `app/lib/games.ts` rendered
 * nowhere a human could read them. Now the page is the listing: hero, screenshot
 * gallery, description, tags, stats, related games. Play opens the same overlay
 * as before, via `ArcadeShell`.
 *
 * IT MUST STAY STATICALLY PRERENDERABLE. No `auth()`, no `cookies()`, no
 * `headers()`, no `searchParams` — directly or through anything it renders on the
 * server. Any one of those makes the route dynamic, which drops it from
 * `.next/prerender-manifest.json`, which drops every `/game/<slug>` URL from the
 * precache list `scripts/build-sw-manifest.mjs` generates, which silently breaks
 * offline play. There is no error when that happens; the regression check is
 * `grep -c '"/game/' public/sw-manifest.js` after a build (currently 28).
 * Per-viewer data belongs in client islands that fetch from `/api/`.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArcadeShell } from "../../components/ArcadeShell";
import { GameStore } from "../../components/GameStore";
import { getGameCredit, resolveCredit } from "../../lib/game-credits";
import { getGameMedia, mediaPublicPath } from "../../lib/game-media";
import { getGameVideo } from "../../lib/game-videos";
import { resolveCategories, resolveGame, resolveGames } from "../../lib/games-store";
import { SITE_URL as BASE } from "../../lib/site";
import { getGamePlayCounts } from "../../lib/stats";
import { youtubeEmbedUrl, youtubeThumbnailUrl, youtubeWatchUrl } from "../../lib/youtube";

/**
 * Prerender EVERY resolved game, not just the static array.
 *
 * External (dashboard-created) games were previously absent here, so they
 * rendered on demand and never entered the service-worker precache — they did not
 * work offline at all. `resolveGames()` fails soft to the static catalogue, so a
 * build with no database reaches exactly the old behaviour rather than erroring.
 * `app/category/[category]/page.tsx` already sets this precedent.
 */
export async function generateStaticParams() {
  return (await resolveGames()).map((g) => ({ slug: g.slug }));
}

/** Absolute URL for OG/JSON-LD; `coverUrl` may already be absolute. */
function absolute(url: string): string {
  return url.startsWith("http") ? url : `${BASE}${url}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [game, media] = await Promise.all([resolveGame(slug), getGameMedia(slug)]);
  if (!game) return { title: "Game not found" };

  // Prefer a real screenshot for the social card: covers are ~659×561 (nearly
  // square) and get badly cropped by `summary_large_image`.
  const shot = media[0];
  const image = shot
    ? {
        url: absolute(mediaPublicPath(shot)),
        width: shot.width,
        height: shot.height,
        alt: shot.alt || game.title,
      }
    : {
        url: absolute(game.coverUrl ?? `/games/${game.slug}/cover.png`),
        width: 659,
        height: 561,
        alt: game.title,
      };

  // The description is now VISIBLE body copy too, so trim it for the SERP snippet
  // instead of letting Google cut it mid-word.
  const description =
    game.description.length > 155
      ? `${game.description.slice(0, 152).trimEnd()}…`
      : game.description;

  return {
    title: `Play ${game.title} Unblocked — Free Online`,
    description,
    keywords: [game.title, game.category, ...game.tags, "unblocked", "free"],
    // Load-bearing, not boilerplate: `skipTrailingSlashRedirect: true` means
    // `/game/<slug>/` serves this same page with NO 308 redirect, so the
    // trailing-slash form is a genuine duplicate URL. The canonical collapses it.
    alternates: { canonical: `/game/${game.slug}` },
    openGraph: {
      type: "website",
      title: game.title,
      description,
      url: `/game/${game.slug}`,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: game.title,
      description: game.tagline,
      images: [image.url],
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

  const [allGames, categories, playCounts, media, credit, video] = await Promise.all([
    resolveGames(),
    resolveCategories(),
    getGamePlayCounts(),
    getGameMedia(slug),
    // Fail-soft to null, like every other read here — a missing credit line must
    // never cost the page. Cached under its own tag, so it does not widen the
    // blast radius of a games-catalogue invalidation.
    getGameCredit(slug),
    // Same contract, and it keeps this route statically prerenderable: a cached
    // read with no cookies/headers/auth anywhere in it. See the docblock — going
    // dynamic here would silently drop every /game/<slug> from the service-worker
    // precache and break offline play with no error.
    getGameVideo(slug),
  ]);

  const plays = playCounts[game.slug] ?? game.plays ?? 0;

  // Same category first, topped up by play count, self excluded.
  const playsFor = (g: (typeof allGames)[number]) =>
    playCounts[g.slug] ?? g.plays ?? 0;
  const related = allGames
    .filter((g) => g.slug !== game.slug && g.category === game.category)
    .sort((a, b) => playsFor(b) - playsFor(a))
    .slice(0, 6);

  const url = `${BASE}/game/${game.slug}`;
  const imageUrls = media.length
    ? media.map((m) => absolute(mediaPublicPath(m)))
    : [absolute(game.coverUrl ?? `/games/${game.slug}/cover.png`)];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "VideoGame",
        name: game.title,
        description: game.description,
        url,
        image: imageUrls,
        ...(media.length ? { screenshot: imageUrls } : {}),
        genre: game.category,
        keywords: game.tags.join(", "),
        applicationCategory: "Game",
        gamePlatform: "Web Browser",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
        // A real, measured count. Deliberately NOT an aggregateRating: there is
        // no ratings feature and nothing rated rendered on the page, and Google
        // requires rating markup to be user-generated and visible. Synthesising
        // one earns a structured-data manual action against the whole domain.
        interactionStatistic: {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/PlayAction",
          userInteractionCount: plays,
        },
        // The gameplay/intro video, when one is attached.
        //
        // `uploadDate` IS DELIBERATELY ABSENT even though Google lists it as
        // required for VideoObject. We know when an admin pasted the link, which is
        // not when the video was published, and the two are frequently years apart.
        // Emitting the former as the latter would be asserting something we did not
        // observe — the same reason there is no `aggregateRating` above. The cost is
        // that this may not earn a video rich result; the alternative is inventing a
        // date, which risks a structured-data manual action against the whole domain.
        //
        // Every other property here is real: the name and description are the ones
        // rendered on the page, and both URLs are built from the stored id.
        ...(video
          ? {
              trailer: {
                "@type": "VideoObject",
                name: `${game.title} — ${video.label}`,
                description: game.tagline,
                // Metadata only, and `autoplay: false` accordingly — advertising an
                // autoplaying URL to crawlers and embedders would be wrong.
                embedUrl: youtubeEmbedUrl(video.youtubeId, { autoplay: false }),
                url: youtubeWatchUrl(video.youtubeId),
                thumbnailUrl: youtubeThumbnailUrl(video.youtubeId),
              },
            }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "HALLPASS", item: BASE },
          {
            "@type": "ListItem",
            position: 2,
            name: game.category,
            // Encoding must byte-match the sitemap, the sidebar links and the
            // on-page breadcrumb — categories are dashboard-editable and may
            // contain spaces or symbols.
            item: `${BASE}/category/${encodeURIComponent(game.category.toLowerCase())}`,
          },
          { "@type": "ListItem", position: 3, name: game.title, item: url },
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
      {/* External games get a preconnect so the DNS/TLS handshake to the
          third-party origin is already done when the iframe opens.

          Local games get NOTHING, deliberately. The obvious move —
          `<link rel="prefetch" href={`/game-html/${slug}/`} as="document">` — is
          worse than useless here: the service worker serves that path through
          `networkFirstWithStaticFallback`, which fetches with
          `cache: "no-store"`, bypassing the HTTP cache entirely. So the
          prefetched copy can never be reused, and the game document would be
          downloaded once on every store-page view (including for the majority of
          visitors who never press Play) and then downloaded AGAIN when they do.
          Local games are already precached by the service worker anyway. */}
      {game.externalUrl && (
        <link rel="preconnect" href={new URL(game.externalUrl).origin} />
      )}
      <ArcadeShell
        games={allGames}
        categories={categories}
        activeCategory={game.category}
      >
        <GameStore
          // KEYED ON THE SLUG so client-side state cannot outlive a navigation.
          // Moving between two store pages renders the same component type at the
          // same position, which React reconciles by KEEPING its state — so without
          // this, the media switch (and the gallery's slide index) would carry over
          // from the previous game, and you could arrive at a game showing the
          // "Screenshots" side because that is where you left the last one.
          key={game.slug}
          game={game}
          media={media}
          related={related}
          plays={plays}
          credit={resolveCredit(game, credit)}
          // Mapped into a structural prop rather than passed as the row: GameStore
          // is a client component and `game-videos.ts` is server-only.
          video={video ? { id: video.youtubeId, label: video.label } : null}
        />
      </ArcadeShell>
    </>
  );
}
