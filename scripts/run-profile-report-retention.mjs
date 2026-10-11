#!/usr/bin/env node
/**
 * HallPass — knock on the live site so it deletes resolved profile reports that
 * are past retention (`PROFILE_REPORT_RETENTION_DAYS`, 90 days after resolution,
 * in `app/lib/profile-reports/config.ts`).
 *
 * Same arrangement, secret and failure rules as `scripts/run-clip-retention.mjs`
 * (read its header): the runner decides nothing, and a broken run (no secret,
 * wrong secret, site down, migration 043 missing) exits non-zero. Run by the
 * second step of `.github/workflows/clip-retention.yml`.
 *
 * Environment:
 *   ALERTS_SECRET      required.
 *   HALLPASS_SITE_URL  optional. Defaults to the production origin.
 *
 * Usage:
 *   node scripts/run-profile-report-retention.mjs             delete what is expired
 *   node scripts/run-profile-report-retention.mjs --dry-run   count only
 */

import { appendFileSync } from "node:fs";

/** Matches `app/lib/site.ts`. Overridable for a preview deployment. */
const DEFAULT_SITE_URL = "https://www.hallpass.games";

const siteUrl = (process.env.HALLPASS_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const secret = (process.env.ALERTS_SECRET || "").trim();
const dryRun = process.argv.includes("--dry-run");

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

const path = "/api/v1/admin/profile-reports/retention";
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

console.log(`HallPass profile-report retention — ${siteUrl}`);
console.log(`  retention   ${body.retentionDays} days after resolution`);
if (dryRun) {
  console.log(`  due now     ${body.due} resolved report(s)`);
  console.log("\n--dry-run: nothing was deleted.");
} else {
  console.log(`  deleted     ${body.deleted} resolved report(s)`);
}

summarise([
  "### HallPass profile-report retention",
  "",
  dryRun
    ? `- ${body.due} resolved report(s) past ${body.retentionDays} days, nothing deleted (dry run).`
    : `- ${body.deleted} resolved report(s) deleted (more than ${body.retentionDays} days after resolution).`,
]);
