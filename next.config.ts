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
        // games, cached but patchable in place within the same /sdk/v1/ URL.
        source: "/sdk/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Cache-Control",
            value: "public, max-age=600, stale-while-revalidate=86400",
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
