import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.142"],
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
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
