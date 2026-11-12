import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readPackage } from "../archive/package";
import { GOOGLE_FONT_HOSTS, type GameAdapter } from "./adapter";
import { packageGame, type CatalogGame } from "./packager";

const root = mkdtempSync(path.join(tmpdir(), "hpg-pack-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

function game(id: string, files: Record<string, string | Buffer>) {
  const dir = path.join(root, "public", "games", id);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
}

function catalogEntry(slug: string, over: Partial<CatalogGame> = {}): CatalogGame {
  return { slug, title: `Game ${slug}`, tagline: "Tag", description: "Desc.", category: "Arcade", tags: ["Arcade"], gradient: ["#000000", "#ffffff"], accent: "#ff00ff", ...over };
}

function adapter(id: string, over: Partial<GameAdapter> = {}): GameAdapter {
  return { id, version: "1.0.0", status: "experimental", inputs: ["keyboard"], ...over };
}

const SDK = '<script src="/sdk/v1/hallpass.js" data-game="x" defer></script>';

async function pack(id: string, files: Record<string, string | Buffer>, over: Partial<GameAdapter> = {}, cat: Partial<CatalogGame> = {}) {
  game(id, files);
  return packageGame(root, adapter(id, over), [catalogEntry(id, cat)]);
}

const errorsOf = (r: Awaited<ReturnType<typeof pack>>) => r.issues.filter((i) => i.level === "error").map((i) => i.message).join("\n");

describe("packageGame", () => {
  it("bundles a multi-file module game with a lazy chunk, a worker, CSS and images into one entry", async () => {
    const r = await pack(
      "modgame",
      {
        "index.html": `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./assets/style.css"><link rel="modulepreload" href="./assets/lib.js"><script type="module" src="./assets/main.js"></script></head><body><img src="assets/logo.png"><script type="x-shader/x-vertex">void main(){}</script>${SDK}</body></html>`,
        "assets/main.js": `import { add } from "./lib.js";\nconst w = new Worker(new URL("worker-abc.js", import.meta.url), { type: "module" });\nimport("./lazy.js").then((m) => m.go(add(1, 2), w));`,
        "assets/lib.js": "export const add = (a, b) => a + b;",
        "assets/lazy.js": "export function go(n){ document.title = 'lazy ' + n; }",
        "assets/worker-abc.js": `import { add } from "./lib.js"; self.onmessage = (e) => self.postMessage(add(e.data, 1));`,
        "assets/style.css": "body{background:url(bg.png)} .a{color:red}",
        "assets/bg.png": PNG,
        "assets/logo.png": PNG,
        "cover.png": PNG,
        "THIRD-PARTY-NOTICES.txt": "notices",
      },
      { workers: /^assets\/worker-[a-z]+\.js$/ },
    );
    expect(errorsOf(r)).toBe("");
    if (!r.ok) throw new Error("build failed");
    const pkg = await readPackage(r.bytes);
    const html = new TextDecoder().decode(pkg.files.get("game.html"));
    expect(html).not.toMatch(/src="\.?\/?assets\//);
    expect(html).not.toContain("modulepreload");
    expect(html).not.toContain("/sdk/v1/hallpass.js");
    expect(html).toContain('"hpg:/assets/main.js"');
    expect(html).toContain("lazy ");
    expect(html).toContain("data:image/png;base64");
    expect(html).toContain("void main(){}"); // shader kept verbatim
    expect(r.manifest.files["assets/worker-abc.js"].role).toBe("worker");
    const worker = new TextDecoder().decode(pkg.files.get("assets/worker-abc.js"));
    expect(worker).not.toMatch(/\bimport\b/); // self-contained classic script
    expect(r.manifest.files["THIRD-PARTY-NOTICES.txt"].role).toBe("asset");
    expect(r.manifest.thumbnail).toBe("cover.webp");
    expect(r.manifest.features).toEqual({ scores: true, saves: false, scoreOrder: "desc" });
    expect(r.manifest.compatibility?.workers).toBe(true);
    expect(r.fileName).toMatch(/^modgame-1\.0\.0-[0-9a-f]{8}\.hpg$/);
    expect(r.manifest.version).toMatch(/^1\.0\.0\+[0-9a-f]{8}$/);
  });

  it("is deterministic", async () => {
    const files = { "index.html": "<!doctype html><script>let x=1</script>" };
    const a = await pack("det", files);
    const b = await pack("det", files);
    expect(a.ok && b.ok && Buffer.compare(a.bytes, b.bytes)).toBe(0);
  });

  it("keeps classic scripts' top-level names (they are globals)", async () => {
    const r = await pack("classic", {
      "index.html": "<!doctype html><script>function startGame(){ return 1 } var highScore = 0;</script><script>startGame()</script>",
    });
    if (!r.ok) throw new Error(errorsOf(r));
    const html = new TextDecoder().decode((await readPackage(r.bytes)).files.get("game.html"));
    expect(html).toContain("startGame");
    expect(html).toContain("highScore");
  });

  it("refuses remote scripts with a reason", async () => {
    const r = await pack("cdn", { "index.html": '<!doctype html><script src="https://cdn.tailwindcss.com"></script>' });
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/remote script https:\/\/cdn\.tailwindcss\.com cannot be packaged/);
  });

  it("refuses remote imports in module code", async () => {
    const r = await pack("remoteimport", {
      "index.html": '<!doctype html><script type="module">import * as THREE from "https://cdn.jsdelivr.net/npm/three/+esm"; console.log(THREE)</script>',
    });
    expect(errorsOf(r)).toMatch(/remote dependency https:\/\/cdn\.jsdelivr\.net/);
  });

  it("drops web fonts only when the adapter allows it, and says so", async () => {
    const files = { "index.html": '<!doctype html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><script>1</script>' };
    const strict = await pack("fonts1", files);
    expect(errorsOf(strict)).toMatch(/remote stylesheet/);
    const lenient = await pack("fonts2", files, { dropRemoteHosts: GOOGLE_FONT_HOSTS });
    if (!lenient.ok) throw new Error(errorsOf(lenient));
    expect(lenient.issues.some((i) => i.level === "warning" && i.message.includes("fonts.googleapis.com"))).toBe(true);
    expect(lenient.manifest.compatibility?.notes?.join()).toMatch(/fonts/);
  });

  it("drops a remote CSS @import font the same way", async () => {
    const r = await pack("fonts3", { "index.html": "<!doctype html><style>@import url('https://fonts.googleapis.com/css2?family=Inter'); body{color:red}</style>" }, { dropRemoteHosts: GOOGLE_FONT_HOSTS });
    if (!r.ok) throw new Error(errorsOf(r));
    const html = new TextDecoder().decode((await readPackage(r.bytes)).files.get("game.html"));
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("reports missing assets", async () => {
    const r = await pack("missing", { "index.html": '<!doctype html><script src="engine.js"></script><img src="sprite.png">' });
    expect(errorsOf(r)).toMatch(/script "engine\.js": missing asset/);
    expect(errorsOf(r)).toMatch(/<img> "sprite\.png": missing asset/);
  });

  it("refuses references that escape the game folder", async () => {
    game("other", { "secret.js": "x" });
    const r = await pack("escape", { "index.html": '<!doctype html><script src="../other/secret.js"></script>' });
    expect(errorsOf(r)).toMatch(/outside the game folder/);
  });

  it("reports unsupported dynamic imports", async () => {
    const r = await pack("dyn", {
      "index.html": '<!doctype html><script type="module" src="m.js"></script>',
      "m.js": "const name = location.hash.slice(1); import(name).then(console.log);",
    });
    expect(errorsOf(r)).toMatch(/unsupported dynamic import/);
  });

  it("reports dynamic imports left in classic inline scripts too", async () => {
    const r = await pack("dyn2", { "index.html": "<!doctype html><script>import(window.mod)</script>" });
    expect(errorsOf(r)).toMatch(/unsupported dynamic import import\(window\.mod\)/);
  });

  it("refuses embedded documents", async () => {
    const r = await pack("embed", { "index.html": '<!doctype html><iframe src="other.html"></iframe>' });
    expect(errorsOf(r)).toMatch(/embeds another document/);
  });

  it("refuses staged, unknown and off-site games", async () => {
    game("staged", { "index.html": "<!doctype html>" });
    expect(errorsOf(await packageGame(root, adapter("staged"), [catalogEntry("staged", { staged: true })]))).toMatch(/staged/);
    expect(errorsOf(await packageGame(root, adapter("staged"), []))).toMatch(/not a published game/);
    expect(errorsOf(await packageGame(root, adapter("staged"), [catalogEntry("staged", { externalUrl: "https://x" })]))).toMatch(/off-site/);
    expect(errorsOf(await packageGame(root, adapter("nodir"), [catalogEntry("nodir")]))).toMatch(/does not exist/);
  });

  it("packages WebAssembly as runtime wasm", async () => {
    const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
    const r = await pack("wasmgame", { "index.html": "<!doctype html><script>fetch('hpg:/wasm/m.wasm')</script>", "wasm/m.wasm": wasm }, { assets: /^wasm\// });
    if (!r.ok) throw new Error(errorsOf(r));
    expect(r.manifest.runtime).toBe("wasm");
    expect(r.manifest.files["wasm/m.wasm"].role).toBe("wasm");
  });
});
