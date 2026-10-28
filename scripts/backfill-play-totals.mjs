#!/usr/bin/env node
/**
 * HallPass — seed the permanent per-game play totals from PostHog.
 *
 * `game_play_totals` (migration 052) counts plays from the moment
 * `POST /api/v1/plays` shipped. Everything before that only exists in PostHog, so
 * this copies it across ONCE per game into the `baseline` column, so Last Bell
 * and every other game keep the plays they already earned.
 *
 * ── THE CUTOFF IS WHAT MAKES IT SAFE ───────────────────────────────────────
 * `--until` is the moment the counter went live (the deploy time). Only
 * `game_started` events STRICTLY BEFORE it are counted, and it is stored beside
 * the baseline. Plays after it are counted by the beacon into `plays`, so nothing
 * is counted twice. Re-running overwrites
 * `baseline` (it never adds to it) and leaves `plays` alone, so it is idempotent.
 * Use the SAME `--until` every time: a later one would count the beacon's plays
 * in the gap twice, once in `baseline` and again in `plays`. Pick the deploy time
 * once and keep it.
 *
 * HOW FAR BACK IT GOES is however much history PostHog still holds. Plays PostHog
 * has already aged out cannot be recovered by anything.
 *
 * Environment:
 *   DATABASE_URL                 required. The production Neon connection string.
 *   POSTHOG_PERSONAL_API_KEY     required.
 *   POSTHOG_PROJECT_ID           required.
 *   POSTHOG_API_HOST             optional, default https://eu.posthog.com
 *
 * Usage:
 *   node scripts/backfill-play-totals.mjs --until 2026-10-28T12:00:00Z --dry-run
 *   node scripts/backfill-play-totals.mjs --until 2026-10-28T12:00:00Z
 */

import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const untilArg = args[args.indexOf("--until") + 1];
const until = args.includes("--until") ? new Date(untilArg ?? "") : null;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!until || Number.isNaN(until.getTime())) {
  fail("--until <ISO timestamp> is required: the moment POST /api/v1/plays went live.");
}
if (until.getTime() > Date.now()) fail("--until is in the future.");

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const host = (process.env.POSTHOG_API_HOST || "https://eu.posthog.com").replace(/\/+$/, "");
if (!databaseUrl) fail("DATABASE_URL is not set.");
if (!apiKey || !projectId) fail("POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are required.");

/** A game slug as the catalogue writes them. Anything else is a client-forged property. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

// `until` came from `new Date(...)`, so this is a fixed-format timestamp, never
// caller text.
const untilSql = until.toISOString().replace("T", " ").replace("Z", "");

const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    query: {
      kind: "HogQLQuery",
      query: `
        SELECT properties.game_slug AS slug, count() AS plays
        FROM events
        WHERE event = 'game_started'
          AND properties.game_slug IS NOT NULL
          AND timestamp < toDateTime('${untilSql}', 'UTC')
        GROUP BY slug
      `,
    },
  }),
  signal: AbortSignal.timeout(120_000),
});
if (!res.ok) fail(`PostHog answered ${res.status}: ${(await res.text()).slice(0, 300)}`);

const { results = [] } = await res.json();
const slugs = [];
const plays = [];
let skipped = 0;
for (const [slug, count] of results) {
  if (typeof slug === "string" && SLUG.test(slug) && Number(count) > 0) {
    slugs.push(slug);
    plays.push(Math.trunc(Number(count)));
  } else {
    skipped += 1;
  }
}

console.log(`${dryRun ? "[dry run] " : ""}baseline before ${until.toISOString()}:`);
for (const [i, slug] of slugs.entries()) console.log(`  ${slug.padEnd(40)} ${plays[i]}`);
console.log(`${slugs.length} games, ${plays.reduce((a, b) => a + b, 0)} plays, ${skipped} rows skipped.`);
if (slugs.length === 0) fail("PostHog returned no games; refusing to write an empty baseline.");
if (dryRun) process.exit(0);

const sql = neon(databaseUrl);
await sql.query(
  `INSERT INTO game_play_totals (slug, baseline, baseline_until)
   SELECT s, b, $3::timestamptz FROM unnest($1::text[], $2::bigint[]) AS t(s, b)
   ON CONFLICT (slug) DO UPDATE SET
     baseline       = EXCLUDED.baseline,
     baseline_until = EXCLUDED.baseline_until,
     updated_at     = now()`,
  [slugs, plays, until.toISOString()],
);
console.log("Done. The public counts pick it up within a day, or on the next deploy.");
