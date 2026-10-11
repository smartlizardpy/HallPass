import posthog from "posthog-js";
import { initConsoleCapture } from "@/app/lib/console-capture";
import { REF_PARAM } from "@/app/lib/growth/channels";
import { recordFirstTouchRef } from "@/app/lib/growth/first-touch";
import {
  ANALYTICS_CHOICE_EVENT,
  ANALYTICS_OPTOUT_KEY,
  isAnalyticsOptedOut,
} from "@/app/lib/analytics-consent";

// Start buffering console output + uncaught errors as early as possible (this
// file runs before hydration on every page load) so warnings like the
// missing-token notice below are visible to super admins on the dashboard
// "Logs" page — no devtools required. See app/dashboard/(app)/logs.
initConsoleCapture();

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
  // The device's analytics choice (see `app/lib/analytics-consent.ts`). Read
  // BEFORE init so an opted-out device never has an ID written, even briefly.
  const optedOut = isAnalyticsOptedOut();

  posthog.init(posthogToken, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-05-30",
    capture_exceptions: true,
    // Marketing links carry `?ref=<channel>` (see `app/lib/growth/channels.ts`
    // for why a short typable code rather than a utm pair). Naming it here
    // routes it through the SDK's own campaign-param handling, so it is treated
    // exactly like `utm_source` — captured on the pageview and registered as a
    // super property — instead of by a parser of ours that could drift from it.
    custom_campaign_params: [REF_PARAM],
    // CHILDREN'S AUDIENCE: session replay is forced off in code, so it cannot
    // be switched on from the PostHog dashboard (the SDK only records when this
    // is false AND remote config enables it). The other remote-driven features
    // that inject UI or capture extra interaction data are off for the same
    // reason; the site uses none of them.
    disable_session_recording: true,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    capture_heatmaps: false,
    // An opted-out device starts opted out and with persistence disabled, so
    // the SDK writes no cookie/localStorage ID at all. Both options are read at
    // init, which is why they come from the stored choice here.
    opt_out_capturing_by_default: optedOut,
    opt_out_persistence_by_default: optedOut,
    debug: process.env.NODE_ENV === "development",
  });

  if (optedOut) posthog.opt_out_capturing();

  // Apply a change LIVE: the settings switch / notice fire this event in the
  // same tab, and the `storage` event carries it from other tabs. Opting out
  // turns persistence off first so the SDK also clears the stored device ID.
  const applyChoice = (nowOptedOut: boolean) => {
    try {
      if (nowOptedOut) {
        posthog.set_config({ opt_out_persistence_by_default: true });
        posthog.opt_out_capturing();
      } else {
        posthog.set_config({ opt_out_persistence_by_default: false });
        posthog.opt_in_capturing({ captureEventName: false });
      }
    } catch {
      /* Analytics must never take the page down. */
    }
  };
  window.addEventListener(ANALYTICS_CHOICE_EVENT, (e) =>
    applyChoice(Boolean((e as CustomEvent<boolean>).detail)),
  );
  window.addEventListener("storage", (e) => {
    if (e.key === ANALYTICS_OPTOUT_KEY || e.key === null) {
      applyChoice(isAnalyticsOptedOut());
    }
  });

  // Last touch is now handled above; this is the first-touch half, which the SDK
  // does not cover for a CUSTOM campaign param and could not record for most of
  // our players anyway (person profiles are `identified_only`, and much of this
  // audience cannot sign in at all). See the module header.
  recordFirstTouchRef();
} else {
  console.warn(
    "[PostHog] NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is not set — analytics is " +
      "disabled and no events will be captured. Set it in your Vercel project " +
      "settings (and .env.local for local dev), then redeploy.",
  );
}
