#!/usr/bin/env node
// Re-downloads the vendored CDN libraries in this folder and rewrites
// manifest.json. Run it only to add or upgrade a library; the build never
// touches the network. See README.md for why these exist.
//
//   node hpg/vendor/fetch.mjs
//
// Every library is pinned to an exact version. Module files are crawled for
// their relative imports and stylesheets for their url() files, so a library is
// complete without a hand-written file list.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;

/**
 * `prefix` maps every URL under it to the same path under `dir`.
 * `aliases` maps an exact URL a game uses (which may be unversioned) to a file
 * inside one of the prefixes, so the pinned version is explicit here.
 */
const LIBRARIES = [
  {
    name: "Tailwind CSS Play CDN 3.4.17 (MIT)",
    prefix: "https://cdn.tailwindcss.com/3.4.17",
    dir: "tailwindcss/3.4.17.js",
    entries: [""],
    aliases: { "https://cdn.tailwindcss.com": "" },
  },
  {
    name: "three.js r128 (MIT)",
    prefix: "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/",
    dir: "cdnjs/three.js/r128/",
    entries: ["three.min.js"],
  },
  {
    name: "three.js 0.160.0 (MIT)",
    prefix: "https://cdn.jsdelivr.net/npm/three@0.160.0/",
    dir: "jsdelivr/three@0.160.0/",
    entries: [
      "build/three.module.js",
      ...["EffectComposer", "RenderPass", "UnrealBloomPass", "OutputPass", "ShaderPass"].map((n) => `examples/jsm/postprocessing/${n}.js`),
    ],
  },
  {
    name: "three.js 0.169.0 (MIT)",
    prefix: "https://cdn.jsdelivr.net/npm/three@0.169.0/",
    dir: "jsdelivr/three@0.169.0/",
    entries: ["build/three.module.js"],
  },
  {
    name: "Font Awesome Free 6.0.0 (CSS MIT, fonts SIL OFL 1.1)",
    prefix: "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/",
    dir: "cdnjs/font-awesome/6.0.0/",
    entries: ["css/all.min.css"],
  },
];

function relativeRefs(file, text) {
  const refs = [];
  if (file.endsWith(".js")) {
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) refs.push(m[1]);
  } else if (file.endsWith(".css")) {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) if (!/^(data:|https?:|\/\/|#)/.test(m[1])) refs.push(m[1]);
  }
  return refs.map((r) => r.split(/[?#]/)[0]);
}

const manifest = { libraries: [], prefixes: {}, aliases: {}, files: {} };
for (const lib of LIBRARIES) {
  manifest.libraries.push(lib.name);
  manifest.prefixes[lib.prefix] = lib.dir;
  for (const [url, rest] of Object.entries(lib.aliases ?? {})) manifest.aliases[url] = lib.prefix + rest;
  const queue = [...lib.entries];
  const seen = new Set();
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const url = lib.prefix + rel;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const local = lib.dir + rel;
    mkdirSync(path.dirname(path.join(here, local)), { recursive: true });
    writeFileSync(path.join(here, local), bytes);
    manifest.files[local] = createHash("sha256").update(bytes).digest("hex");
    console.log(`${local}  ${(bytes.length / 1024).toFixed(1)} KB`);
    const base = new URL(url);
    for (const ref of relativeRefs(local, bytes.toString("utf8"))) {
      const abs = new URL(ref, base).href;
      if (!abs.startsWith(lib.prefix)) throw new Error(`${local} refers outside its library: ${ref}`);
      queue.push(abs.slice(lib.prefix.length));
    }
  }
}
writeFileSync(path.join(here, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json: ${Object.keys(manifest.files).length} files`);
