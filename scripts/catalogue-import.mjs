#!/usr/bin/env node
/**
 * Imports the curated collectibles catalogue from the artwork studio
 * (`hallpass-card/manifests/curated.json`) into this repo.
 *
 *   node scripts/catalogue-import.mjs            dry run: validate and print the plan; writes nothing
 *   node scripts/catalogue-import.mjs --apply    copy the art, write curated.generated.ts and the report
 *
 * Source: $HALLPASS_CARD_DIR, else ../hallpass-card (a sibling of the repo, or of the
 * repo's worktree root). The studio is read-only: nothing is written there.
 *
 * Deterministic and idempotent: ids come from the explicit rules below (never from display
 * names), asset filenames carry a content hash, and a second --apply changes nothing.
 * The catalogue itself is code (docs/collectibles-design.md §1.2), so there are no
 * card-definition rows to migrate; players' rows reference the ids written here.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const STUDIO = [process.env.HALLPASS_CARD_DIR, join(ROOT, "../hallpass-card"), join(ROOT, "../../../../hallpass-card")]
  .filter(Boolean)
  .find((p) => existsSync(join(p, "manifests/curated.json")));
if (!STUDIO) {
  console.error("Cannot find hallpass-card/manifests/curated.json (set HALLPASS_CARD_DIR).");
  process.exit(1);
}

const OUT_TS = join(ROOT, "app/lib/collectibles/catalogue/curated.generated.ts");
const OUT_MAP = join(ROOT, "app/lib/collectibles/catalogue/curated-map.json");
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
const RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));
const FINISH = { common: "standard", uncommon: "standard", rare: "foil", epic: "holo", legendary: "animated" };

/** Manifest collection → catalogue collection id. The three old ids stay free for the retired demo sets. */
const COLLECTION = { legends: "legends", brainrot: "brainrot", turkish: "turkish", gaming: "gaming", ff26: "ff26" };

/**
 * The five prize-only commemoratives already exist in the catalogue and in the packs and
 * championship config under these ids, so the manifest ids map onto them explicitly.
 */
const PRIZE_IDS = {
  "ff26-survivor": "ff26-survivor",
  "ff26-lastbell": "ff26-champion-last-bell",
  "ff26-shadow": "ff26-champion-shadow-core",
  "ff26-dawn": "ff26-champion-survive-till-dawn",
  "ff26-overall": "ff26-overall-champion",
};
/** Existing catalogue size of ff26 before this import: new droppable cards number on from here. */
const FF26_EXISTING = 20;

const manifest = JSON.parse(readFileSync(join(STUDIO, "manifests/curated.json"), "utf8"));
const problems = [];
const notes = [];
const bad = (m) => problems.push(m);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sha8 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8);
const read = (rel) => readFileSync(join(STUDIO, rel));

// ── Validate the manifest and mint ids ────────────────────────────────────────
const seenManifest = new Set();
const seenIds = new Set();
const cards = manifest.cards.map((m, index) => {
  if (seenManifest.has(m.id)) bad(`duplicate manifest id ${m.id}`);
  seenManifest.add(m.id);
  const collection = COLLECTION[m.collection];
  if (!collection) bad(`${m.id}: unknown collection ${m.collection}`);
  if (!(m.rarity in RANK)) bad(`${m.id}: unknown rarity ${m.rarity}`);
  const prize = m.status === "prize_only";
  if (prize !== (m.id in PRIZE_IDS)) bad(`${m.id}: prize_only status and the PRIZE_IDS table disagree`);
  const id = PRIZE_IDS[m.id] ?? `${collection}-${slug(m.id)}`;
  if (seenIds.has(id)) bad(`${m.id}: catalogue id ${id} is already taken`);
  seenIds.add(id);
  for (const k of ["art", "thumb"]) if (!existsSync(join(STUDIO, m[k]))) bad(`${m.id}: missing ${k} file ${m[k]}`);
  return { m, id, collection, prize, index };
});

// Numbers: ascending rarity (commons first, like the other sets), manifest order within a rarity.
// ff26 continues after the 20 existing rows, and the five prize cards keep their existing numbers.
const PRIZE_NUMBER = { "ff26-survivor": 16, "ff26-champion-last-bell": 17, "ff26-champion-shadow-core": 18, "ff26-champion-survive-till-dawn": 19, "ff26-overall-champion": 20 };
const byCollection = new Map();
for (const c of cards) (byCollection.get(c.collection) ?? byCollection.set(c.collection, []).get(c.collection)).push(c);
for (const [col, list] of byCollection) {
  const droppable = list.filter((c) => !c.prize).sort((a, b) => RANK[a.m.rarity] - RANK[b.m.rarity] || a.index - b.index);
  droppable.forEach((c, i) => (c.number = (col === "ff26" ? FF26_EXISTING : 0) + i + 1));
  for (const c of list.filter((c) => c.prize)) c.number = PRIZE_NUMBER[c.id];
}

// ── Assets ────────────────────────────────────────────────────────────────────
const writes = []; // [absolute destination, Buffer]
const assets = new Map();
for (const c of cards) {
  const artBuf = read(c.m.art);
  const thumbBuf = read(c.m.thumb);
  const animated = c.m.animated;
  const dir = `public/collectibles/${c.collection}`;
  // An already-optimised (animated) WebP is copied as it is; PNGs are encoded below.
  assets.set(c.id, { c, dir, artBuf, thumbBuf, animated, copyArt: animated || c.m.art.endsWith(".webp") });
}

async function build() {
  const rows = [];
  for (const [id, a] of assets) {
    const { c, dir } = a;
    const art = a.copyArt ? a.artBuf : await sharp(a.artBuf).webp({ quality: 86, effort: 5 }).toBuffer();
    const artSrc = `/collectibles/${c.collection}/${id}.${sha8(art)}.webp`;
    const thumbSrc = `/collectibles/${c.collection}/${id}-thumb.${sha8(a.thumbBuf)}.webp`;
    writes.push([join(ROOT, "public", artSrc), art], [join(ROOT, "public", thumbSrc), a.thumbBuf]);
    const meta = await sharp(art).metadata();
    if (meta.width * 7 !== (meta.pageHeight ?? meta.height) * 5) bad(`${c.m.id}: art ${meta.width}×${meta.height} is not 5:7`);
    const m = c.m;
    const kind = c.prize ? (m.rarity === "rare" ? "sticker" : "card") : m.rarity === "common" || m.rarity === "uncommon" ? "sticker" : "card";
    rows.push({
      id,
      collection: c.collection,
      number: c.number,
      name: m.name,
      caption: "",
      rarity: m.rarity,
      kind,
      finish: FINISH[m.rarity],
      frame: c.prize ? "champion" : c.collection === "ff26" ? "event" : "standard",
      pool: c.prize ? "commemorative" : "standard",
      art: { src: artSrc, thumb: thumbSrc, status: "final", layout: "full", alt: `${m.name}. ${m.rarity} card art.` },
    });
  }
  return rows;
}

// ── Report ────────────────────────────────────────────────────────────────────
function plan(rows) {
  const lines = [];
  const per = {};
  for (const r of rows) {
    const k = r.collection;
    per[k] ??= { total: 0, droppable: Object.fromEntries(RARITIES.map((x) => [x, 0])), prize: 0 };
    per[k].total++;
    if (r.pool === "commemorative") per[k].prize++;
    else per[k].droppable[r.rarity]++;
  }
  lines.push(`Manifest: ${manifest.cards.length} cards, generated ${manifest.generated}. Studio: ${STUDIO}`);
  for (const [k, v] of Object.entries(per)) {
    lines.push(`  ${k.padEnd(9)} ${String(v.total).padStart(2)} cards, ${v.prize} prize-only, droppable ${RARITIES.map((r) => `${r[0]}${v.droppable[r]}`).join(" ")}`);
    for (const r of RARITIES) if (!v.droppable[r]) notes.push(`${k} has no droppable ${r} card (pack odds redistribute this tier in v-next)`);
  }
  if (manifest.cards.some((m) => m.status === "draft")) notes.push(`draft in manifest: ${manifest.cards.filter((m) => m.status === "draft").map((m) => m.id).join(", ")} (imported, uncounted by the studio)`);
  return lines;
}

const rows = await build();
const summary = plan(rows);
console.log(summary.join("\n"));
console.log(`\n${writes.length} asset files, ${rows.length} catalogue rows.`);
for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
if (!APPLY) {
  console.log("\nDry run: nothing written. Re-run with --apply.");
  process.exit(0);
}

for (const [dest, buf] of writes) {
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest) || !readFileSync(dest).equals(buf)) writeFileSync(dest, buf);
}
const header = `/**\n * GENERATED by scripts/catalogue-import.mjs from hallpass-card/manifests/curated.json. Do not edit by hand:\n * re-run the script. Ids are explicit (never derived from display names); art filenames carry a content hash.\n */\n\nimport type { Collectible } from "./types";\n\nexport const CURATED: Collectible[] = `;
writeFileSync(OUT_TS, header + JSON.stringify(rows, null, 2) + ";\n");
const map = Object.fromEntries(
  cards.map((c) => [c.m.id, { id: c.id, collection: c.collection, number: c.number, rarity: c.m.rarity, status: c.m.status, wasRarity: c.m.was_rarity ?? null, wasCatalogueId: c.m.was_catalogue_id ?? null, rights: c.m.rights, counted: c.m.counted }]),
);
writeFileSync(OUT_MAP, JSON.stringify(map, null, 2) + "\n");
console.log(`\nWrote ${OUT_TS.replace(ROOT + "/", "")}, ${OUT_MAP.replace(ROOT + "/", "")} and ${writes.length} assets.`);
