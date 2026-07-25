import posthog from "posthog-js";

// NEXT_PUBLIC_ vars are inlined at BUILD time, so this token must already be
// present in the Vercel project settings (and in .env.local for local dev)
// before `next build` runs — see the "Environment variables" table in
// README.md. When it is missing the value is `undefined`, `posthog.init` quietly
// no-ops, and NOTHING is captured — not even automatic $autocapture / $pageview
// / $pageleave — which shows up as an empty PostHog dashboard even after real
// usage. Guard on the token so that failure mode is loud and actionable instead
// of silent.
const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (posthogToken) {
  posthog.init(posthogToken, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-05-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
} else {
  console.warn(
    "[PostHog] NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is not set — analytics is " +
      "disabled and no events will be captured. Set it in your Vercel project " +
      "settings (and .env.local for local dev), then redeploy.",
  );
}
