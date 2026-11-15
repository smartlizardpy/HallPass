import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readPackage } from "../archive/package";
import type { GameAdapter } from "./adapter";
import { packageGame, type CatalogGame } from "./packager";

// A repo with a tiny hpg/vendor/ of fake libraries on a test host.
const root = mkdtempSync(path.join(tmpdir(), "hpg-vendor-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const LIB = "https://cdn.vendor.test/lib@1.0.0/";
const vendorFiles: Record<string, string> = {
  "lib@1.0.0/play.js": "window.PLAY_MARK = 'vendored-play';",
  "lib@1.0.0/lib.module.js": "export const libMark = 'vendored-module';",
  "lib@1.0.0/addons/addon.js": "import { libMark } from 'lib'; import { util } from './util.js'; export const addon = libMark + util;",
  "lib@1.0.0/addons/util.js": "export const util = '+util';",
  "lib@1.0.0/css/icons.css": ".i{font-family:F}@font-face{font-family:F;src:url(../fonts/f.woff2)}",
  "lib@1.0.0/fonts/f.woff2": "WOFF2",
};

function writeVendor(tamper = false) {
  const dir = path.join(root, "hpg", "vendor");
  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(vendorFiles)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
    files[rel] = createHash("sha256").update(content).digest("hex");
  }
  if (tamper) writeFileSync(path.join(dir, "lib@1.0.0/play.js"), "window.PLAY_MARK = 'evil';");
  const manifest = { libraries: ["test lib"], prefixes: { [LIB]: "lib@1.0.0/" }, aliases: { "https://cdn.vendor.test": `${LIB}play.js` }, files };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

const catalogEntry = (slug: string): CatalogGame => ({ slug, title: slug, tagline: "T", description: "D.", category: "Arcade", tags: ["Arcade"], gradient: ["#000000", "#ffffff"], accent: "#ff00ff" });
const adapter = (id: string): GameAdapter => ({ id, version: "1.0.0", status: "experimental", inputs: ["keyboard"] });

async function pack(id: string, html: string) {
  const dir = path.join(root, "public", "games", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), html);
  return packageGame(root, adapter(id), [catalogEntry(id)]);
}
const issues = (r: Awaited<ReturnType<typeof pack>>, level: string) => r.issues.filter((i) => i.level === level).map((i) => i.message).join("\n");
async function html(r: Awaited<ReturnType<typeof pack>>) {
  if (!r.ok) throw new Error(issues(r, "error"));
  return new TextDecoder().decode((await readPackage(r.bytes)).files.get("game.html"));
}

describe("vendored CDN libraries", () => {
  it("inlines an unversioned classic script through its pinned alias, with a warning", async () => {
    writeVendor();
    const r = await pack("v-script", '<!doctype html><script src="https://cdn.vendor.test"></script>');
    const out = await html(r);
    expect(out).toContain("vendored-play");
    expect(out).not.toContain("cdn.vendor.test\"");
    expect(issues(r, "warning")).toMatch(/is unversioned; packaged the pinned copy of https:\/\/cdn\.vendor\.test\/lib@1\.0\.0\/play\.js/);
  });

  it("bundles bare imports an import map sends to a vendored CDN, prefixes included", async () => {
    writeVendor();
    const r = await pack(
      "v-map",
      `<!doctype html><script type="importmap">{"imports":{"lib":"${LIB}lib.module.js","lib/addons/":"${LIB}addons/"}}</script>` +
        `<script type="module">import { libMark } from "lib"; import { addon } from "lib/addons/addon.js"; document.title = libMark + addon;</script>`,
    );
    const out = await html(r);
    expect(out).toContain("vendored-module");
    expect(out).toContain("+util");
    expect(out).not.toContain("importmap");
  });

  it("bundles a vendored stylesheet and its font files", async () => {
    writeVendor();
    const out = await html(await pack("v-css", `<!doctype html><link rel="stylesheet" href="${LIB}css/icons.css">`));
    expect(out).toContain("font-family:F");
    expect(out).toMatch(/url\(data:font\/woff2[;,]/);
  });

  it("refuses an import map entry or URL that is not vendored", async () => {
    writeVendor();
    const map = await pack("v-miss", `<!doctype html><script type="importmap">{"imports":{"x":"https://cdn.other.test/x.js"}}</script><script type="module">import "x"</script>`);
    expect(issues(map, "error")).toMatch(/import map maps a module to cdn\.other\.test/);
    const file = await pack("v-miss2", `<!doctype html><script src="${LIB}missing.js"></script>`);
    expect(issues(file, "error")).toMatch(/remote script https:\/\/cdn\.vendor\.test\/lib@1\.0\.0\/missing\.js cannot be packaged/);
  });

  it("refuses a vendored file that does not match its manifest hash", async () => {
    writeVendor(true);
    const r = await pack("v-tamper", '<!doctype html><script src="https://cdn.vendor.test"></script>');
    expect(r.ok).toBe(false);
    expect(issues(r, "error")).toMatch(/does not match its sha256/);
  });
});
