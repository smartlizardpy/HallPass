#!/usr/bin/env node
/**
 * Real-browser checks for the HallPass Offline Arcade, run the way a player
 * runs it: the launcher opened from disk (file://), with the browser's
 * network turned off, games.zip imported through the file picker.
 *
 * Opt-in, like sdk/p2p/e2e/run.mjs: Playwright is not a dependency of this repo.
 *
 *   npm run hpg:arcade                       # build public/arcade/
 *   PLAYWRIGHT_CORE=<dir of playwright-core> node hpg/e2e/run.mjs
 *
 * Env:
 *   BROWSER=chrome|edge|firefox|chromium   default chrome (the installed Google Chrome)
 *   HEADED=1                               watch it
 *   SHOTS=<dir>                            keep screenshots there
 * Exit code 1 if any check fails.
 *
 * What it proves, per browser:
 *   - the launcher works from file:// with zero network requests (any
 *     http(s) request at all fails the run, not just failed ones)
 *   - import of games.zip; refusal of a tampered package and of a non-ZIP
 *   - each game starts, draws, and changes when given its real input
 *   - the frame is sandboxed: opaque origin, no parent DOM, no network
 *   - localStorage written in a game survives Back, relaunch and a page reload
 *   - Back removes the frame
 *
 * Not covered: whether sound is audible (headless browsers have no output
 * device; we only check an AudioContext can be made), real touch hardware,
 * and gamepads.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(join(repo, "package.json"));
const { zipSync } = require("fflate");
const sharp = require("sharp");

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

/** How to get each game going and what input to feed it once it runs. */
const GAMES = {
  conquest: {
    // Input check: a real tap on the map picks a starting spot, which is what
    // enables Start.
    start: async (f) => f.getByRole("button", { name: "Play", exact: true }).click(),
    drive: async (page, box, f) => {
      const startBtn = f.getByRole("button", { name: "Start", exact: true });
      for (const [x, y] of [[0.56, 0.55], [0.7, 0.3], [0.2, 0.3], [0.3, 0.65], [0.85, 0.65]]) {
        if (await startBtn.isEnabled()) break;
        await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
        await page.waitForTimeout(300);
      }
    },
    observe: (f) => f.getByRole("button", { name: "Start", exact: true }).isEnabled(),
    moved: (a, b) => a === false && b === true,
    // Then the match must actually run (the simulation lives in a Web Worker
    // loaded from the package). Start is pressed with a DOM click: headless
    // Chrome stops routing real mouse input into an out-of-process sandboxed
    // frame after the canvas captured the pointer. Headed Chrome, which is
    // what players use, starts the match from a real click (checked by hand
    // with HEADED=1; see docs/offline-arcade-games.md).
    after: async (page, stage, f) => {
      await f.getByRole("button", { name: "Start", exact: true }).dispatchEvent("click");
      await page.waitForTimeout(1500);
      const a = await pixels(await stage.screenshot());
      await page.waitForTimeout(2500);
      const b = await pixels(await stage.screenshot());
      const setupGone = !(await f.getByText("Choose your starting land").isVisible());
      const delta = changed(a.data, b.data);
      return { name: "match runs", ok: setupGone && delta > 0.005, detail: `${(delta * 100).toFixed(1)}% of the map changed in 2.5 s` };
    },
  },
  "neon-tether": {
    start: async (f) => f.locator("#start-btn").click(),
    drive: async (page) => {
      for (const k of ["d", "s"]) {
        await page.keyboard.down(k);
        await page.waitForTimeout(500);
        await page.keyboard.up(k);
      }
    },
    // Small sprites on a dark grid barely move the pixel count, so read where
    // the pilot is: it must have moved right and down under the keys.
    observe: (f) => f.evaluate(() => (typeof player === "object" && player ? { x: Math.round(player.x), y: Math.round(player.y) } : null)),
    moved: (a, b) => !!a && !!b && b.x > a.x + 20 && b.y > a.y + 20,
  },
  "depths-of-aethelgard": {
    start: async (f) => f.getByText("ENTER DUNGEON").click(),
    drive: async (page) => {
      for (const k of ["d", "s", "a", "w", "d"]) {
        await page.keyboard.down(k);
        await page.waitForTimeout(250);
        await page.keyboard.up(k);
      }
    },
  },
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
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

function gameFrame(page) {
  return page.frames().find((f) => f.parentFrame() === page.mainFrame()) ?? null;
}

async function waitReady(page, ms = 15000) {
  await page.waitForFunction(() => document.querySelector(".game-frame") && !document.querySelector(".stage-msg"), null, { timeout: ms });
}

/** A copy of a package with one byte of game.html flipped, keeping the ZIP valid. */
function tamper(hpgBytes) {
  const { unzipSync } = require("fflate");
  const files = unzipSync(hpgBytes);
  const html = files["game.html"];
  html[Math.floor(html.length / 2)] ^= 1;
  return zipSync(files, { level: 0 });
}

async function main() {
  const browserName = process.env.BROWSER ?? "chrome";
  const pw = await loadPlaywright();
  const arcade = join(repo, "public", "arcade");
  const catalog = JSON.parse(readFileSync(join(arcade, "catalog.json"), "utf8"));
  if (!catalog.available) throw new Error("public/arcade is not built (npm run hpg:arcade)");

  // The folder a player unzips: index.html + games.zip.
  const work = mkdtempSync(join(tmpdir(), "hpg-e2e-"));
  const folder = join(work, "HallPass Arcade");
  mkdirSync(folder);
  cpSync(join(arcade, "index.html"), join(folder, "index.html"));
  const entries = {};
  for (const g of catalog.games) entries[g.file.split("/").pop()] = new Uint8Array(readFileSync(join(arcade, g.file)));
  writeFileSync(join(folder, "games.zip"), zipSync(entries, { level: 0 }));
  const first = catalog.games.find((g) => g.id === "neon-tether") ?? catalog.games[0];
  writeFileSync(join(work, "tampered.hpg"), tamper(new Uint8Array(readFileSync(join(arcade, first.file)))));
  writeFileSync(join(work, "notes.zip"), "this is not a zip file");

  const shots = process.env.SHOTS ? resolve(process.env.SHOTS) : null;
  if (shots) mkdirSync(shots, { recursive: true });
  const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${browserName}-${name}.png`) });

  const type = browserName === "firefox" ? pw.firefox : pw.chromium;
  const channel = { chrome: "chrome", edge: "msedge" }[browserName];
  const profile = join(work, "profile");
  const launch = () =>
    type.launchPersistentContext(profile, {
      channel,
      headless: !process.env.HEADED,
      offline: true,
      viewport: { width: 1280, height: 800 },
      // Without this, headless Chrome refuses to start audio that no gesture unlocked.
      args: channel || browserName === "chromium" ? ["--autoplay-policy=no-user-gesture-required"] : [],
    });

  const remote = [];
  const pageErrors = [];
  const watch = (ctx) => {
    ctx.on("request", (r) => {
      if (/^https?:/i.test(r.url())) remote.push(r.url());
    });
    ctx.on("page", (p) => p.on("pageerror", (e) => pageErrors.push(e.message)));
    for (const p of ctx.pages()) p.on("pageerror", (e) => pageErrors.push(e.message));
  };

  console.log(`HallPass Offline Arcade e2e — ${browserName}, file://, network off`);
  let ctx = await launch();
  watch(ctx);
  console.log(`  browser ${ctx.browser()?.version() ?? "(persistent context)"}`);
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  const url = pathToFileURL(join(folder, "index.html")).href;

  try {
    await page.goto(url);
    await page.getByRole("button", { name: "Browse files" }).waitFor();
    check("launcher opens from file://", page.url().startsWith("file:"));
    await shot(page, "welcome");

    const importFiles = async (files) => {
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: /Browse files|Add games/ }).first().click();
      await (await chooser).setFiles(files);
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll("dialog button")].find((x) => x.textContent === "Done");
        return b && !b.disabled;
      });
      const text = await page.locator("dialog").innerText();
      await page.getByRole("button", { name: "Done" }).click();
      return text;
    };

    const imported = await importFiles(join(folder, "games.zip"));
    const ids = catalog.games.map((g) => g.id);
    const cards = await page.locator(".card-wrap").evaluateAll((els) => els.map((e) => e.dataset.game));
    check("games.zip imports every game", ids.every((id) => cards.includes(id)), cards.join(", "));
    check("import reports each game added", catalog.games.every((g) => imported.includes(`${g.name} added`)));
    await shot(page, "library");

    const refused = await importFiles([join(work, "tampered.hpg"), join(work, "notes.zip")]);
    check("a tampered package is refused", /changed or damaged/.test(refused), refused.split("\n").find((l) => /damaged/.test(l)) ?? refused);
    check("a non-ZIP is refused", /not a ZIP|isn't a HallPass/.test(refused));
    check("refused files leave the library unchanged", (await page.locator(".card-wrap").count()) === ids.length);

    for (const id of ids) {
      const spec = GAMES[id];
      console.log(`  — ${id}`);
      await page.locator(`.card-wrap[data-game="${id}"] .card`).click();
      const t0 = Date.now();
      try {
        await waitReady(page);
        check(`${id}: starts`, true, `${Date.now() - t0} ms to GAME_READY`);
      } catch {
        check(`${id}: starts`, false, "no GAME_READY within 15 s");
        await shot(page, `${id}-stuck`);
        await page.getByRole("button", { name: "Back to arcade" }).first().click();
        continue;
      }
      const frameEl = page.locator(".game-frame");
      check(`${id}: sandbox is allow-scripts only`, (await frameEl.getAttribute("sandbox")) === "allow-scripts");
      const f = gameFrame(page);
      const probe = await f.evaluate(async () => {
        const out = { origin: String(self.origin), hp: window.HallPass?.version ?? null };
        try {
          void parent.document.body;
          out.parent = "readable";
        } catch {
          out.parent = "blocked";
        }
        try {
          await fetch("https://example.com/");
          out.net = "reached";
        } catch {
          out.net = "blocked";
        }
        try {
          const ac = new AudioContext();
          out.audio = ac.state;
          await ac.close();
        } catch (e) {
          out.audio = `error: ${e}`;
        }
        localStorage.setItem("hpg-e2e", `kept-${Date.now()}`);
        out.ls = localStorage.getItem("hpg-e2e");
        return out;
      });
      check(`${id}: opaque origin`, probe.origin === "null", probe.origin);
      check(`${id}: cannot touch the launcher page`, probe.parent === "blocked");
      check(`${id}: cannot reach the network`, probe.net === "blocked");
      check(`${id}: offline HallPass SDK present`, probe.hp === "offline-1", String(probe.hp));
      check(`${id}: AudioContext can be created`, !String(probe.audio).startsWith("error"), probe.audio);

      await page.waitForTimeout(800);
      const stage = page.locator(".player-stage");
      const before = await pixels(await stage.screenshot());
      check(`${id}: draws something`, before.colours > 8, `${before.colours} colours`);
      await spec.start(f);
      await page.waitForTimeout(600);
      const box = await stage.boundingBox();
      const a = await pixels(await stage.screenshot());
      const s0 = spec.observe ? await spec.observe(f) : null;
      await spec.drive(page, box, f);
      await page.waitForTimeout(600);
      const b = await pixels(await stage.screenshot());
      const delta = changed(a.data, b.data);
      if (spec.observe) {
        const s1 = await spec.observe(f);
        check(`${id}: responds to input`, spec.moved(s0, s1), `${JSON.stringify(s0)} → ${JSON.stringify(s1)}`);
      } else {
        check(`${id}: responds to input`, delta > 0.03, `${(delta * 100).toFixed(1)}% of the screen changed`);
      }
      if (spec.after) {
        const r = await spec.after(page, stage, f);
        check(`${id}: ${r.name}`, r.ok, r.detail);
      }
      await shot(page, id);

      await page.getByRole("button", { name: "Back to arcade" }).click();
      await page.waitForFunction(() => !document.querySelector(".player"));
      check(`${id}: Back removes the game frame`, (await page.locator("iframe").count()) === 0);

      await page.locator(`.card-wrap[data-game="${id}"] .card`).click();
      await waitReady(page);
      const again = await gameFrame(page).evaluate(() => localStorage.getItem("hpg-e2e"));
      check(`${id}: save survives Back and relaunch`, again === probe.ls, String(again));
      await page.getByRole("button", { name: "Back to arcade" }).click();
      await page.waitForFunction(() => !document.querySelector(".player"));
      results.find((r) => r.name === `${id}: save survives Back and relaunch`).value = probe.ls;
    }

    // Close the browser completely and open the page again: the library and
    // the saves must come back from IndexedDB.
    await ctx.close();
    ctx = await launch();
    watch(ctx);
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(url);
    await page.locator(".card-wrap").first().waitFor();
    check("library survives a browser restart", (await page.locator(".card-wrap").count()) === ids.length);
    const persistentNotice = await page.locator(".notice").count();
    check("storage is persistent (no 'won't keep' notice)", persistentNotice === 0);
    const id = ids[0];
    const expected = results.find((r) => r.name === `${id}: save survives Back and relaunch`)?.value;
    await page.locator(`.card-wrap[data-game="${id}"] .card`).click();
    await waitReady(page);
    const afterRestart = await gameFrame(page).evaluate(() => localStorage.getItem("hpg-e2e"));
    check(`${id}: save survives a browser restart`, afterRestart === expected, String(afterRestart));
    await page.getByRole("button", { name: "Back to arcade" }).click();
  } catch (e) {
    check("run completed", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
    await shot(page, "failure").catch(() => {});
  } finally {
    await ctx.close().catch(() => {});
  }

  check("zero network requests", remote.length === 0, remote.slice(0, 3).join(", "));
  check("no uncaught errors in the launcher", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  rmSync(work, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed on ${browserName}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

