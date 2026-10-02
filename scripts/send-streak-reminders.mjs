#!/usr/bin/env node
/**
 * HallPass — knock on the live site so it sends its streak reminders.
 *
 * WHY THIS EXISTS. The site can work out who is due a "your streak ends tonight"
 * push (`POST /api/v1/admin/streaks/remind`), but nothing on a serverless
 * deployment WAKES UP to ask. This script is the thing that knocks, and
 * `.github/workflows/streak-reminders.yml` is the alarm clock that runs it every
 * hour. Same arrangement, and same secret, as `scripts/check-alerts.mjs`.
 *
 * ── IT DECIDES NOTHING ─────────────────────────────────────────────────────
 * No player ids and no wording leave this script. Who is due, at what local
 * hour, and what the notification says are all decided on the deployment, where
 * there are tests. A runner that judged for itself would be a second copy of the
 * rules, running against whatever checkout the workflow happened to fetch.
 *
 * ── A BROKEN RUN IS LOUD ───────────────────────────────────────────────────
 * No secret, wrong secret, site down, or the migration not applied (the endpoint
 * answers 503) all exit non-zero and turn the Actions run red. The one thing this
 * must not do is quietly report "nobody due" every hour for ever.
 *
 * ── THE QUIET RUNS ARE THE COMMON CASE ─────────────────────────────────────
 * A player's reminder hour is 17:00 where THEY are, so most hours only a slice
 * of the world is due, and some hours nobody is. A quiet run still prints its
 * counts so "why did nobody get one?" is answerable from the log.
 *
 * Environment:
 *   ALERTS_SECRET      required. The same secret the deployment holds.
 *   HALLPASS_SITE_URL  optional. Defaults to the production origin below.
 *
 * Usage:
 *   node scripts/send-streak-reminders.mjs             send what is due
 *   node scripts/send-streak-reminders.mjs --dry-run   report who is due; send nothing
 */

import { appendFileSync } from "node:fs";

/** Matches `app/lib/site.ts`. Overridable for a preview deployment. */
const DEFAULT_SITE_URL = "https://hallpass-rouge.vercel.app";

const siteUrl = (process.env.HALLPASS_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const secret = (process.env.ALERTS_SECRET || "").trim();
const dryRun = process.argv.includes("--dry-run");

/** A run does a few queries and a push per player, so allow more than the probe. */
const TIMEOUT_MS = 60_000; // matches `maxDuration` on the route

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

const path = "/api/v1/admin/streaks/remind";
let res;
try {
  res = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: {
      // The secret goes in the header, never the URL: a query string is logged by
      // every proxy it passes and would end up in the Actions log itself.
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

console.log(`HallPass streak reminders — ${siteUrl}`);
console.log(`  due now   ${body.due}`);
console.log(`  ${dryRun ? "would send" : "sent     "} ${dryRun ? body.due : body.claimed}`);
if (!dryRun && body.claimed < body.due) {
  console.log(
    "  (the rest were claimed by an overlapping run, or failed and were logged by the site)",
  );
}
if (body.capped) {
  // More players were due than one run will send to; the rest miss today's
  // reminder (their 17:00 hour has passed by the next run). See the route.
  annotate(
    "warning",
    `More than ${body.cap} players were due this hour; only the first ${body.cap} were processed.`,
  );
}
if (dryRun) console.log("\n--dry-run: nobody was notified.");

summarise([
  "### HallPass streak reminders",
  "",
  `- ${body.due} due, ${dryRun ? "none sent (dry run)" : `${body.claimed} sent`}.`,
]);
