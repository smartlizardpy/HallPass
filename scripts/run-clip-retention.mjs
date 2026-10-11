#!/usr/bin/env node
/**
 * HallPass — knock on the live site so it deletes expired beta clips and
 * screenshots.
 *
 * WHY THIS EXISTS. Beta testers attach a screen recording and/or screenshots to a
 * bug report, and those are kept for 30 days (`CLIP_RETENTION_DAYS` in
 * `app/lib/beta/config.ts`). The site can work out which are past that
 * (`POST /api/v1/admin/beta/clip-retention`), but nothing on a serverless
 * deployment WAKES UP to ask. This script is the thing that knocks, and
 * `.github/workflows/clip-retention.yml` is the alarm clock that runs it daily.
 * Same arrangement, and same secret, as `scripts/send-streak-reminders.mjs`.
 *
 * ── IT DECIDES NOTHING ─────────────────────────────────────────────────────
 * No report ids, paths or retention window leave this script. What is expired and
 * how it is deleted are decided on the deployment, where there are tests.
 *
 * ── A BROKEN RUN IS LOUD ───────────────────────────────────────────────────
 * No secret, wrong secret, site down, or migration 042 not applied (the endpoint
 * answers 503) all exit non-zero and turn the Actions run red. Individual items
 * that failed to delete do NOT fail the run (the next day retries them); they are
 * reported as a warning so a day-after-day failure is still visible.
 *
 * Environment:
 *   ALERTS_SECRET      required. The same secret the deployment holds.
 *   HALLPASS_SITE_URL  optional. Defaults to the production origin below.
 *
 * Usage:
 *   node scripts/run-clip-retention.mjs             delete what is expired
 *   node scripts/run-clip-retention.mjs --dry-run   report what is due; delete nothing
 */

import { appendFileSync } from "node:fs";

/** Matches `app/lib/site.ts`. Overridable for a preview deployment. */
const DEFAULT_SITE_URL = "https://hallpass-rouge.vercel.app";

const siteUrl = (process.env.HALLPASS_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const secret = (process.env.ALERTS_SECRET || "").trim();
const dryRun = process.argv.includes("--dry-run");

/** Matches `maxDuration` on the route. */
const TIMEOUT_MS = 60_000;

const annotate = (level, message) => console.log(`::${level}::${message}`);

function fail(message) {
  annotate("error", message);
  console.error(`\n${message}`);
  process.exit(1);
}

function summarise(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  } catch {
    /* summary is best-effort */
  }
}

if (!secret) {
  fail(
    "ALERTS_SECRET is not set. Add it as a repository secret (Settings → Secrets → Actions) " +
      "with the same value as ALERTS_SECRET on the deployment.",
  );
}

const path = "/api/v1/admin/beta/clip-retention";
let res;
try {
  res = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: {
      // In the header, never the URL: a query string is logged by every proxy.
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ dryRun }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
} catch (error) {
  fail(`POST ${path} could not be reached: ${error.message}`);
}

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = null;
}

if (!res.ok) fail(`POST ${path} answered ${res.status}: ${body?.error ?? text.slice(0, 300)}`);
if (!body) fail(`POST ${path} answered something that is not JSON.`);

console.log(`HallPass beta clip retention — ${siteUrl}`);
console.log(`  retention   ${body.retentionDays} days`);
console.log(`  due now     ${body.considered} report(s)  (batch of up to ${body.batch})`);
if (dryRun) {
  console.log("\n--dry-run: nothing was deleted.");
} else {
  console.log(`  cleared     ${body.cleared} report(s)`);
  console.log(`  blobs gone  ${body.blobsRemoved}`);
  console.log(`  failed      ${body.failed}  (kept, and retried by the next run)`);
}
if (body.more) {
  console.log("  (the batch was full; the next run continues with the rest)");
}
if (body.failed > 0) {
  annotate(
    "warning",
    `${body.failed} report(s) could not be fully cleaned and will be retried tomorrow. See the site's logs.`,
  );
}

summarise([
  "### HallPass beta clip retention",
  "",
  dryRun
    ? `- ${body.considered} report(s) past ${body.retentionDays} days, nothing deleted (dry run).`
    : `- ${body.considered} due, ${body.cleared} cleared, ${body.blobsRemoved} files deleted, ${body.failed} failed.`,
]);
