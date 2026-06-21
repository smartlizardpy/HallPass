const BASE = "https://hallpass.gg";

// Static text; safe to cache aggressively at the edge.
export const dynamic = "force-static";

const BODY = `# HallPass Arcade SDK — Full Integration Guide

> You are an AI coding agent integrating a browser game with the HallPass leaderboard. Read this whole page once; it is the complete, copy-paste-ready reference. Everything you need (SDK, postMessage protocol, raw HTTP API, board setup, a runnable example, limits) is below. The short index lives at ${BASE}/llms.txt.

---

## What this is / the golden rule

HallPass is an unblocked-games arcade. The HallPass SDK (\`${BASE}/sdk/v1/hallpass.js\`) adds a global high-score leaderboard to any browser game in one line. It works in two modes, auto-detected:

- **Embedded** — your game runs inside an \`<iframe>\` on HallPass. The SDK relays scores to the parent window via \`postMessage\`; the parent already knows your game's slug. You do NOT need to set the slug yourself.
- **Standalone** — your game runs anywhere else (your own site, itch.io, etc.). The SDK talks to the HallPass HTTP API. You MUST tell it your slug via \`data-game\`.

**GOLDEN RULE: the SDK never throws.** Every method degrades to a safe no-op if anything is misconfigured, the board does not exist, or the network is down. A dead leaderboard can NEVER break your game. Build accordingly: call \`submitScore\` and move on; do not gate gameplay on its result.

- ALWAYS load the SDK once, before your game code runs, so \`window.HallPass\` is defined.
- ALWAYS call \`HallPass.submitScore(finalScore)\` exactly once at game over, with the player's final numeric score.
- NEVER \`await\` the leaderboard in a way that blocks rendering or the next round — fire it and continue.
- NEVER assume the board exists; a submit to an un-initialized board returns \`{ok:false}\` and is silently ignored. That is fine.

---

## 30-second quickstart

### Embedded (your game is hosted on HallPass, in an iframe)

You don't know or set the slug — the parent does. Just load the SDK and submit:

\`\`\`html
<script src="${BASE}/sdk/v1/hallpass.js"></script>
<script>
  // ...your game...
  function onGameOver(finalScore) {
    HallPass.submitScore(finalScore); // parent relays it to the right board
  }
</script>
\`\`\`

If you serve the game from HallPass itself (same origin), you can use the relative path \`/sdk/v1/hallpass.js\`.

### Standalone (your game is hosted anywhere else)

You MUST set \`data-game\` to your slug (ask the HallPass owner which slug your game was registered under):

\`\`\`html
<script src="${BASE}/sdk/v1/hallpass.js" data-game="your-slug"></script>
<script>
  // ...your game...
  function onGameOver(finalScore) {
    HallPass.submitScore(finalScore);
  }
</script>
\`\`\`

That's the whole integration. \`submitScore\` prompts the player once for initials (persisted in \`localStorage\`), then records the score. Show the top scores anytime with \`HallPass.getScores()\` (see the example at the bottom).

---

## SDK API reference

Global: \`window.HallPass\` (also referenced as \`HallPass\`). Version: \`HallPass.version === "1"\`. Every method is safe to call before, during, or after \`ready()\`.

### Configuration

Resolution order (later overrides earlier):

1. \`window.HALLPASS_CONFIG = { game: "your-slug", api: "${BASE}" }\` — set this BEFORE the SDK script tag.
2. \`<script src="..." data-game="your-slug" data-api="${BASE}">\` — \`data-*\` attributes on the SDK script tag.
3. \`HallPass.ready({ game, api })\` — passed at runtime.

- \`game\` — your leaderboard slug. Required in standalone mode; ignored/overridden in embedded mode (the parent supplies it).
- \`api\` — API base URL. Defaults to \`${BASE}\`. Trailing slash is stripped automatically. You rarely need to set this.

### Embedded vs standalone detection

The SDK is **embedded** when it runs inside an iframe (\`window.parent !== window\`, including the cross-origin case where touching \`window.parent\` throws). Otherwise it is **standalone**. Introspect with \`HallPass._mode\` (\`"embedded"\` | \`"standalone"\`) and \`HallPass._config()\` (returns \`{ game, api, embedded }\`).

### Methods

- \`HallPass.ready(opts?) => Promise<{ game, handle }>\`
  Announces the game. Runs automatically on load, so you usually don't call it. \`opts\` may carry \`{ game, api }\`. In embedded mode it posts \`{type:'ready'}\` to the parent and the parent replies with the real game + handle (fires the \`ready\` event). In standalone mode it resolves/emits immediately.

- \`HallPass.submitScore(score, opts?) => Promise<{ ok, rank?, pending? }>\`
  Submits the player's final score. \`score\` is coerced with \`Number()\`; non-finite or negative values are rejected as a safe no-op (\`{ok:false}\`). \`opts.meta\` is an optional plain object attached to the submission (e.g. \`{ level: 7, durationMs: 90213 }\`). Standalone resolves \`{ok:true, rank}\` on success or \`{ok:false, error}\` on failure. Embedded resolves \`{ok:true, pending:true}\` optimistically (the real rank arrives via the \`submitted\` event). On the first submit, the SDK prompts once for initials and stores them.

- \`HallPass.getScores(opts?) => Promise<scores[]>\`
  Fetches the leaderboard. \`opts.limit\` (default 10, server-clamped) and \`opts.period\` (\`'all'\` | \`'day'\`; \`'day'\` currently falls back to \`'all'\`). Resolves an array of \`{ handle, score, rank }\`. Always resolves — never rejects; returns \`[]\` on any error or if no slug is configured.

- \`HallPass.getHandle() => string | null\`
  The player's stored handle (initials), or \`null\` if none set. Validated against \`[A-Za-z0-9 _-]{1,12}\`.

- \`HallPass.setHandle(value) => string\`
  Sanitizes and stores a handle; returns the cleaned value (\`"ANON"\` if invalid/empty). Persists in \`localStorage\` under \`hallpass:handle\`.

- \`HallPass.on(event, cb) => HallPass\` (chainable)
  Subscribe to events. A throwing listener can never break the SDK.

### Events

| Event | Payload | Fires when |
|---|---|---|
| \`ready\` | \`{ game, handle }\` | The SDK is ready (immediately when standalone; after the parent replies when embedded). |
| \`scores\` | \`{ game, scores }\` | A \`getScores()\` result arrives (also resolves the promise). |
| \`submitted\` | \`{ rank }\` | A score was accepted and ranked. |
| \`error\` | \`{ message }\` | A submit/fetch failed (network, board not initialized, rate limit, etc.). Informational only — your game keeps running. |

\`\`\`js
HallPass.on("submitted", ({ rank }) => console.log("You're #" + rank));
HallPass.on("scores", ({ scores }) => renderLeaderboard(scores));
HallPass.on("error", ({ message }) => console.warn("leaderboard:", message));
\`\`\`

---

## postMessage protocol

For games that cannot or do not want to load \`hallpass.js\` (custom engines, sandboxed builds), talk to the HallPass parent frame directly. This ONLY works in embedded mode (your game is in a HallPass iframe). **Every message — both directions — carries \`source: 'hallpass'\` as a discriminator; ignore any message without it.**

### Game → parent

| \`type\` | Extra fields | Meaning |
|---|---|---|
| \`ready\` | — | "I'm loaded." The parent replies with a \`ready\` message carrying the slug + handle. |
| \`score\` | \`score\` (number), \`meta?\` (object) | Submit a final score. |
| \`getScores\` | \`token?\` (string), \`limit?\` (number), \`period?\` (\`'all'\`\\|\`'day'\`) | Request the leaderboard. Echo a unique \`token\` to correlate the reply. |

### Parent → game

| \`type\` | Extra fields | Meaning |
|---|---|---|
| \`ready\` | \`game\` (slug), \`handle\` (string\\|null) | Handshake reply: here is your slug and the player's stored handle. |
| \`scores\` | \`game\`, \`token?\`, \`scores\` (\`[{handle,score,rank}]\`) | Leaderboard data; \`token\` echoes your request. |
| \`submitted\` | \`rank\` (number) | Your score was recorded at this rank. |
| \`error\` | \`message\` (string) | Something failed; keep playing. |

Minimal raw example (no SDK):

\`\`\`js
// Tell the host we're ready and learn our slug/handle.
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.source !== "hallpass") return;
  if (d.type === "ready")     { mySlug = d.game; myHandle = d.handle; }
  if (d.type === "submitted") { console.log("rank", d.rank); }
  if (d.type === "scores")    { renderLeaderboard(d.scores); }
});
window.parent.postMessage({ source: "hallpass", type: "ready" }, "*");

// On game over:
window.parent.postMessage({ source: "hallpass", type: "score", score: finalScore }, "*");

// To fetch scores:
window.parent.postMessage({ source: "hallpass", type: "getScores", token: "abc", limit: 10 }, "*");
\`\`\`

---

## HTTP API reference

Base in production: \`${BASE}\`. The leaderboard read/write endpoints send permissive CORS (\`Access-Control-Allow-Origin: *\`, methods \`GET, POST, OPTIONS\`), so a standalone game can call them from any origin. (POST has a soft same-origin Origin check — see below.) Replace \`{slug}\` with your game slug.

### GET /api/v1/leaderboard/{slug}

Query params: \`limit\` (default 10, clamped server-side), \`period\` (\`all\` | \`day\`; \`day\` currently falls back to \`all\`).

200 response:

\`\`\`json
{
  "game": "neon-snake",
  "scores": [
    { "handle": "AAA", "score": 4200, "rank": 1 },
    { "handle": "BOB", "score": 3100, "rank": 2 }
  ]
}
\`\`\`

Cached (\`Cache-Control: public, max-age=15, s-maxage=45\`). \`404 {error:"Unknown game"}\` for an unregistered slug.

\`\`\`bash
curl "${BASE}/api/v1/leaderboard/neon-snake?limit=10&period=all"
\`\`\`

### POST /api/v1/leaderboard/{slug}

Body: \`{ "score": <number>, "handle"?: <string>, "meta"?: <object> }\`. \`Content-Type: application/json\`.

200 success:

\`\`\`json
{ "ok": true, "rank": 3 }
\`\`\`

Error responses (all JSON \`{ "error": "..." }\` with these statuses):

| Status | Meaning |
|---|---|
| \`400\` | Invalid JSON body, or \`score\` is not a finite number in \`[0, 1e9]\`. |
| \`403\` | Cross-origin submission rejected (an \`Origin\` header present and not same-origin). Same-origin and server-to-server (no Origin) are allowed. |
| \`409\` | Board not initialized — the owner must run the init endpoint first. |
| \`429\` | Rate-limited (too many submissions from this client). |
| \`404\` | Unknown game slug. |
| \`502\` | Write to the backing store failed; retry. |

\`handle\` defaults to \`ANON\` and is sanitized to \`[A-Za-z0-9 _-]{1,12}\`.

\`\`\`bash
curl -X POST "${BASE}/api/v1/leaderboard/neon-snake" \\
  -H "Content-Type: application/json" \\
  -d '{"score":4200,"handle":"AAA","meta":{"level":7}}'
\`\`\`

### POST /api/v1/scoreboard/init  (board creation — owner only)

Creates the board ONCE for a slug. Requires the admin password. See the next section.

---

## Board initialization flow

A leaderboard board must be created exactly once, by the **site owner**, before any score can be recorded. Until then, \`POST /api/v1/leaderboard/{slug}\` returns \`409 Board not initialized\` and the SDK silently no-ops (your game still works).

- If you are an AI agent integrating a game: **ASK THE HALLPASS OWNER / CREATOR to initialize the board** for your slug, and to confirm the exact slug to use. You generally should NOT have the admin password.
- The owner authenticates with the admin password via ANY of: an \`X-Admin-Password: <pw>\` header (preferred for scripts/agents), an \`Authorization: Bearer <pw>\` header, or a logged-in admin session cookie.

\`\`\`bash
# Owner runs this once per game. NEVER commit or share the real password.
curl -X POST "${BASE}/api/v1/scoreboard/init" \\
  -H "Content-Type: application/json" \\
  -H "X-Admin-Password: YOUR_ADMIN_PASSWORD" \\
  -d '{"slug":"neon-snake"}'
\`\`\`

Responses:

- \`200 { "ok": true }\` — board created.
- \`200 { "ok": true, "alreadyInitialized": true }\` — board already existed (idempotent; existing scores are preserved).
- \`401\` — missing/invalid admin password.
- \`404\` — unknown game slug.
- \`503\` — server not configured (admin password and/or the backing store env var are unset).
- \`502\` — board creation failed downstream; retry.

---

## Complete, runnable vanilla-canvas example

A tiny "dodge the dots, score = seconds survived" game. It loads the SDK, submits on game over, and renders the top 10. Standalone version shown — for an embedded game on HallPass, drop the \`data-game\` attribute (and use \`/sdk/v1/hallpass.js\`).

\`\`\`html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Dot Dodge</title></head>
<body style="margin:0;background:#0b0b12;color:#fff;font-family:system-ui">
  <!-- 1) Load the SDK once, before your game code. -->
  <script src="${BASE}/sdk/v1/hallpass.js" data-game="your-slug"></script>

  <canvas id="c" width="480" height="480" style="display:block;margin:0 auto"></canvas>
  <ol id="board" style="max-width:480px;margin:12px auto;font:14px monospace"></ol>

  <script>
    var cv = document.getElementById("c"), ctx = cv.getContext("2d");
    var board = document.getElementById("board");
    var px = 240, py = 240, dots = [], t0 = Date.now(), alive = true;

    function spawn() { dots.push({ x: Math.random()*480, y: -10, v: 1 + Math.random()*2 }); }
    for (var i = 0; i < 6; i++) spawn();

    document.onmousemove = function (e) {
      var r = cv.getBoundingClientRect();
      px = e.clientX - r.left; py = e.clientY - r.top;
    };

    function gameOver() {
      if (!alive) return;
      alive = false;
      var score = Math.floor((Date.now() - t0) / 1000); // seconds survived

      // 2) Submit the final score. Fire-and-forget; never blocks the game.
      HallPass.submitScore(score, { meta: { dots: dots.length } })
        .then(function (r) { if (r.ok) console.log("rank", r.rank); });

      // 3) Refresh the on-screen leaderboard.
      showScores();
    }

    function showScores() {
      HallPass.getScores({ limit: 10 }).then(function (scores) {
        board.innerHTML = "";
        scores.forEach(function (s) {
          var li = document.createElement("li");
          li.textContent = "#" + s.rank + "  " + s.handle + "  " + s.score;
          board.appendChild(li);
        });
      });
    }

    function loop() {
      ctx.clearRect(0, 0, 480, 480);
      ctx.fillStyle = "#4f8";
      ctx.beginPath(); ctx.arc(px, py, 8, 0, 7); ctx.fill();
      ctx.fillStyle = "#f48";
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i]; d.y += d.v;
        if (d.y > 490) { d.y = -10; d.x = Math.random()*480; }
        ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, 7); ctx.fill();
        if (alive && Math.hypot(d.x - px, d.y - py) < 14) gameOver();
      }
      ctx.fillStyle = "#fff";
      ctx.fillText(alive ? Math.floor((Date.now()-t0)/1000) + "s" : "GAME OVER", 10, 20);
      requestAnimationFrame(loop);
    }

    showScores();   // show current leaderboard at start
    loop();
  </script>
</body>
</html>
\`\`\`

---

## Limits & fair play

- **Score range:** \`score\` must be a finite number in \`[0, 1e9]\` (MAX_SCORE). Out-of-range or non-numeric scores are rejected (400).
- **Handle charset:** \`[A-Za-z0-9 _-]\`, 1–12 chars. Invalid/empty handles become \`ANON\`.
- **Rate limiting:** best-effort per-IP token bucket (burst of ~10, refill ~1 / 5s). Non-durable in serverless, so it only blunts naive floods; expect occasional slip-through across instances. Over-limit submits get 429.
- **Origin check:** POST rejects (403) a present \`Origin\` header that isn't same-origin. Missing Origin (server-to-server) and same-origin are allowed. This is a weak, spoofable signal.
- **HONEST integrity note:** scores are **client-submitted**, so integrity here is "fun-grade", not "Olympic". The score cap, handle sanitization, rate limit, and soft Origin check stop casual nonsense — they do NOT stop a determined cheater crafting raw POSTs. A planned **v1.1** adds a short-lived, single-use HMAC-signed session token issued at game start and required on submit, which makes scripted/replayed submissions much harder and enables durable per-session limits. Until then: treat the board as fun, not authoritative.

---

## Versioning & stability guarantee

- The **v1** SDK (\`/sdk/v1/hallpass.js\`), HTTP API (\`/api/v1/...\`), and postMessage protocol are **stable**. New optional fields may be added, but existing fields, method signatures, message types, and the \`source:'hallpass'\` discriminator will not change under v1.
- Any **breaking** change ships under a new path (\`/sdk/v2/...\`, \`/api/v2/...\`). Pin to \`v1\` and you won't be surprised.
- Always integrate against the versioned URL (\`${BASE}/sdk/v1/hallpass.js\`), never an unversioned one.
`;

export async function GET() {
  return new Response(BODY, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
