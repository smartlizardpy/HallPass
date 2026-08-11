#!/usr/bin/env node
/**
 * HallPass — provision the leaderboards for the backfilled games.
 *
 * WHY THIS EXISTS. A game that carries the SDK is only half-wired: until a row
 * exists in `boards`, `POST /api/v1/leaderboard/<slug>` answers 409 "Board not
 * initialized" and every score is dropped. Eleven games were wired in one pass,
 * and eleven trips through the dashboard's new-board form is eleven chances to
 * fat-finger a slug — a board whose id does not match the game's `data-game`
 * fails silently in
 * exactly the way `scripts/migrate.mjs`'s docblock warns about, because the SDK
 * never throws and the game plays on regardless.
 *
 * It also records WHICH boards were created and with what sort/label, which a
 * form does not. `sort` and `scoreLabel` are editorial decisions taken from
 * reading each game (does a higher number win, and what does the number count),
 * so they are written out here rather than guessed at a keyboard.
 *
 * IDEMPOTENT. The statement is the same `INSERT … ON CONFLICT (id) DO UPDATE`
 * that `store.createBoard` runs, so re-running is safe and repairs a board whose
 * title or label was edited by hand. It reports created vs updated per row via
 * `xmax = 0`, the same trick the store uses.
 *
 * SAFE BY CONSTRUCTION: it refuses to provision a board for a game whose HTML
 * does not actually carry `data-game="<slug>"`. A board with no game posting to
 * it is just clutter, and the mismatch it would hide is the whole failure mode
 * above.
 *
 * The two boards that already existed (`duskfall`, `neon-well`) are deliberately
 * NOT listed — this script provisions the backfill, and an upsert would overwrite
 * titles somebody chose by hand.
 *
 * Reads `DATABASE_URL` from the environment, falling back to `.env.local`, and
 * always prints the host first — the same convention as `scripts/migrate.mjs`,
 * for the same reason: "which Neon branch am I pointed at" is the question you
 * most want answered before a write.
 *
 * Usage:
 *   node scripts/provision-boards.mjs --status   list what exists vs what is missing
 *   node scripts/provision-boards.mjs --dry-run  print the statements, write nothing
 *   node scripts/provision-boards.mjs            create/repair every board below
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One entry per game backfilled in this pass.
 *
 * `sort` is `desc` for all of them: every one accumulates points, kills or
 * distance, so higher always wins. An `asc` board would be a time/golf game and
 * none of these are. `label` names what the number actually counts — two of them
 * post a kill count rather than a score, and calling that "Score" on the board
 * would misdescribe it.
 */
const BOARDS = [
  { slug: "chroma-orbit", title: "Chroma Orbit - High Scores", sort: "desc", label: "Score" },
  { slug: "crimson-survivor", title: "Crimson Survivor - High Scores", sort: "desc", label: "Score" },
  { slug: "neon-tether", title: "Neon Tether - High Scores", sort: "desc", label: "Score" },
  { slug: "neon-fracture", title: "Neon Fracture - High Scores", sort: "desc", label: "Score" },
  {
    slug: "jjk-domain-survival-top-down",
    title: "JJK Domain Survival (Top Down) - High Scores",
    sort: "desc",
    label: "Kills",
  },
  { slug: "system-error", title: "System.ERROR - High Scores", sort: "desc", label: "Kills" },
  { slug: "vanta-void", title: "Vanta Void - High Scores", sort: "desc", label: "Score" },
  { slug: "paddle-crawler", title: "Paddle Crawler - High Scores", sort: "desc", label: "Score" },
  { slug: "pixel-bullet-quest", title: "Pixel Bullet Quest - High Scores", sort: "desc", label: "Score" },
  {
    slug: "rhythm-hell-harmonic-flash",
    title: "Rhythm Hell: Harmonic Flash - High Scores",
    sort: "desc",
    label: "Score",
  },
  {
    slug: "depths-of-aethelgard",
    title: "Depths of Aethelgard - High Scores",
    sort: "desc",
    label: "Score",
  },
];

const args = process.argv.slice(2);
const wantStatus = args.includes("--status");
const dryRun = args.includes("--dry-run");

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.join(rootDir, ".env.local"));
  } catch {
    // .env.local may be absent (CI) — the check below reports it properly.
  }
}
if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set and .env.local did not provide it");
  process.exit(1);
}

console.log(`[boards] target: ${new URL(process.env.DATABASE_URL).host}`);

/**
 * Does this game's HTML actually carry the SDK tag for this slug? Guards against
 * provisioning a board nothing posts to — see the docblock.
 */
function isWired(slug) {
  const file = path.join(rootDir, "public", "games", slug, "index.html");
  if (!existsSync(file)) return false;
  return readFileSync(file, "utf8").includes(`data-game="${slug}"`);
}

const unwired = BOARDS.filter((b) => !isWired(b.slug));
if (unwired.length > 0) {
  console.error(
    `error: these games do not carry data-game in their HTML: ${unwired
      .map((b) => b.slug)
      .join(", ")}`,
  );
  console.error("       wire the game first — a board with nothing posting to it is clutter.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const existing = new Set(
  (await sql`SELECT id FROM boards WHERE id = ANY(${BOARDS.map((b) => b.slug)})`).map(
    (r) => r.id,
  ),
);

if (wantStatus) {
  for (const b of BOARDS) {
    console.log(`  ${existing.has(b.slug) ? "✓" : "·"} ${b.slug}${existing.has(b.slug) ? "" : "  MISSING"}`);
  }
  console.log(`[boards] present: ${existing.size}, missing: ${BOARDS.length - existing.size}`);
  process.exit(0);
}

let created = 0;
let updated = 0;
for (const b of BOARDS) {
  if (dryRun) {
    console.log(`  would upsert ${b.slug} → "${b.title}" (${b.sort}, ${b.label})`);
    continue;
  }
  // The same statement store.createBoard runs, including the `xmax = 0` trick
  // that distinguishes a fresh insert from an idempotent update.
  const rows = await sql`
    INSERT INTO boards (id, game_slug, title, sort, score_label, max_score)
    VALUES (${b.slug}, ${b.slug}, ${b.title}, ${b.sort}, ${b.label}, ${null})
    ON CONFLICT (id) DO UPDATE SET
      game_slug = EXCLUDED.game_slug,
      title = EXCLUDED.title,
      sort = EXCLUDED.sort,
      score_label = EXCLUDED.score_label,
      max_score = EXCLUDED.max_score,
      updated_at = now()
    RETURNING (xmax = 0) AS created
  `;
  const wasCreated = rows[0]?.created === true;
  if (wasCreated) created++;
  else updated++;
  console.log(`  ${wasCreated ? "created" : "updated"} ${b.slug}`);
}

if (dryRun) {
  console.log(`[boards] dry run — nothing written`);
} else {
  console.log(`[boards] created: ${created}, updated: ${updated}`);
}
