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
  // The SW's offline fallback document. It must be precached UNCONDITIONALLY —
  // it is what `networkFirst` serves when a navigation misses everything else,
  // so if it were ever absent from the manifest the fallback silently reverts to
  // the synthesized bare-HTML response. `/offline` is also picked up from the
  // prerender manifest below; listing it here means a prerender-manifest hiccup
  // can never drop it.
  "/offline",
  // The offline answer for the player's OWN pages, and the one image on it.
  //
  // Both are precached for the same reason `/offline` is, only more sharply:
  // `sw.js` serves this document when a navigation into `/play/you` fails, and
  // that subtree is one the SW is FORBIDDEN to cache, so this is the only thing
  // it can ever put on screen there. The PNG is listed alongside it because a
  // cache-first image request cannot reach the network on the one occasion this
  // page is shown — an offline card with a broken image on it is worse than no
  // card. It is also why the page uses a plain `<img>`: `next/image` would route
  // through `/_next/image`, which is not precached and never could be.
  "/offline/you",
  "/offline-wifi.png",
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
      // NOTHING UNDER `/play/` IS EVER PRECACHED.
      //
      // These are the player's own pages. The ones that render their data are
      // dynamic, so they never reach the prerender manifest and cannot arrive
      // here — but `/play/account` and `/play/friends` became STATIC the moment
      // they were reduced to bare `redirect()`s into `/play/you`, and a static
      // route DOES land in the manifest. Precaching a redirect is worse than
      // useless: `sw.js` fetches every precache URL with
      // `credentials: "same-origin"` and follows redirects, so install would
      // fetch `/play/account`, follow the 307, and receive the signed-in
      // player's `/play/you` HTML — their email — as the response body.
      //
      // `isCacheable()` refuses it today because `res.redirected` is true, so
      // nothing is stored. That is a real guard but the WRONG one to depend on:
      // it exists to stop redirect-poisoning of iframe sources, and someone
      // relaxing it for that reason would silently turn a shared browser
      // profile's cache into an email leak. Excluding the prefix here means the
      // fetch never happens, which also saves every visitor a wasted install-
      // time request. See `isPrivatePath` in `public/sw.js` for the runtime half.
      route === "/play" ||
      route.startsWith("/play/") ||
      // NO CHALLENGE LINK IS EVER PRECACHED. `/c/<code>` is dynamic (it reads a
      // per-code row), so it cannot reach the prerender manifest and cannot
      // arrive here today — this is the same belt-and-braces the `/play/`
      // exclusion above is written under, and for the same reason: the day one
      // of these becomes static, precaching it would pin ONE person's challenge
      // card into a cache shared by everybody on the browser profile, and serve
      // it under a URL that belongs to somebody else's code.
      route.startsWith("/c/") ||
      // NO GENERATED SOCIAL CARD IS EVER PRECACHED. `/opengraph-image` and the
      // per-category/per-tag ones under it are statically optimised, so they DO
      // reach the prerender manifest — verified, not assumed: the home card
      // appeared here the first build after it was added. Each is a 1200x630
      // PNG that only a crawler ever fetches, and precaching them would spend a
      // visitor's install budget (and their data) on images no visitor sees.
      /\/(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$/.test(route) ||
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
