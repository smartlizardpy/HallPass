#!/usr/bin/env node
// Verifies the environment a production build will be compiled with actually
// carries the vars analytics depends on — so a deploy that would silently ship
// broken analytics fails LOUDLY here instead.
//
// Why this matters: `NEXT_PUBLIC_*` vars are inlined at BUILD time. If
// NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is absent when the build runs, posthog.init
// no-ops and NO events are ever captured (see instrumentation-client.ts) — which
// is exactly how "we got no analytics data" happened.
//
// Usage (in CI, after `vercel pull` has written the real production env file):
//   node --env-file=.vercel/.env.production.local scripts/check-build-env.mjs
// The `--env-file` flag loads those vars into process.env; this script then
// checks presence only — it never prints or logs any value.
//
// Exit codes: 0 = all required present; 1 = a required var is missing (unless
// POSTHOG_ENV_CHECK=warn, which downgrades the failure to a warning).

import { appendFileSync } from "node:fs";

// Required to build a working deployment. Missing → fail (by default).
const REQUIRED = [
  {
    name: "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
    why: "Client analytics capture (browser → PostHog). Inlined at build; without it zero events are recorded.",
  },
];

// Nice to have — only the admin dashboard's server-side play-count panels need
// these. Missing → warn, never block.
const RECOMMENDED = [
  {
    name: "POSTHOG_PROJECT_ID",
    why: "Server-side play-count queries for the dashboard.",
  },
  {
    name: "POSTHOG_PERSONAL_API_KEY",
    why: "Server-side read access for play-count queries.",
  },
];

const isSet = (name) => {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
};

// Treat missing-required as a warning instead of an error when asked.
const softFail =
  process.env.POSTHOG_ENV_CHECK === "warn" || process.argv.includes("--soft");

const missingRequired = REQUIRED.filter((v) => !isSet(v.name));
const missingRecommended = RECOMMENDED.filter((v) => !isSet(v.name));

// GitHub Actions annotations (harmless no-ops outside CI).
for (const v of missingRequired) {
  console.log(
    `::${softFail ? "warning" : "error"}::Missing ${v.name} — ${v.why}`,
  );
}
for (const v of missingRecommended) {
  console.log(`::warning::Missing ${v.name} — ${v.why}`);
}

// Human-readable log (values never printed — presence only).
const mark = (name) => (isSet(name) ? "✓ set" : "✗ MISSING");
console.log("PostHog build-env check:");
for (const v of [...REQUIRED, ...RECOMMENDED]) {
  console.log(`  ${mark(v.name)}  ${v.name}`);
}

// Step summary for the Actions run page, if available.
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = [...REQUIRED, ...RECOMMENDED]
    .map(
      (v) =>
        `| \`${v.name}\` | ${isSet(v.name) ? "✅ set" : "❌ missing"} | ${REQUIRED.includes(v) ? "required" : "recommended"} |`,
    )
    .join("\n");
  try {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### PostHog build-env check\n\n| Variable | Status | Level |\n|---|---|---|\n${rows}\n`,
    );
  } catch {
    /* summary is best-effort */
  }
}

if (missingRequired.length > 0 && !softFail) {
  console.error(
    `\nBuild env check failed: ${missingRequired
      .map((v) => v.name)
      .join(", ")} not set for this build.\n` +
      "Add it in Vercel → Settings → Environment Variables (Production), then " +
      "re-run. To make this non-blocking, set POSTHOG_ENV_CHECK=warn.",
  );
  process.exit(1);
}

console.log(
  missingRequired.length > 0
    ? "\nRequired var(s) missing, but POSTHOG_ENV_CHECK=warn — continuing."
    : "\nAll required build env present.",
);
