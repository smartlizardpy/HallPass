#!/usr/bin/env node
/**
 * Real-browser check of `HallPass.moment()` (docs/game-moments.md).
 *
 *   node scripts/verify-moments.mjs [--playwright <dir with playwright-core>] [--channel chrome] [--headed]
 *
 * NOT part of `npm test`, for the reason `verify-recorder.mjs` gives: Playwright
 * is not a project dependency and a real browser is slow. Run it by hand before
 * changing the shim, `moments.ts`, `dom-capture.ts` or the SDK's `moment`.
 *
 * Needs `public/sdk/v1/hallpass.js` built (`npm run build:sdk`).
 *
 * WHAT IT PROVES. The reason the shim wraps `requestAnimationFrame` is that a
 * WebGL canvas without `preserveDrawingBuffer` (every three.js game's default) is
 * cleared once its frame has been shown, so a read from an event handler comes
 * back transparent. This runs the REAL shim, the REAL SDK bundle and the REAL
 * `MomentLog` / `grabGameFrame` against:
 *
 *   1. a WebGL game, moment made from an EVENT HANDLER   -> picture is not blank
 *   2. a WebGL game, moment made INSIDE its frame, before it draws -> not blank
 *   3. a 2D canvas game                                  -> picture is not blank
 *   4. control: the same WebGL read taken straight from the handler, with no
 *      shim, is blank (informational - shows the shim is doing the work)
 *   5. with NO shim (a public player): moment() resolves, throws nothing and
 *      makes no request
 *   6. the screen-share path (`FrameGrabber.grabNow`), where Chrome will accept a
 *      tab share automatically; reported as SKIPPED where it will not
 *
 * Exit code 1 if any of 1-3 or 5 fail.
 */

import { build } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const dir = flag("playwright", "");
  if (!dir) throw new Error("playwright not found: pass --playwright <dir containing playwright-core>");
  ({ chromium } = createRequire(path.join(dir, "package.json"))("playwright-core"));
}

const sdkFile = path.join(root, "public/sdk/v1/hallpass.js");
if (!fs.existsSync(sdkFile) || !fs.readFileSync(sdkFile, "utf8").includes("moment")) {
  throw new Error("public/sdk/v1/hallpass.js is missing or has no moment(): run `npm run build:sdk`");
}

// ── bundles ─────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hp-moment-"));
const cap = path.join(root, "app/lib/capture");
const entry = path.join(tmp, "entry.ts");
fs.writeFileSync(
  entry,
  `export { MomentLog } from ${JSON.stringify(path.join(cap, "moments.ts"))};
export { grabGameFrame } from ${JSON.stringify(path.join(cap, "dom-capture.ts"))};
export { FrameGrabber, acquireTabCapture } from ${JSON.stringify(path.join(cap, "tab-capture.ts"))};`,
);
const alias = { "@": root };
await build({ entryPoints: [entry], bundle: true, format: "iife", globalName: "HPM", outfile: path.join(tmp, "browser.js"), logLevel: "error", alias });
await build({ entryPoints: [path.join(cap, "record-shim.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "shim.mjs"), logLevel: "error" });
const { injectShim } = await import(pathToFileURL(path.join(tmp, "shim.mjs")).href);
const browserJs = fs.readFileSync(path.join(tmp, "browser.js"), "utf8");

// ── pages ───────────────────────────────────────────────────────────────────
const SDK = `<script src="/sdk/v1/hallpass.js" data-game="verify"></script>`;
const GAMES = {
  // No preserveDrawingBuffer: the default, and what every three.js game gets.
  gl: `<!doctype html><html><head><meta charset=utf-8></head><body style="margin:0">${SDK}
<canvas id=c width=640 height=360 style="width:640px;height:360px"></canvas><script>
const gl = c.getContext('webgl');
window.inFrame = null;
function frame(){
  if (window.inFrame) { const n = window.inFrame; window.inFrame = null; HallPass.moment(n, { via: 'frame' }); }
  gl.clearColor(1, 0, 0.67, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
c.addEventListener('click', () => HallPass.moment('click-moment', { via: 'handler' }));
window.rawGrab = () => { const t = document.createElement('canvas'); t.width = 64; t.height = 64; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 64); return Array.from(x.getImageData(32, 32, 1, 1).data); };
</script></body></html>`,
  flat: `<!doctype html><html><head><meta charset=utf-8></head><body style="margin:0">${SDK}
<canvas id=c width=640 height=360 style="width:640px;height:360px"></canvas><script>
const x = c.getContext('2d');
function frame(){ x.fillStyle = '#00aa55'; x.fillRect(0, 0, 640, 360); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
c.addEventListener('click', () => HallPass.moment('flat-moment'));
</script></body></html>`,
};

const HARNESS = `<!doctype html><meta charset=utf-8><title>hp-moments</title><style>html,body{margin:0}iframe{width:640px;height:360px;border:0}</style>
<iframe id=g></iframe><script src="/browser.js"></script><script>
const frame = document.getElementById('g');
frame.src = new URLSearchParams(location.search).get('src');
window.__moments = []; const pending = []; const log = new HPM.MomentLog();
async function centre(blob) {
  const bm = await createImageBitmap(blob); const c = document.createElement('canvas');
  c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
  return Array.from(x.getImageData(bm.width >> 1, bm.height >> 1, 1, 1).data);
}
window.attach = () => {
  const shim = frame.contentWindow.__hpRec;
  if (!shim) return false;
  shim.onMoment = (raw) => {
    const adm = log.admit(raw, Date.now());
    if (!adm) return;
    // Started here, in the same task as the game's call - exactly as the hook does.
    const p = HPM.grabGameFrame(frame).then(async (r) => {
      window.__moments.push({ name: adm.moment.name, data: adm.moment.data, picture: r.ok, reason: r.ok ? null : r.reason, pixel: r.ok ? await centre(r.shot.blob) : null });
    });
    pending.push(p);
  };
  return true;
};
window.settled = () => Promise.all(pending).then(() => window.__moments);
// A synthetic "shared tab": a canvas stream the size of the viewport, blue
// everywhere except magenta where the game iframe sits. Needs no permission, so
// it exercises FrameGrabber's real crop (grab and grabNow) without getDisplayMedia.
window.streamGrab = async () => {
  const W = innerWidth, H = innerHeight, r = frame.getBoundingClientRect();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const paint = () => { x.fillStyle = '#0000ff'; x.fillRect(0, 0, W, H); x.fillStyle = '#ff00aa'; x.fillRect(r.x, r.y, r.width, r.height);
    // The timed grab rejects flat frames as loading screens, so give it some detail.
    x.fillStyle = '#ffffff'; for (let i = 0; i < 8; i++) x.fillRect(r.x + 10 + i * 40, r.y + 10 + (i % 3) * 30, 24, 24);
    x.fillStyle = '#101010'; for (let i = 0; i < 8; i++) x.fillRect(r.x + 20 + i * 60, r.y + r.height - 60 - (i % 2) * 40, 40, 40); };
  paint(); const t = setInterval(paint, 50);
  const timed = [];
  const g = new HPM.FrameGrabber(c.captureStream(20), { getTargetRect: () => ({ x: r.x, y: r.y, width: r.width, height: r.height }), onShot: (s) => timed.push(s), maxShots: 3, intervalMs: 500, maxEdge: 1280 });
  await g.start(); await new Promise((res) => setTimeout(res, 1500));
  const now = await g.grabNow(); g.stop(); clearInterval(t);
  return {
    timedCount: timed.length, timed: timed[0] ? { w: timed[0].width, h: timed[0].height, pixel: await centre(timed[0].blob) } : null,
    now: now ? { w: now.width, h: now.height, pixel: await centre(now.blob) } : null,
  };
};
window.shareGrab = () => new Promise((resolve) => {
  const b = document.createElement('button'); b.id = 'share'; b.textContent = 'share'; document.body.appendChild(b);
  b.onclick = () => shareNow().then(resolve, (e) => resolve({ skipped: String(e).slice(0, 60) }));
});
async function shareNow() {
  const cap = await HPM.acquireTabCapture();
  if (!cap.ok) return { skipped: cap.reason };
  const g = new HPM.FrameGrabber(cap.stream, { getTargetRect: () => { const r = frame.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, onShot: () => {}, maxShots: 0, intervalMs: 3600000, maxEdge: 1280 });
  await g.start(); await new Promise((r) => setTimeout(r, 1200));
  const shot = await g.grabNow(); g.stop(); cap.stream.getTracks().forEach((t) => t.stop());
  return shot ? { w: shot.width, h: shot.height, pixel: await centre(shot.blob) } : { skipped: 'no-frame' };
}
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(HARNESS);
  if (url.pathname === "/browser.js") return void res.writeHead(200, { "content-type": "text/javascript" }).end(browserJs);
  if (url.pathname === "/sdk/v1/hallpass.js") return void res.writeHead(200, { "content-type": "text/javascript" }).end(fs.readFileSync(sdkFile));
  const m = /^\/game-html\/([a-z]+)\/$/.exec(url.pathname);
  if (m && GAMES[m[1]]) {
    return void res
      .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      .end(url.searchParams.get("hp-rec") === "1" ? injectShim(GAMES[m[1]]) : GAMES[m[1]]);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ── browser ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  channel: flag("channel", undefined),
  headless: !args.includes("--headed"),
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--auto-accept-this-tab-capture", "--auto-select-tab-capture-source-by-title=hp-moments", "--use-fake-ui-for-media-stream"],
});

const results = [];
const record = (name, ok, detail, informational = false) => {
  results.push({ name, ok, informational });
  console.log(`${ok ? "PASS" : informational ? "INFO" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
};
const near = (px, want, tol = 14) => px && want.every((v, i) => Math.abs(px[i] - v) <= tol);
const MAGENTA = [255, 0, 170];
const GREEN = [0, 170, 85];

async function open(game, { shim }) {
  const ctx = await browser.newContext({ viewport: { width: 700, height: 420 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const src = encodeURIComponent(`/game-html/${game}/${shim ? "?hp-rec=1" : ""}`);
  await page.goto(`${base}/?src=${src}`);
  await page.waitForTimeout(600);
  return { page, ctx, errors };
}

try {
  // 1 + 2: WebGL, from a handler and from inside the frame
  {
    const { page, ctx, errors } = await open("gl", { shim: true });
    record("shim attaches to the game document", await page.evaluate(() => window.attach()), "");
    await page.frameLocator("#g").locator("#c").click();
    await page.waitForTimeout(300);
    await page.frameLocator("#g").locator("body").evaluate(() => { window.inFrame = "frame-moment"; });
    await page.waitForTimeout(400);
    const moments = await page.evaluate(() => window.settled());
    const h = moments.find((m) => m.name === "click-moment");
    const f = moments.find((m) => m.name === "frame-moment");
    record("WebGL: moment from an event handler is not blank", Boolean(h?.picture) && near(h.pixel, MAGENTA), h ? `pixel ${JSON.stringify(h.pixel)} ${h.reason ?? ""}` : "no moment seen");
    record("WebGL: moment made inside the frame, before it draws, is not blank", Boolean(f?.picture) && near(f.pixel, MAGENTA), f ? `pixel ${JSON.stringify(f.pixel)} ${f.reason ?? ""}` : "no moment seen");
    record("WebGL: the game's data arrives intact", h?.data?.via === "handler" && f?.data?.via === "frame", "");
    record("no page errors with the shim", errors.length === 0, errors.join("; "));

    // 4: control - a straight read from a handler, no shim involved
    const raw = await page.frameLocator("#g").locator("body").evaluate(() => window.rawGrab());
    record("control: a bare canvas read outside a frame is blank on this WebGL game", !raw || raw[3] === 0 || raw.every((v) => v === 0), `pixel ${JSON.stringify(raw)}`, true);

    // 6a: FrameGrabber on a synthetic stream (no permission needed)
    const sg = await page.evaluate(() => window.streamGrab());
    record("stream: the timed grab still crops to the game, 16:9", sg.timedCount > 0 && Math.abs(sg.timed.w / sg.timed.h - 16 / 9) < 0.02 && near(sg.timed.pixel, MAGENTA), JSON.stringify(sg.timed));
    record("stream: grabNow() crops to the game, 16:9, at once", Boolean(sg.now) && Math.abs(sg.now.w / sg.now.h - 16 / 9) < 0.02 && near(sg.now.pixel, MAGENTA), JSON.stringify(sg.now));

    // 6b: the browser's own tab share
    try {
      const pending = page.evaluate(() => window.shareGrab());
      await page.waitForSelector("#share");
      await page.click("#share");
      const share = await pending;
      if (share.skipped) record("screen share: grabNow()", false, `SKIPPED (${share.skipped}) - check by hand`, true);
      else record("screen share: grabNow() returns a 16:9 picture of the game", Math.abs(share.w / share.h - 16 / 9) < 0.02 && share.pixel[3] > 0, `${share.w}x${share.h} pixel ${JSON.stringify(share.pixel)}`);
    } catch (e) {
      record("screen share: grabNow()", false, `SKIPPED (${String(e).slice(0, 80)}) - check by hand`, true);
    }
    await ctx.close();
  }

  // 3: 2D
  {
    const { page, ctx } = await open("flat", { shim: true });
    await page.evaluate(() => window.attach());
    await page.frameLocator("#g").locator("#c").click();
    await page.waitForTimeout(300);
    const moments = await page.evaluate(() => window.settled());
    const m = moments.find((x) => x.name === "flat-moment");
    record("2D canvas: moment is not blank", Boolean(m?.picture) && near(m.pixel, GREEN), m ? `pixel ${JSON.stringify(m.pixel)}` : "no moment seen");
    await ctx.close();
  }

  // 5: a public player - no shim
  {
    const { page, ctx, errors } = await open("gl", { shim: false });
    const requests = [];
    page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
    const result = await page.frameLocator("#g").locator("body").evaluate(async () => {
      const a = await HallPass.moment("anything", { x: 1 });
      const b = await HallPass.moment("BAD NAME");
      return { a, b, hasShim: Boolean(window.__hpRec) };
    });
    await page.waitForTimeout(400);
    record("public player: moment() resolves and the shim is absent", result.a.ok === true && result.b.ok === false && !result.hasShim, JSON.stringify(result));
    record("public player: moment() makes no request and throws nothing", requests.length === 0 && errors.length === 0, requests.join(", ") || "no requests");
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok && !r.informational);
console.log(failed.length ? `\n${failed.length} FAILED` : "\nall required checks passed");
process.exit(failed.length ? 1 : 0);
