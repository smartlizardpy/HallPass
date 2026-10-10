#!/usr/bin/env node
/**
 * Real-browser checks for the HallPass P2P SDK (section 6 of the brief), using
 * headless Chromium, REAL WebRTC and the `local` transport (BroadcastChannel
 * between pages of one browser profile). No HallPass server is involved.
 *
 * Opt-in: Playwright is not a dependency of this repo. To run:
 *
 *   npm run build:sdk:p2p                       # build public/sdk/p2p/v1/
 *   npm i --no-save playwright-core             # or point PLAYWRIGHT_CORE at an install
 *   npx playwright-core install chromium        # unless CHROMIUM_PATH points at a Chromium
 *   node sdk/p2p/e2e/run.mjs
 *
 * Env: PLAYWRIGHT_CORE=<path to a playwright-core package dir>, CHROMIUM_PATH=<executable>,
 * BROWSER=chromium|webkit|firefox (default chromium; WebKit gets mic access
 * first so it exposes host candidates; the voice check is skipped on Firefox), ONLY=2,5 to run
 * some checks, HEADED=1 to watch.
 * Exit code 1 if any check fails.
 *
 * Not covered here (cannot be simulated on one machine): NAT traversal between
 * different networks, TURN fallback, and a real network drop — the unit tests
 * cover the drop with a fake network (sdk/p2p/src/room.test.ts).
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join as joinPath, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../public", import.meta.url)));

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE;
  const candidates = spec ? [pathToFileURL(joinPath(resolve(spec), "index.mjs")).href, spec] : ["playwright-core", "playwright"];
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      // try the next one
    }
  }
  console.error("playwright-core not found. See the header of sdk/p2p/e2e/run.mjs.");
  process.exit(2);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ts": "text/plain", ".json": "application/json" };

function serve() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
      const file = joinPath(root, path);
      if (!file.startsWith(root)) return res.writeHead(403).end();
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => ok(server));
  });
}

// ── tiny test framework ────────────────────────────────────────────────────

const results = [];
async function check(name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(",").some((n) => name.startsWith(n + "."))) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, what = "condition") {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

// ── page helpers ───────────────────────────────────────────────────────────

let ctx;
let base;
let gameSeq = 0;
const pages = [];
const EVENTS = ["player-join", "player-leave", "player-update", "room-update", "start", "host-left", "kicked", "closed", "visibility", "error"];

async function newPage(game, name, extra = {}) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`    [${name}] page error: ${e.message}`));
  await page.goto(`${base}/sdk/p2p/demo/harness.html`);
  await page.waitForFunction(() => window.ready === true);
  if (process.env.BROWSER && process.env.BROWSER !== "chromium") {
    // WebKit (like Safari) hides host ICE candidates from a page without
    // capture permission, so two tabs on one machine have nothing to connect
    // over. Granting the mic first lifts that, as Safari's Develop menu does.
    await page.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => (window.keepMic = s)));
  }
  await page.evaluate(
    async ({ game, name, extra }) => {
      window.client = await window.HallPassP2P.connect({ gameId: game, gameVersion: "1", name, transport: "auto", ...extra });
    },
    { game, name, extra },
  );
  pages.push(page);
  return page;
}

async function create(page, opts = {}) {
  return page.evaluate(
    async ({ opts, EVENTS }) => {
      window.room = await window.client.createRoom(opts);
      window.record(window.room, EVENTS);
      return window.room.code;
    },
    { opts, EVENTS },
  );
}

async function join(page, code) {
  return page.evaluate(
    async ({ code, EVENTS }) => {
      try {
        window.room = await window.client.joinRoom(code);
        window.record(window.room, EVENTS);
        return { ok: true };
      } catch (e) {
        return { ok: false, code: e.code, reason: e.reason, message: e.message };
      }
    },
    { code, EVENTS },
  );
}

async function group(n, extra = {}, roomOpts = {}) {
  const game = `e2e-${++gameSeq}-${Date.now()}`;
  const host = await newPage(game, "Host", extra);
  const code = await create(host, { maxPlayers: 4, ...roomOpts });
  const guests = [];
  for (let i = 0; i < n; i++) {
    const g = await newPage(game, `Guest ${i + 1}`, extra);
    const r = await join(g, code);
    assert(r.ok, `Guest ${i + 1} failed to join: ${r.code} ${r.message}`);
    guests.push(g);
  }
  const all = [host, ...guests];
  // joinRoom() resolves for the newcomer when the host admits it; the others
  // learn about it (player-join) one hop later. Wait until everyone knows everyone.
  await until(async () => (await Promise.all(all.map((p) => p.evaluate(() => window.room.players.length)))).every((n) => n === all.length), 10000, "everyone to see everyone");
  return { game, code, host, guests, all };
}

async function closeAll() {
  for (const p of pages.splice(0)) await p.close().catch(() => {});
}

const players = (p) => p.evaluate(() => window.room.players.map((x) => ({ id: x.id, name: x.name, state: x.connection.state, relay: x.connection.relay })));

// ── scenarios ──────────────────────────────────────────────────────────────

async function main() {
  const pw = await loadPlaywright();
  const kind = process.env.BROWSER || "chromium";
  const server = await serve();
  base = `http://127.0.0.1:${server.address().port}`;
  const isChromium = kind === "chromium";
  const browser = await pw[kind].launch({
    headless: !process.env.HEADED,
    executablePath: (isChromium && process.env.CHROMIUM_PATH) || undefined,
    args: isChromium ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] : [],
  });
  ctx = await browser.newContext(kind === "firefox" ? {} : { permissions: ["microphone"] });
  console.log(`HallPass P2P e2e — ${kind} ${browser.version()} — ${base}`);

  await check("1. a host and three joiners form a room and all see the same players over real WebRTC", async () => {
    const { all } = await group(3);
    await until(async () => (await Promise.all(all.map(players))).every((l) => l.length === 4 && l.every((x) => x.state === "connected")), 10000, "full mesh");
    const lists = await Promise.all(all.map(players));
    const key = (l) => JSON.stringify(l.map((x) => x.id).sort());
    assert(lists.every((l) => key(l) === key(lists[0])), "player lists differ");
    assert(lists.every((l) => l.every((x) => x.relay === false)), "expected direct (non-relay) links on one machine");
    await closeAll();
  });

  await check("2. 1000 reliable messages per peer arrive exactly once and in order (latency 30 ms, jitter 30 ms)", async () => {
    const { all } = await group(3, { simulate: { latencyMs: 30, jitterMs: 30 } });
    for (const p of all) {
      await p.evaluate(() => {
        window.got = {};
        window.room.on("seq", (n, meta) => (window.got[meta.from] ??= []).push(n));
      });
    }
    await Promise.all(all.map((p) => p.evaluate(() => { for (let i = 0; i < 1000; i++) window.room.send("seq", i); })));
    const counts = () => Promise.all(all.map((p) => p.evaluate(() => Object.values(window.got).map((l) => l.length))));
    await until(async () => (await counts()).every((c) => c.length === 3 && c.every((n) => n >= 1000)), 30000, "1000 messages from each peer").catch(
      async (e) => {
        throw new Error(`${e.message}; per-page counts ${JSON.stringify(await counts())}`);
      },
    );
    await sleep(300);
    for (const p of all) {
      const ok = await p.evaluate(() => Object.values(window.got).every((l) => l.length === 1000 && l.every((n, i) => n === i)));
      assert(ok, "a page saw duplicates, gaps or reordering");
    }
    await closeAll();
  });

  await check("3. unreliable messages under 30% simulated loss arrive partially and never throw", async () => {
    const { host, guests } = await group(1, { simulate: { lossPct: 30, latencyMs: 10, jitterMs: 20 } });
    await guests[0].evaluate(() => {
      window.u = [];
      window.room.on("pos", (n, meta) => window.u.push([n, meta.reliable]));
    });
    await host.evaluate(async () => {
      for (let i = 0; i < 400; i++) {
        window.room.send("pos", i, { reliable: false });
        if (i % 20 === 0) await new Promise((r) => setTimeout(r, 5));
      }
    });
    await sleep(500);
    const [n, allUnreliable, unique] = await guests[0].evaluate(() => [window.u.length, window.u.every((x) => x[1] === false), new Set(window.u.map((x) => x[0])).size === window.u.length]);
    assert(n > 150 && n < 400, `expected some loss, got ${n}/400`);
    assert(allUnreliable && unique, "unreliable messages were duplicated or mislabelled");
    await closeAll();
  });

  await check("4. request/handle returns the handler's value; no handler times out with code 'timeout'", async () => {
    const { host, guests } = await group(1);
    await host.evaluate(() => window.room.handle("pickup", (d, meta) => ({ ok: d.itemId === "fuse", by: meta.from })));
    const res = await guests[0].evaluate(async () => {
      const a = await window.room.request("host", "pickup", { itemId: "fuse" }, { timeoutMs: 3000 });
      const b = await window.room.request("host", "nothing", {}, { timeoutMs: 300 }).catch((e) => e.code);
      return { a, b, self: window.room.selfId };
    });
    assert(res.a.ok === true && res.a.by === res.self, "handler result did not come back");
    assert(res.b === "timeout", `expected timeout, got ${res.b}`);
    await closeAll();
  });

  await check("5. joins are refused: room-full, room-locked, started+lockOnStart, version-mismatch", async () => {
    const { game, code, host } = await group(1, {}, { maxPlayers: 2, lockOnStart: true });
    const third = await newPage(game, "Third");
    let r = await join(third, code);
    assert(r.code === "room-full", `expected room-full, got ${r.code}`);
    const g2 = await group(0, {}, { lockOnStart: true });
    await g2.host.evaluate(() => window.room.lock());
    const a = await newPage(g2.game, "A");
    r = await join(a, g2.code);
    assert(r.code === "room-locked", `expected room-locked, got ${r.code}`);
    await g2.host.evaluate(() => { window.room.unlock(); window.room.start({ seed: 1 }); });
    r = await join(a, g2.code);
    assert(r.code === "room-locked", `expected room-locked after start, got ${r.code}`);
    const old = await newPage(g2.game, "Old", { gameVersion: "0" });
    await g2.host.evaluate(() => window.room.unlock());
    r = await join(old, g2.code);
    assert(r.code === "version-mismatch", `expected version-mismatch, got ${r.code}`);
    void host;
    await closeAll();
  });

  await check("6. kick works, and the host leaving gives everyone host-left then closed", async () => {
    const { host, guests } = await group(3);
    const victim = await guests[0].evaluate(() => window.room.selfId);
    await host.evaluate((id) => window.room.kick(id, "test"), victim);
    await until(() => guests[0].evaluate(() => window.events.some((e) => e[0] === "closed")), 5000, "victim closed");
    const v = await guests[0].evaluate(() => window.events.filter((e) => ["kicked", "closed"].includes(e[0])).map((e) => [e[0], e[1].reason]));
    assert(JSON.stringify(v) === JSON.stringify([["kicked", "test"], ["closed", "kicked"]]), `victim saw ${JSON.stringify(v)}`);
    await until(() => guests[1].evaluate(() => window.events.some((e) => e[0] === "player-leave" && e[1].reason === "kicked")), 5000, "kick seen by others");
    await host.evaluate(() => window.room.leave());
    for (const g of guests.slice(1)) {
      await until(() => g.evaluate(() => window.events.some((e) => e[0] === "closed")), 5000, "guest closed");
      const seq = await g.evaluate(() => window.events.filter((e) => ["host-left", "closed"].includes(e[0])).map((e) => e[0] + (e[1]?.reason ? ":" + e[1].reason : "")));
      assert(JSON.stringify(seq) === JSON.stringify(["host-left", "closed:host-left"]), `guest saw ${JSON.stringify(seq)}`);
    }
    await closeAll();
  });

  await check("7. an ICE restart mid-game keeps the room connected and messages flowing", async () => {
    const { host, guests } = await group(2);
    const hostId = await host.evaluate(() => window.room.selfId);
    await guests[0].evaluate((h) => window.room.links.get(h).pc.restartIce(), hostId);
    await sleep(1500);
    await host.evaluate(() => {
      window.after = [];
      window.room.on("after", (d) => window.after.push(d));
    });
    await guests[0].evaluate(() => window.room.send("after", "still here", { to: "host" }));
    await until(() => host.evaluate(() => window.after.length === 1), 5000, "message after restart");
    const states = await players(host);
    assert(states.every((s) => s.state === "connected"), `states after restart: ${JSON.stringify(states)}`);
    const leaves = await host.evaluate(() => window.events.filter((e) => e[0] === "player-leave").length);
    assert(leaves === 0, "a restart caused a player-leave");
    await closeAll();
  });

  await check("8. room.now() agrees within ±20 ms on every peer and start.startAt is shared", async () => {
    const { host, all } = await group(3, { simulate: { latencyMs: 25, jitterMs: 10 } });
    await sleep(2500);
    // Every page shares the machine's wall clock, so (room.now() - Date.now())
    // is each peer's estimate of the same quantity.
    const offsets = await Promise.all(all.map((p) => p.evaluate(() => window.room.now() - Date.now())));
    const spread = Math.max(...offsets) - Math.min(...offsets);
    assert(spread <= 20, `room.now() spread ${spread.toFixed(1)} ms across peers`);
    await host.evaluate(() => window.room.start({ seed: 42 }));
    const starts = await Promise.all(
      all.map((p) =>
        until(() => p.evaluate(() => {
          const e = window.events.find((x) => x[0] === "start");
          return e ? { startAt: e[1].startAt, seed: e[1].payload.seed } : null;
        }), 5000, "start"),
      ),
    );
    assert(new Set(starts.map((s) => s.startAt)).size === 1 && starts.every((s) => s.seed === 42), `starts differ: ${JSON.stringify(starts)}`);
    console.log(`      clock spread ${spread.toFixed(1)} ms`);
    await closeAll();
  });

  if (kind !== "firefox") await check("9. voice: every peer receives every other peer's stream, and mute stops the audio", async () => {
    const { all } = await group(2);
    for (const p of all) {
      await p.evaluate(async () => {
        window.streams = {};
        window.room.voice.on("stream", ({ peerId, stream }) => (window.streams[peerId] = stream.getAudioTracks().length));
        await window.room.voice.start();
      });
    }
    await until(async () => (await Promise.all(all.map((p) => p.evaluate(() => Object.keys(window.streams).length)))).every((n) => n === 2), 10000, "2 streams per peer");
    // A listens to the LAST page that started voice: WebKit lets only one page
    // in a browser capture at a time and mutes the others' mics (real players
    // are on separate devices, so this never matters outside a test).
    const [a, b] = [all[0], all[all.length - 1]];
    const bId = await b.evaluate(() => window.room.selfId);
    // Listen the way a game would: B's raw stream -> Web Audio. This also
    // exercises the SDK's Chrome quirk handling (the muted <audio> element).
    await a.evaluate(async (id) => {
      window.streamOf = {};
      window.room.voice.on("stream", ({ peerId, stream }) => (window.streamOf[peerId] = stream));
      await new Promise((r) => setTimeout(r, 50));
      const ctx = new AudioContext();
      await ctx.resume();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      ctx.createMediaStreamSource(window.streamOf[id]).connect(an);
      const buf = new Float32Array(an.fftSize);
      window.peak = 0;
      setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        window.peak = Math.max(window.peak, Math.sqrt(sum / buf.length));
      }, 20);
    }, bId);
    const peakOver = async (ms) => {
      await a.evaluate(() => (window.peak = 0));
      await sleep(ms);
      return a.evaluate(() => window.peak);
    };
    const loud = await peakOver(2500);
    await b.evaluate(() => window.room.voice.setMuted(true));
    await sleep(500);
    const quiet = await peakOver(2500);
    const packets = await a.evaluate(async (id) => {
      const r = await window.room.links.get(id).pc.getStats();
      let n = 0;
      r.forEach((s) => {
        if (s.type === "inbound-rtp" && s.kind === "audio") n = s.packetsReceived;
      });
      return n;
    }, bId);
    console.log(`      peak RMS heard by A from B: unmuted ${loud.toFixed(4)}, muted ${quiet.toFixed(4)}; ${packets} RTP packets`);
    assert(loud > 0.001, "no audio heard while unmuted");
    assert(quiet < loud * 0.05, "audio kept flowing after mute");
    await closeAll();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
