#!/usr/bin/env node
/**
 * Smoke-test EVERY game in the local lab arcade (`npm run hpg:lab`), the way a
 * player runs it: launcher from file://, browser network off, games.zip
 * imported through the file picker. Writes a screenshot report to
 * arcade-lab/report/index.html.
 *
 *   npm run hpg:lab
 *   PLAYWRIGHT_CORE=<dir of playwright-core> npm run hpg:smoke
 *
 * Env: BROWSER=chrome|edge|chromium (default chrome), HEADED=1, ONLY=<id,id>,
 *      LAB=<dir> (a lab built with `hpg lab --out <dir>`; default arcade-lab/).
 *
 * Unlike hpg/e2e/run.mjs this knows nothing about any game: it clicks the
 * middle, presses Enter and Space, then holds arrows and WASD. So per game it
 * can say:
 *   PASS  it started, drew, logged no errors and changed under input
 *   CHECK it started and drew, but logged errors or did not visibly react
 *         (often fine: a menu needing a specific button; look at the shots)
 *   FAIL  it never signalled ready, or showed a blank screen
 * A PASS here is NOT `verified`: that still takes an adapter and run.mjs.
 * Exit code 1 only if a game FAILs or anything touched the network.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(join(repo, "package.json"));
const sharp = require("sharp");
const lab = process.env.LAB ? resolve(process.env.LAB) : join(repo, "arcade-lab");

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE;
  const candidates = spec ? [pathToFileURL(join(resolve(spec), "index.mjs")).href] : ["playwright-core", "playwright"];
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      /* next */
    }
  }
  console.error("playwright-core not found. Set PLAYWRIGHT_CORE=<path to a playwright-core package dir>.");
  process.exit(2);
}

/** Distinct colours (coarsely bucketed) and raw pixels of a PNG. */
async function pixels(png) {
  const { data } = await sharp(png).resize(160, 100, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Set();
  for (let i = 0; i < data.length; i += 3) buckets.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4));
  return { data, colours: buckets.size };
}
function changed(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++;
  return n / (a.length / 3);
}
/** Labels of buttons that start a game, tried before a blind click. */
const START_WORDS = /^\W*(play|start|begin|engage|deploy|initiali[sz]e|descend|enter|launch|go|new game|vs cpu|single ?player|tutorial|execute|continue|solo)\b/i;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function main() {
  const report = JSON.parse(readFileSync(join(lab, "lab.json"), "utf8"));
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const built = report.games.filter((g) => g.built && (!only || only.has(g.id)));
  const browserName = process.env.BROWSER ?? "chrome";
  const pw = await loadPlaywright();
  const out = join(lab, "report");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const profile = mkdtempSync(join(tmpdir(), "hpg-smoke-"));
  const ctx = await pw.chromium.launchPersistentContext(profile, {
    channel: { chrome: "chrome", edge: "msedge" }[browserName],
    headless: !process.env.HEADED,
    offline: true,
    viewport: { width: 1280, height: 800 },
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const remote = [];
  let current = null;
  const errors = new Map(); // id -> messages
  const note = (msg) => {
    const key = current ?? "(launcher)";
    if (!errors.has(key)) errors.set(key, []);
    if (errors.get(key).length < 8) errors.get(key).push(msg.slice(0, 300));
  };
  ctx.on("request", (r) => /^https?:/i.test(r.url()) && remote.push(`${current ?? "launcher"}: ${r.url()}`));
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("pageerror", (e) => note(`launcher: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && note(m.text()));

  console.log(`HallPass lab smoke test — ${built.length} games, ${browserName}, file://, network off`);
  await page.goto(pathToFileURL(join(lab, "index.html")).href);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse files" }).click();
  await (await chooser).setFiles(join(lab, "games.zip"));
  await page.waitForFunction(
    () => [...document.querySelectorAll("dialog button")].some((x) => x.textContent === "Done" && !x.disabled),
    null,
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "Done" }).click();
  const cards = await page.locator(".card-wrap").evaluateAll((els) => els.map((e) => e.dataset.game));
  console.log(`  imported ${cards.length} games`);

  const rows = [];
  for (const g of built) {
    current = g.id;
    const row = { ...g, verdict: "FAIL", detail: [], shots: [] };
    rows.push(row);
    process.stdout.write(`  ${g.id.padEnd(30)} `);
    if (!cards.includes(g.id)) {
      row.detail.push("not in the library after import");
      console.log("FAIL (not imported)");
      continue;
    }
    try {
      await page.locator(`.card-wrap[data-game="${g.id}"] .card`).click();
      const t0 = Date.now();
      try {
        await page.waitForFunction(() => document.querySelector(".game-frame") && !document.querySelector(".stage-msg"), null, { timeout: 15_000 });
        row.readyMs = Date.now() - t0;
      } catch {
        row.detail.push("no GAME_READY within 15 s");
      }
      const sandbox = await page.locator(".game-frame").getAttribute("sandbox").catch(() => null);
      // allow-scripts, plus allow-pointer-lock when the manifest asks; never same-origin.
      if (!/^allow-scripts( allow-pointer-lock)?$/.test(sandbox ?? "")) row.detail.push(`sandbox is "${sandbox}"`);
      await page.waitForTimeout(1500);
      const stage = page.locator(".player-stage");
      const shot = async (name) => {
        const png = await stage.screenshot();
        writeFileSync(join(out, `${g.id}-${name}.png`), png);
        row.shots.push(`${g.id}-${name}.png`);
        return pixels(png);
      };
      const loaded = await shot("1-loaded");
      row.colours = loaded.colours;
      // Generic start: press the first visible start-like button if there is
      // one, otherwise click the middle; then Enter and Space.
      const box = await stage.boundingBox();
      const f = page.frames().find((fr) => fr.parentFrame() === page.mainFrame());
      const startBtn = f
        ?.locator("button, [role=button], a, .btn, .button, [onclick]")
        .filter({ hasText: START_WORDS, visible: true })
        .first();
      const pressed = startBtn ? await startBtn.innerText({ timeout: 500 }).catch(() => null) : null;
      if (pressed) {
        row.pressed = pressed.trim().slice(0, 40);
        await startBtn.click({ timeout: 2000 }).catch(() => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));
      } else {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await page.waitForTimeout(700);
      const started = await shot("2-started");
      // Generic play: arrows and WASD, mouse sweeps, a click.
      for (const k of ["ArrowRight", "ArrowDown", "d", "s", "ArrowLeft", "a", "ArrowUp", "w"]) {
        await page.keyboard.down(k);
        await page.mouse.move(box.x + box.width * (0.3 + Math.random() * 0.4), box.y + box.height * (0.3 + Math.random() * 0.4));
        await page.waitForTimeout(220);
        await page.keyboard.up(k);
      }
      // A swipe (slicing/drag games), then a click.
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.6);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.25 + i * 0.06), box.y + box.height * (0.6 - i * 0.03));
      await page.mouse.up();
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
      await page.waitForTimeout(500);
      const played = await shot("3-played");
      row.delta = Math.max(changed(loaded.data, started.data), changed(started.data, played.data));
      const toast = await page.locator(".toasts").innerText().catch(() => "");
      if (/reported a problem/.test(toast)) note(`launcher toast: ${toast.replace(/\s+/g, " ").slice(0, 200)}`);

      const errs = errors.get(g.id) ?? [];
      const ready = row.readyMs !== undefined;
      const draws = loaded.colours > 8 || played.colours > 8;
      if (!draws) row.detail.push(`blank screen (${loaded.colours} colours)`);
      if (errs.length) row.detail.push(`${errs.length} error(s): ${errs[0]}`);
      if (row.delta < 0.02) row.detail.push(`screen barely changed under input (${pct(row.delta)})`);
      row.errors = errs;
      row.verdict = !ready || !draws ? "FAIL" : errs.length || row.delta < 0.02 ? "CHECK" : "PASS";
    } catch (e) {
      row.detail.push(`run error: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
    console.log(`${row.verdict}${row.pressed ? `  [${row.pressed}]` : ""}${row.readyMs !== undefined ? `  ready ${row.readyMs} ms` : ""}${row.delta !== undefined ? `  Δ ${pct(row.delta)}` : ""}${row.detail.length ? `  — ${row.detail.join("; ")}` : ""}`);
    // Back to the library; dismiss toasts so the next game starts clean.
    await page.getByRole("button", { name: "Back to arcade" }).first().click().catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".player"), null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => document.querySelector(".toasts")?.remove());
  }
  current = null;
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const blocked = report.games.filter((g) => !g.built);
  writeFileSync(join(out, "index.html"), html(rows, blocked, remote, errors.get("(launcher)") ?? [], browserName));
  writeFileSync(join(out, "results.json"), JSON.stringify({ browser: browserName, at: new Date().toISOString(), rows: rows.map((r) => ({ ...r, shots: undefined })), blocked, remote }, null, 2));
  console.log(`\n${count("PASS")} pass · ${count("CHECK")} check · ${count("FAIL")} fail · ${blocked.length} blocked (not built)`);
  console.log(remote.length ? `✗ ${remote.length} network request(s): ${remote.slice(0, 3).join(", ")}` : "✓ zero network requests");
  console.log(`report: ${join(out, "index.html")}`);
  process.exit(count("FAIL") || remote.length ? 1 : 0);
}

function html(rows, blocked, remote, launcherErrors, browserName) {
  const badge = { PASS: "#14a06b", CHECK: "#d98a00", FAIL: "#d61f5d" };
  const order = { FAIL: 0, CHECK: 1, PASS: 2 };
  const cards = [...rows]
    .sort((a, b) => order[a.verdict] - order[b.verdict] || a.name.localeCompare(b.name))
    .map(
      (r) => `<article>
  <header><span class="badge" style="background:${badge[r.verdict]}">${r.verdict}</span><h2>${esc(r.name)}</h2><code>${esc(r.id)}</code><span class="tag">${esc(r.adapter)}</span></header>
  <p class="meta">${r.pressed ? `pressed “${esc(r.pressed)}” · ` : ""}${r.readyMs !== undefined ? `ready in ${r.readyMs} ms` : "never ready"} · ${r.colours ?? "?"} colours · ${r.delta !== undefined ? `${pct(r.delta)} changed under input` : "—"} · ${r.sizeKb} KB</p>
  ${r.detail.length ? `<ul>${r.detail.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
  ${r.errors?.length > 1 ? `<details><summary>All errors</summary><pre>${esc(r.errors.join("\n"))}</pre></details>` : ""}
  ${r.issues.length ? `<details><summary>Build warnings</summary><pre>${esc(r.issues.join("\n"))}</pre></details>` : ""}
  <div class="shots">${r.shots.map((s, i) => `<figure><img src="${s}" loading="lazy" alt=""><figcaption>${["loaded", "after click / Enter / Space", "after arrows + WASD"][i]}</figcaption></figure>`).join("")}</div>
</article>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arcade Smoke Test</title>
<style>
:root{--bg:#f6f4fb;--card:#fff;--fg:#1c1c28;--muted:#6b6880;--line:#e6e2f0}
@media (prefers-color-scheme:dark){:root{--bg:#121218;--card:#1c1c28;--fg:#f3f1fa;--muted:#a19db5;--line:#2c2a3a}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 ui-rounded,system-ui,sans-serif;padding:24px 16px}
main{max-width:1200px;margin:auto}h1{margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
article{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 0 16px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:10px}h2{margin:0;font-size:18px}
code,.tag{color:var(--muted);font-size:13px}.tag{border:1px solid var(--line);border-radius:99px;padding:1px 8px}
.badge{color:#fff;font-weight:800;font-size:12px;border-radius:99px;padding:3px 10px}
.meta{color:var(--muted);margin:8px 0}ul{margin:6px 0 10px;padding-left:20px}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
figure{margin:0}img{width:100%;border-radius:10px;border:1px solid var(--line);background:#000}
figcaption{color:var(--muted);font-size:12px;margin-top:4px}pre{white-space:pre-wrap;font-size:12px}
table{border-collapse:collapse;width:100%;background:var(--card);border-radius:12px}td{padding:6px 10px;border-top:1px solid var(--line);vertical-align:top}
</style></head><body><main>
<h1>Offline arcade smoke test</h1>
<p class="sub">${esc(browserName)} · launcher from file:// · network off · ${new Date().toLocaleString()} ·
${rows.filter((r) => r.verdict === "PASS").length} pass, ${rows.filter((r) => r.verdict === "CHECK").length} check, ${rows.filter((r) => r.verdict === "FAIL").length} fail ·
${remote.length ? `<b style="color:#d61f5d">${remote.length} network requests</b>` : "zero network requests"}</p>
<p class="sub">CHECK usually means the game needs a specific button to start, which a generic click misses. Look at the screenshots.</p>
${launcherErrors.length ? `<p><b>Launcher errors:</b> ${esc(launcherErrors.join(" | "))}</p>` : ""}
${cards}
<h2 style="margin:28px 0 10px">Not built (${blocked.length})</h2>
<table>${blocked.map((g) => `<tr><td><b>${esc(g.name)}</b><br><code>${esc(g.id)}</code></td><td>${esc(g.issues[0] ?? "")}</td></tr>`).join("")}</table>
</main></body></html>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
