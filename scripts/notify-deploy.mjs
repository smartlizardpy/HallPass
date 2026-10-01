#!/usr/bin/env node
/**
 * HallPass — tell the admins a new version has gone live.
 *
 * The last step of `.github/workflows/deploy.yml`. It posts the deployed commit
 * sha and its RAW commit message to `POST /api/v1/admin/deploy/notify`, and the
 * site does the rest: it works out the title and PR number, words the
 * notification, and files it for every admin. Like `check-alerts.mjs` this
 * decides nothing — the rules are in `app/lib/deploys/`, where there are tests.
 *
 * ── A DEPLOY MUST NEVER FAIL BECAUSE OF THIS ───────────────────────────────
 * The opposite of `check-alerts.mjs`, which is deliberately loud. By the time
 * this runs the site is already live, and a red deploy over a missing
 * notification would be a false alarm about the thing that worked. So every
 * failure here — no secret, wrong secret, site unreachable — prints a
 * `::warning::` and exits 0. (The workflow step is also `continue-on-error`,
 * for the failures a script cannot catch in itself.)
 *
 * ── RETRIES, AND WHAT THEY ARE FOR ─────────────────────────────────────────
 * The request goes to the canonical site, not the deployment URL (which is
 * behind Vercel's deployment protection). `vercel deploy --prod` returns once
 * the production alias points at the new build, but a request can still land on
 * the previous one for a moment — and on the first deploy that ships this
 * route, the previous build does not have it. So a network error, a 404 or a
 * 5xx is retried a few times. A 400, 401 or 503 is NOT: those are about the
 * request or the configuration, and asking again changes nothing.
 *
 * A request that reaches the old build is not a correctness problem: both
 * builds share one database, so the notification is filed either way, and the
 * sha dedupe key means a retry cannot file it twice.
 *
 * Environment:
 *   ALERTS_SECRET           required to do anything; absent → warn and exit 0.
 *   GITHUB_SHA              the deployed commit (set by Actions).
 *   DEPLOY_COMMIT_MESSAGE   the commit message. Passed by the workflow through
 *                           `env:` and never interpolated into a shell command,
 *                           because it is text somebody typed.
 *   HALLPASS_SITE_URL       optional; defaults to the production origin.
 *
 * Usage:
 *   node scripts/notify-deploy.mjs             post the notification
 *   node scripts/notify-deploy.mjs --dry-run   print what would be sent
 */

import { appendFileSync } from "node:fs";

/** Matches `app/lib/site.ts` and `check-alerts.mjs`. */
const DEFAULT_SITE_URL = "https://hallpass-rouge.vercel.app";

const siteUrl = (process.env.HALLPASS_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const secret = (process.env.ALERTS_SECRET || "").trim();
const sha = (process.env.GITHUB_SHA || "").trim();
const message = process.env.DEPLOY_COMMIT_MESSAGE ?? "";
const dryRun = process.argv.includes("--dry-run");

const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;
const PATH = "/api/v1/admin/deploy/notify";

const annotate = (level, text) => console.log(`::${level}::${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Best-effort run summary on the Actions run page. */
function summarise(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  } catch {
    /* summary is best-effort */
  }
}

/** Say what went wrong, without failing the deploy. */
function giveUp(text) {
  annotate("warning", `Deploy notification not sent: ${text}`);
  summarise(["### Deploy notification", "", `Not sent — ${text}`]);
  process.exit(0);
}

if (!secret) giveUp("ALERTS_SECRET is not set.");
if (!sha) giveUp("GITHUB_SHA is not set.");

// Bounded here as well as on the server, so a runaway message cannot make this
// request large. The server applies its own limit and cleaning.
const body = JSON.stringify({ sha, message: message.slice(0, 4096) });

if (dryRun) {
  console.log(`--dry-run: would POST to ${siteUrl}${PATH}`);
  console.log(body);
  process.exit(0);
}

let lastProblem = "no attempt was made";
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  let retryable = true;
  try {
    const res = await fetch(`${siteUrl}${PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      console.log(`Deploy notification accepted for ${sha.slice(0, 7)} (attempt ${attempt}).`);
      console.log(
        "Admins are told once per commit: a re-run of the same commit is deduped on the sha.",
      );
      summarise([
        "### Deploy notification",
        "",
        `Sent for \`${sha.slice(0, 7)}\`. A re-run of the same commit is not announced twice.`,
        "",
        "If two merges land close together, `cancel-in-progress` cancels the first deploy, so only the newer one is announced, with only its own title.",
      ]);
      process.exit(0);
    }

    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* the status is enough */
    }
    lastProblem = `${PATH} answered ${res.status}${detail ? `: ${detail}` : ""}`;
    retryable = res.status === 404 || res.status >= 500;
  } catch (error) {
    lastProblem = `${PATH} could not be reached: ${error.message}`;
  }

  if (!retryable) break;
  if (attempt < ATTEMPTS) {
    console.log(`Attempt ${attempt} failed (${lastProblem}); retrying in ${RETRY_DELAY_MS / 1000}s.`);
    await sleep(RETRY_DELAY_MS);
  }
}

giveUp(lastProblem);
