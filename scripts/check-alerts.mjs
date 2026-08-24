#!/usr/bin/env node
/**
 * HallPass — ask the live site how it is doing, and tell the admins if it is
 * worth telling.
 *
 * WHY THIS EXISTS. The site can measure itself (`GET /api/v1/admin/alerts`) and
 * it can announce what it measured (`POST /api/v1/admin/alerts/notify`), but
 * nothing on a serverless deployment WAKES UP to do either. Vercel functions run
 * when somebody asks; a spike at 14:20 on a Tuesday is exactly the moment nobody
 * is looking at the dashboard. This script is the thing that looks, and
 * `.github/workflows/alerts.yml` is the alarm clock that runs it every half
 * hour.
 *
 * ── IT DECIDES NOTHING ─────────────────────────────────────────────────────
 * Deliberately thin: fetch, check, post, print. Every threshold and every rule
 * lives in `app/lib/alerts/`, where there are tests. A runner that judged for
 * itself would be a second copy of the rules that nothing can test and nobody
 * would remember to update — and it would run against whatever version of the
 * repo the workflow happened to check out, rather than against the deploy it is
 * measuring.
 *
 * ── A BROKEN ALERTER IS LOUD ───────────────────────────────────────────────
 * Any failure — no secret, wrong secret, PostHog unreachable, the site down —
 * exits non-zero, which turns the Actions run red and mails whoever owns the
 * repository. The one thing this must never do is quietly report "nothing to
 * see" every half hour for ever; `app/lib/alerts/metrics.ts` makes the same
 * argument from the other end.
 *
 * ── THE QUIET RUNS ARE THE COMMON CASE ─────────────────────────────────────
 * Most runs find nothing, so a silent run still prints the counts it judged. "Why
 * did this not fire?" is then answerable from the log rather than from a
 * reconstruction six hours later.
 *
 * Environment:
 *   ALERTS_SECRET      required. The same secret the deployment holds.
 *   HALLPASS_SITE_URL  optional. Defaults to the production origin below.
 *
 * Usage:
 *   node scripts/check-alerts.mjs             measure, and notify if anything fired
 *   node scripts/check-alerts.mjs --dry-run   measure and print; notify nobody
 */

import { appendFileSync } from "node:fs";

/** Matches `app/lib/site.ts`. Overridable for a preview deployment. */
const DEFAULT_SITE_URL = "https://hallpass-rouge.vercel.app";

const siteUrl = (process.env.HALLPASS_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const secret = (process.env.ALERTS_SECRET || "").trim();
const dryRun = process.argv.includes("--dry-run");

/** Give up rather than hold a scheduled job open on an unresponsive deploy. */
const TIMEOUT_MS = 20_000;

/** GitHub Actions annotations. Harmless no-ops outside CI. */
const annotate = (level, message) => console.log(`::${level}::${message}`);

function fail(message) {
  annotate("error", message);
  console.error(`\n${message}`);
  process.exit(1);
}

/**
 * One authenticated call to the site.
 *
 * The secret goes in `Authorization: Bearer`, never in the URL — a query string
 * is logged by every proxy it passes and would end up in the Actions log itself.
 * A non-2xx answer carries the API's own `error` string, which is what makes the
 * difference between "not configured" and "wrong key" visible in CI without
 * anybody opening a dashboard.
 */
async function call(path, init = {}) {
  const url = `${siteUrl}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${secret}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    fail(`${init.method ?? "GET"} ${path} could not be reached: ${error.message}`);
  }

  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const detail = parsed?.error ?? body.slice(0, 300);
    fail(`${init.method ?? "GET"} ${path} answered ${res.status}: ${detail}`);
  }
  if (!parsed) fail(`${init.method ?? "GET"} ${path} answered something that is not JSON.`);
  return parsed;
}

/** One line per alert, for a human reading the run. */
function describe(alert) {
  switch (alert.id) {
    case "traffic_spike":
      return `traffic_spike — ${alert.visitors} players this hour, ~${
        Math.round(alert.ratio * 10) / 10
      }× the usual (${alert.baseline})`;
    case "error_spike":
      return `error_spike — ${alert.errors} errors this hour${
        alert.ratio ? `, ~${Math.round(alert.ratio)}× the usual (${alert.baseline})` : ""
      }`;
    case "content_gap":
      return `content_gap — ${alert.people} players searched "${alert.term}" and found nothing`;
    default:
      // A deploy newer than this checkout. Report it rather than dropping it.
      return `${alert.id} — ${JSON.stringify(alert)}`;
  }
}

/** Best-effort run summary on the Actions run page. */
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

const probe = await call("/api/v1/admin/alerts");
const { snapshot, alerts = [] } = probe;

// The evidence, printed on every run including the quiet ones.
console.log(`HallPass alerts — ${siteUrl}`);
console.log(`  measured at   ${snapshot?.takenAt} (${snapshot?.windowMinutes} minute window)`);
console.log(
  `  this window   ${snapshot?.current?.visitors} players, ${snapshot?.current?.errors} errors`,
);
console.log(
  `  same hour x${snapshot?.baseline?.visitors?.length ?? 0}d  players ${JSON.stringify(
    snapshot?.baseline?.visitors ?? [],
  )}, errors ${JSON.stringify(snapshot?.baseline?.errors ?? [])}`,
);
console.log(`  missing games ${JSON.stringify(snapshot?.missingGames ?? [])}`);

if (alerts.length === 0) {
  console.log("\nNothing to report.");
  summarise([
    "### HallPass alerts",
    "",
    "Nothing to report.",
    "",
    `- ${snapshot?.current?.visitors} players and ${snapshot?.current?.errors} errors in the last ${snapshot?.windowMinutes} minutes.`,
  ]);
  process.exit(0);
}

console.log(`\n${alerts.length} alert(s) fired:`);
for (const alert of alerts) {
  console.log(`  • ${describe(alert)}`);
  annotate("notice", describe(alert));
}

if (dryRun) {
  console.log("\n--dry-run: nobody was notified.");
  process.exit(0);
}

const notified = await call("/api/v1/admin/alerts/notify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ alerts }),
});

// `rejected` is how a runner that has drifted from the server's idea of an alert
// shows up as a number rather than as notifications that never arrive.
if (notified.rejected > 0) {
  annotate(
    "warning",
    `${notified.rejected} alert(s) were rejected by the site — this checkout may be older than the deploy.`,
  );
}

console.log(`\nNotified: ${(notified.notified ?? []).join(", ") || "(none)"}`);
console.log(
  "A notification already sent within its cooldown window is filed once and no more, " +
    "so an ongoing spike is not re-announced every half hour.",
);

summarise([
  "### HallPass alerts",
  "",
  ...alerts.map((alert) => `- **${describe(alert)}**`),
  "",
  `Notified: \`${(notified.notified ?? []).join("`, `") || "none"}\``,
]);
