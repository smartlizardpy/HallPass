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
