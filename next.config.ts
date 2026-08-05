import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.142"],
  experimental: {
    // Multi-file game bundles are uploaded through a Server Action; Next's
    // default 1 MB action body cap would reject any real .zip bundle.
    serverActions: { bodySizeLimit: "25mb" },
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        // PUBLIC PROFILES ARE NEVER INDEXED — the header half of a two-part
        // signal whose other half is the `robots` metadata in
        // `app/u/[username]/page.tsx`. Read that file's docblock for the full
        // argument; the short version:
        //
        //   * A `robots.txt` Disallow would be WRONG here, not merely weaker. It
        //     prevents CRAWLING, so the crawler never fetches the page and never
        //     sees the noindex — a disallowed-but-linked URL can still be
        //     indexed as a bare URL, and the directive that would remove it can
        //     never be read. `app/robots.ts` therefore stays `Allow: /`.
        //   * The meta tag alone is not enough. Next answers a STREAMED
        //     `not-found.js` with HTTP 200, and a header applies to responses no
        //     HTML parser ever reaches the <head> of.
        //
        // A search-indexed directory of school-age players — photographs,
        // display names, what they play — is the thing this site must not build,
        // and indexing would also defeat a username rename by leaving the old
        // name in results (with a cached snapshot) for weeks.
        //
        // `:path*` rather than `:username` so it also covers `/u/name/` (this
        // config sets `skipTrailingSlashRedirect`, so that URL is served, not
        // redirected) and anything nested added later.
        source: "/u/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noimageindex, noarchive",
          },
        ],
      },
      {
        // BETA SURFACES ARE NEVER INDEXED — same two-part signal as `/u/:path*`
        // above, for the same reason: the `robots` metadata in each page is not
        // enough on its own, because Next answers a streamed `not-found.js` with
        // HTTP 200 and a header applies to responses no HTML parser reaches the
        // `<head>` of.
        //
        // What is behind here is unreleased games, a roster of who is testing
        // them, and screen recordings of children playing — none of which has
        // any business in a search index. `:path*` rather than a fixed segment
        // so it covers `/beta/session/<slug>` and anything nested added later.
        source: "/beta/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noimageindex, noarchive",
          },
        ],
      },
      {
        // Versioned Scoreboard SDK artifact: loadable cross-origin by standalone
        // games, patchable in place within the same /sdk/v1/ URL. The URL is
        // stable across deploys, so it must revalidate on every load — Next
        // serves public/ files with a strong ETag, so an unchanged bundle is a
        // cheap 304 while a redeployed bundle reaches players on their next
        // online load. Keep Access-Control-Allow-Origin so embedded third-party
        // games can still load it cross-origin.
        source: "/sdk/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // Service worker + the manifest it importScripts(). Registration uses
        // the default updateViaCache "imports", so /sw.js bypasses the HTTP
        // cache on update checks but /sw-manifest.js does not — pin both to
        // revalidate so a redeployed SW (and its manifest) is picked up
        // promptly instead of being served from a stale HTTP cache.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // See note on /sw.js above — the imported manifest is HTTP-cacheable
        // under updateViaCache "imports", so it needs the same revalidation.
        source: "/sw-manifest.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  // Load-bearing for games: the player iframe loads /game-html/<slug>/ and
  // multi-file games rely on that trailing slash for relative asset URLs.
  // Removing this flag re-enables Next's global 308 slash-stripping redirect
  // and breaks every bundled game's ./asset references.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
