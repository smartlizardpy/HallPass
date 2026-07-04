#!/usr/bin/env node
// Generates public/sw-manifest.js from the latest Next build.
// Run as `postbuild`.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const nextDir = resolve(root, ".next");
const buildIdPath = resolve(nextDir, "BUILD_ID");
const buildManifestPath = resolve(nextDir, "build-manifest.json");
const appBuildManifestPath = resolve(nextDir, "app-build-manifest.json");
const prerenderManifestPath = resolve(nextDir, "prerender-manifest.json");
const gamesTsPath = resolve(root, "app/lib/games.ts");
const gamesDir = resolve(root, "public/games");
const outPath = resolve(root, "public/sw-manifest.js");

if (!existsSync(buildIdPath)) {
  console.error("[sw-manifest] .next/BUILD_ID missing — run `next build` first.");
  process.exit(1);
}

const buildId = (await readFile(buildIdPath, "utf8")).trim();

// Pull hashed JS/CSS chunks Next emits for every page.
let staticAssets = new Set();
if (existsSync(buildManifestPath)) {
  const manifest = JSON.parse(await readFile(buildManifestPath, "utf8"));
  const buckets = [
    manifest.rootMainFiles ?? [],
    manifest.lowPriorityFiles ?? [],
    manifest.rootMainFilesTree ? [] : [],
    ...Object.values(manifest.pages ?? {}),
  ];
  for (const list of buckets) {
    for (const file of list) {
      if (typeof file === "string" && file.length > 0) {
        staticAssets.add("/_next/" + file);
      }
    }
  }
}

// App Router chunks live in a separate manifest. Same shape: { pages: { "/route": [files] } }.
if (existsSync(appBuildManifestPath)) {
  const appManifest = JSON.parse(await readFile(appBuildManifestPath, "utf8"));
  for (const list of Object.values(appManifest.pages ?? {})) {
    for (const file of list) {
      if (typeof file === "string" && file.length > 0) {
        staticAssets.add("/_next/" + file);
      }
    }
  }
}

// Next 16 + Turbopack doesn't emit app-build-manifest.json, and per-route chunks
// aren't enumerated in build-manifest.json either. Sweep every chunk file —
// they're all filename-hashed and immutable, so blanket precaching is safe.
const chunksDir = resolve(nextDir, "static/chunks");
if (existsSync(chunksDir)) {
  const stack = [chunksDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(?:js|css)$/.test(entry.name)) continue;
      const rel = full.slice(nextDir.length + 1).split(/[/\\]/).join("/");
      staticAssets.add("/_next/" + rel);
    }
  }
}

// Sweep static/css too (App Router CSS modules sometimes land here).
const cssDir = resolve(nextDir, "static/css");
if (existsSync(cssDir)) {
  for (const entry of readdirSync(cssDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".css")) {
      staticAssets.add(`/_next/static/css/${entry.name}`);
    }
  }
}

// Next/font self-hosted woff2 files.
const mediaDir = resolve(nextDir, "static/media");
if (existsSync(mediaDir)) {
  for (const entry of readdirSync(mediaDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(woff2?|ttf|otf)$/.test(entry.name)) {
      staticAssets.add(`/_next/static/media/${entry.name}`);
    }
  }
}

// Read game slugs from public/games/* (1:1 with the games[] list).
const slugs = readdirSync(gamesDir).filter((name) => {
  if (name.startsWith(".") || name.startsWith("_")) return false;
  const full = resolve(gamesDir, name);
  return statSync(full).isDirectory();
});

const pageRoutes = new Set([
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
]);

// Pull every prerendered public route (catalog + categories + games).
let prerenderRoutes = [];
if (existsSync(prerenderManifestPath)) {
  const prerender = JSON.parse(await readFile(prerenderManifestPath, "utf8"));
  prerenderRoutes = Object.keys(prerender.routes ?? {});
  for (const route of prerenderRoutes) {
    if (
      route.startsWith("/_") ||
      route.startsWith("/admin") ||
      route.startsWith("/dashboard") ||
      route.startsWith("/api/") ||
      route === "/favicon.ico"
    ) {
      continue;
    }
    pageRoutes.add(route);
  }
}

// Fallback: if prerender manifest missing/empty, enumerate slugs from app/lib/games.ts
// so /game/{slug} and /game-html/{slug} routes still get precached for fully-dynamic apps.
let tsSlugs = [];
if (prerenderRoutes.length === 0 && existsSync(gamesTsPath)) {
  const gamesTs = await readFile(gamesTsPath, "utf8");
  const slugMatches = gamesTs.matchAll(/slug:\s*["']([^"']+)["']/g);
  for (const m of slugMatches) tsSlugs.push(m[1]);
  for (const slug of tsSlugs) {
    pageRoutes.add(`/game/${slug}`);
    // Trailing slash — must byte-match the PlayerOverlay iframe URL, since
    // caches.match() is exact.
    pageRoutes.add(`/game-html/${slug}/`);
  }
}

for (const slug of slugs) {
  // Trailing slash — must byte-match the PlayerOverlay iframe URL, since
  // caches.match() is exact.
  pageRoutes.add(`/game-html/${slug}/`);
  // Precache every file under public/games/{slug}/ — games may be multi-file
  // (index.html + JS + assets).
  const slugDir = resolve(gamesDir, slug);
  const stack = [slugDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const rel = full.slice(slugDir.length + 1).split(/[/\\]/).join("/");
      pageRoutes.add(`/games/${slug}/${rel}`);
    }
  }
}

const precacheUrls = [...new Set([...pageRoutes, ...staticAssets])].sort();

const out = `// AUTO-GENERATED by scripts/build-sw-manifest.mjs — do not edit.
self.__SW_BUILD_ID = ${JSON.stringify(buildId)};
self.__SW_PRECACHE = ${JSON.stringify(precacheUrls, null, 2)};
`;

await writeFile(outPath, out, "utf8");
console.log(
  `[sw-manifest] wrote ${outPath} — build ${buildId}, ${precacheUrls.length} URLs`,
);
