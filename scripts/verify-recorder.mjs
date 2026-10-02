#!/usr/bin/env node
/**
 * Real-browser check of the gameplay recorder (docs/game-recorder.md).
 *
 *   node scripts/verify-recorder.mjs [--only slug,slug] [--ms 3000] [--json]
 *
 * NOT part of `npm test`: Playwright is not a project dependency (it resolves
 * from whatever `node_modules` is on the path — this repo's worktrees symlink the
 * main checkout's), and a real browser is slow. Run it by hand before changing
 * the recorder, the shim or the /game-html route.
 *
 * WHAT IT DOES. Bundles the real `game-recorder.ts` / `record-shim.ts` with
 * esbuild, serves a tiny harness page plus every bundled game from `public/games`
 * (injecting the shim with the SAME `injectShim` the route uses), then for each
 * game: loads it, starts it with a click, records a few seconds through
 * `GameRecorder`, and checks the result. It also runs a control load WITHOUT the
 * shim and fails any game that throws more page errors with the shim than without.
 *
 * WHAT IT DOES NOT DO. It does not run the Next route (that is covered by
 * `route.test.ts`), sign in, or touch iOS. Chromium's `MediaRecorder` is not
 * Safari's. Frame-accurate sync between the sidecar and the video is not
 * measured — only the sidecar's own clock.
 *
 * Every step has its own timeout: an unbounded `page.evaluate` against a game
 * stuck in a busy loop hung an earlier probe for 17 minutes.
 */

import { build } from "esbuild";
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = path.join(root, "public/games");
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};
const only = flag("only", "")
  .split(",")
  .filter(Boolean);
const RECORD_MS = Number(flag("ms", "3000"));
const asJson = args.includes("--json");
const STEP_TIMEOUT = 45_000;

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ]);

// ── bundles ─────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hp-rec-"));
const entry = path.join(tmp, "entry.ts");
const cap = path.join(root, "app/lib/capture");
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(cap, "game-recorder.ts"))};
export { limitsFor, DESKTOP_LIMITS } from ${JSON.stringify(path.join(cap, "record-policy.ts"))};`,
);
await build({ entryPoints: [entry], bundle: true, format: "iife", globalName: "HPRec", outfile: path.join(tmp, "browser.js"), logLevel: "error" });
await build({
  entryPoints: [path.join(cap, "record-shim.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: path.join(tmp, "shim.mjs"),
  logLevel: "error",
});
const { injectShim } = await import(pathToFileURL(path.join(tmp, "shim.mjs")).href);
const browserJs = fs.readFileSync(path.join(tmp, "browser.js"), "utf8");

// ── servers ─────────────────────────────────────────────────────────────────
const HARNESS = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%}iframe{width:960px;height:600px;border:0}</style>
<iframe id=g></iframe><script src="/browser.js"></script><script>
const q = new URLSearchParams(location.search);
document.getElementById('g').src = q.get('src');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.runTake = async (opts) => {
  const frame = document.getElementById('g');
  const probe = HPRec.probeRecordable(frame);
  if (!probe.ok) return { refused: probe.reason };
  let auto = null;
  const limits = Object.assign({}, HPRec.DESKTOP_LIMITS, opts.limits || {});
  const rec = new HPRec.GameRecorder(probe, { slug: opts.slug, title: opts.slug, limits, onAutoStop: (t) => { auto = t; } });
  const started = await rec.start();
  if (!started.ok) return { refused: started.reason };
  let submitAt = null;
  const hp = frame.contentWindow.HallPass;
  if (hp && typeof hp.submitScore === 'function') { await sleep(500); submitAt = Date.now(); hp.submitScore(123); }
  rec.addEvent('mark', 'tester');
  await sleep(opts.ms);
  const take = auto || await rec.stop('user');
  const bytes = new Uint8Array(await take.video.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4e6)));
  const decode = await new Promise((resolve) => {
    const v = document.createElement('video'); v.muted = true;
    v.onloadeddata = () => resolve({ ok: v.videoWidth > 0, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => resolve({ ok: false });
    setTimeout(() => resolve({ ok: false, timeout: true }), 8000);
    v.src = URL.createObjectURL(take.video);
  });
  const types = {};
  take.sidecar.events.forEach((e) => { types[e.type] = (types[e.type] || 0) + 1; });
  const submit = take.sidecar.events.find((e) => e.type === 'score.submit');
  return {
    layered: probe.layered, shimmed: probe.shimmed, canvasCount: probe.canvasCount,
    bytes: take.bytes, mimeType: take.mimeType, durationMs: Math.round(take.durationMs),
    endedBy: take.endedBy, cap: take.cap, audio: take.sidecar.recording.audio,
    hasOpus: /A_OPUS/.test(text), decode, types,
    submitSkewMs: submit && submitAt ? Math.round(submit.t - (submitAt - take.sidecar.recording.startedAtEpochMs)) : null,
    sidecarOk: take.sidecar.format === 'hallpass-recording-events' && take.sidecar.version === 1 &&
      take.sidecar.events.every((e, i, a) => i === 0 || a[i - 1].t <= e.t),
  };
};</script>`;

function makeServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(HARNESS);
    if (url.pathname === "/browser.js") return void res.writeHead(200, { "content-type": "text/javascript" }).end(browserJs);
    const m = /^\/game-html\/([a-z0-9-]+)\/$/.exec(url.pathname);
    if (m) {
      const file = path.join(gamesDir, m[1], "index.html");
      if (!fs.existsSync(file)) return void res.writeHead(404).end();
      const html = fs.readFileSync(file, "utf8");
      return void res
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        .end(url.searchParams.get("hp-rec") === "1" ? injectShim(html) : html);
    }
    const s = /^\/sdk\/(.+)$/.exec(url.pathname);
    if (s && fs.existsSync(path.join(root, "public/sdk", s[1]))) {
      return void res.writeHead(200, { "content-type": "text/javascript" }).end(fs.readFileSync(path.join(root, "public/sdk", s[1])));
    }
    res.writeHead(404).end();
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}
const main = await makeServer();
const other = await makeServer();
const base = `http://127.0.0.1:${main.port}`;

// ── browser ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
});

async function withPage(fn) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const errors = [];
  try {
    await ctx.route("https://hallpass.gg/sdk/**", (r) => {
      const f = path.join(root, "public", new URL(r.request().url()).pathname);
      return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(f) }) : r.abort();
    });
    await ctx.route(/hallpass\.gg\/api\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"rank":1}' }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    if (process.env.HP_DEBUG) page.on("console", (m) => console.log("  [page]", m.text().slice(0, 160)));
    page.on("pageerror", (e) => errors.push(e.message));
    const frameErrors = () => errors.slice();
    return await withTimeout(fn(page, frameErrors), STEP_TIMEOUT * 2, "game");
  } finally {
    await withTimeout(ctx.close(), 10_000, "close").catch(() => {});
  }
}

async function startGame(page, src) {
  await page.goto(`${base}/?src=${encodeURIComponent(src)}`, { waitUntil: "load", timeout: 20_000 });
  await page.frameLocator("#g").locator("body").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.mouse.click(480, 300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  await page.mouse.click(480, 300);
}

const slugs = fs.readdirSync(gamesDir).filter((s) => !only.length || only.includes(s)).sort();
const results = [];

for (const slug of slugs) {
  const row = { slug };
  try {
    // Control: no shim.
    row.controlErrors = await withPage(async (page, errs) => {
      await startGame(page, `/game-html/${slug}/`);
      await page.waitForTimeout(1500);
      return errs().length;
    });
    // With the shim, and a recording.
    await withPage(async (page, errs) => {
      await startGame(page, `/game-html/${slug}/${process.env.HP_NOSHIM ? "" : "?hp-rec=1"}`);
      row.take = await withTimeout(page.evaluate((o) => window.runTake(o), { slug, ms: RECORD_MS }), STEP_TIMEOUT, "take");
      row.shimErrors = errs().length;
    });
    const t = row.take;
    const problems = [];
    if (t.refused) {
      row.status = t.refused === "no-canvas" ? "refused:no-canvas" : `refused:${t.refused}`;
    } else {
      if (!t.shimmed) problems.push("shim not in page");
      if (!(t.bytes > 1000)) problems.push("video empty");
      if (!t.decode?.ok) problems.push("video does not decode");
      if (!t.sidecarOk) problems.push("sidecar invalid");
      if (t.types["recording.start"] !== 1 || t.types["recording.stop"] !== 1) problems.push("start/stop events");
      if (t.audio === "webaudio" && !t.hasOpus) problems.push("audio claimed but no opus track");
      row.status = problems.length ? "FAIL" : "ok";
    }
    if (row.shimErrors > row.controlErrors) {
      (row.problems ??= []).push(`shim adds page errors (${row.controlErrors} → ${row.shimErrors})`);
      row.status = "FAIL";
    }
    if (t.refused !== undefined || !problems.length) {
      /* nothing */
    } else (row.problems ??= []).push(...problems);
  } catch (e) {
    row.status = "FAIL";
    row.problems = [String(e.message).slice(0, 120)];
  }
  results.push(row);
  if (!asJson) {
    const t = row.take ?? {};
    console.log(
      `${row.status.padEnd(18)} ${slug.padEnd(30)} ` +
        (t.refused
          ? `refused (${t.refused})`
          : `${(t.bytes / 1024).toFixed(0)}KB ${t.mimeType ?? ""} audio=${t.audio} layered=${t.layered} events=${JSON.stringify(t.types)} skew=${t.submitSkewMs}`) +
        (row.problems ? `  !! ${row.problems.join("; ")}` : ""),
    );
  }
}

// ── targeted checks ─────────────────────────────────────────────────────────
const extra = [];
async function check(name, fn) {
  try {
    const r = await fn();
    extra.push({ name, ...r });
  } catch (e) {
    extra.push({ name, ok: false, detail: String(e.message).slice(0, 120) });
  }
  const last = extra.at(-1);
  if (!asJson) console.log(`${last.ok ? "ok" : "FAIL"}  check: ${name} — ${last.detail ?? ""}`);
}
if (!only.length || only.includes("snag")) {
  await check("cross-origin game is refused", () =>
    withPage(async (page) => {
      await page.goto(`${base}/?src=${encodeURIComponent(`http://127.0.0.1:${other.port}/game-html/snag/`)}`, { waitUntil: "load" });
      await page.waitForTimeout(800);
      const r = await page.evaluate((o) => window.runTake(o), { slug: "snag", ms: 500 });
      return { ok: r.refused === "cross-origin", detail: JSON.stringify(r.refused ?? r) };
    }),
  );
  await check("length cap auto-stops and returns the take", () =>
    withPage(async (page) => {
      await startGame(page, `/game-html/snag/?hp-rec=1`);
      const r = await page.evaluate((o) => window.runTake(o), { slug: "snag", ms: 6000, limits: { maxMs: 2000 } });
      return {
        ok: r.endedBy === "cap" && r.cap === "time" && r.bytes > 1000 && r.durationMs < 4500,
        detail: `endedBy=${r.endedBy} cap=${r.cap} ${r.durationMs}ms ${r.bytes}B`,
      };
    }),
  );
  await check("size cap auto-stops", () =>
    withPage(async (page) => {
      await startGame(page, `/game-html/snag/?hp-rec=1`);
      const r = await page.evaluate((o) => window.runTake(o), { slug: "snag", ms: 8000, limits: { maxBytes: 20_000 } });
      return { ok: r.endedBy === "cap" && r.cap === "size", detail: `endedBy=${r.endedBy} cap=${r.cap} ${r.bytes}B` };
    }),
  );
}

await browser.close();
main.server.close();
other.server.close();
fs.rmSync(tmp, { recursive: true, force: true });

const fails = results.filter((r) => r.status === "FAIL").length + extra.filter((e) => !e.ok).length;
const count = (p) => results.filter((r) => r.status.startsWith(p)).length;
const summary = { games: results.length, ok: count("ok"), refused: count("refused"), failed: results.filter((r) => r.status === "FAIL").length, withAudio: results.filter((r) => r.take?.audio === "webaudio").length, checks: extra };
if (asJson) console.log(JSON.stringify({ summary, results }, null, 2));
else console.log(`\n${JSON.stringify(summary)}`);
process.exit(fails ? 1 : 0);
