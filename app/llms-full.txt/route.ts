/**
 * `/llms-full.txt` — the complete machine-readable integration guide for the
 * HallPass Scoreboard SDK, written for an AI agent wiring a leaderboard into an
 * existing HTML game.
 *
 * Purpose: a single self-contained, plain-text spec covering the golden rules,
 * one-time board provisioning, the verbatim embed snippet, game-over usage, the
 * public HTTP API, the client (window.HallPass) API, the environment matrix,
 * failure detection, and the live list of registered game slugs.
 *
 * Load-bearing decisions:
 *  - The base URL is derived from the request so every example/curl resolves on
 *    localhost, previews, and production. The embed snippet itself is reproduced
 *    VERBATIM (it hard-codes hallpass.gg/sdk/v1/hallpass.js); a note explains how
 *    to repoint the src when self-hosting from another origin.
 *  - The registered-slug list is generated from `resolveGames()`, so it stays in
 *    sync as games are added AND reflects dashboard title overrides.
 *  - Route handlers are not cached by default; we set `Cache-Control` (5 minutes)
 *    explicitly. Reading `req.url` makes this request-time.
 */

import { resolveGames } from "@/app/lib/games-store";

export async function GET(req: Request) {
  const base = new URL(req.url).origin;

  const games = await resolveGames();
  const slugList = games
    .map((g) => `- ${g.slug} — ${g.title}`)
    .join("\n");
  const exampleSlug = games[0]?.slug ?? "your-game-slug";

  const body = `# HallPass Scoreboard — full integration guide for AI agents

You are integrating the HallPass leaderboard SDK into an existing HTML game.
HallPass is a drop-in, hosted scoreboard: one <script> tag plus one call at game
over. This document is the complete spec. The base URL for every example below
is this origin: ${base}

## 1. Golden rules
- The client NEVER throws and NEVER blocks the game. Every method returns a
  Promise that RESOLVES (it never rejects), and nothing blocks the game loop.
- There are two runtime modes — "live" and "inert" (plus a brief "loading"):
  - live  — network/storage is available; submitScore and getScores hit the API.
  - inert — network or storage is blocked (e.g. an in-chat AI Canvas sandbox
            preview where scripts and fetch are disabled). Every call resolves to
            a safe no-op: getScores -> [], submitScore -> { ok:false, reason:"inert" }.
- Same game, two lives: a game previewed inside a sandbox runs inert (the game
  itself is completely unaffected) and automatically goes live once it is hosted
  on a real origin and can load the SDK. You never change the game's code to
  switch modes — the SDK detects its environment.

## 2. One-time board provisioning
Each game needs a board created ONCE before scores can be submitted. This is the
only step that requires the admin secret.

Trust model:
- Submitting and reading scores are PUBLIC and unauthenticated.
- The admin password only PROVISIONS a board. It is never shipped in the game.
- The game ships only the public slug (data-game="<slug>"), never the secret.

The slug MUST be a game already registered on this site (see the list in
section 9). The admin endpoint returns 404 for an unknown slug — registering a
brand-new game on the site is a separate step from provisioning its board.

Ask the human operator for their admin password (the same password used for this
site's admin — env ADMIN_HTML_PASSWORD), then create the board:

  POST ${base}/api/v1/admin/boards
  Authorization: Bearer <ADMIN_PASSWORD>
  Content-Type: application/json

  {
    "slug": "<game-slug>",
    "title": "<Display Title>",
    "sort": "desc",         // optional; "desc" = high score wins (default), "asc" = low wins (time/golf)
    "scoreLabel": "Score",  // optional label shown next to the number
    "maxScore": null         // optional anti-cheat ceiling, or null for none
  }

This is idempotent: re-creating an existing board returns the existing board and
NEVER wipes its scores. Success body: { ok: true, created, board } — created is
true on first creation and false on every repeat.

Ready-to-run curl (for any agent or human that cannot POST from a chat):

  curl -X POST ${base}/api/v1/admin/boards \\
    -H "Authorization: Bearer $ADMIN_PASSWORD" \\
    -H "Content-Type: application/json" \\
    -d '{"slug":"${exampleSlug}","title":"Display Title","sort":"desc"}'

## 3. Integration snippet (paste verbatim, once, near </body>)

<!-- HallPass Scoreboard — paste once near </body> -->
<script>
(function(w){if(w.HallPass&&w.HallPass.version!=="0")return;var q=[];
function e(n){return function(){var a=[].slice.call(arguments);
return new Promise(function(r){q.push({n:n,a:a,r:r})})}}
w.HallPass=w.HP={version:"0",mode:"loading",_q:q,ready:e("ready"),
submitScore:e("submitScore"),getScores:e("getScores"),
getPlayer:e("getPlayer"),setPlayerHandle:e("setPlayerHandle"),
signIn:function(){},signOut:function(){},
getHandle:function(){return null},setHandle:function(v){return v},
on:function(){q.push({n:"on",a:[].slice.call(arguments),r:function(){}});return this},
off:function(){q.push({n:"off",a:[].slice.call(arguments),r:function(){}});return this}};
setTimeout(function(){if(w.HallPass.version!=="0")return;w.HallPass.mode="inert";
q.splice(0).forEach(function(c){c.r(c.n==="getScores"?[]:c.n==="getPlayer"||c.n==="setPlayerHandle"?null:{ok:false,reason:"inert"})})},2000)})(window);
</script>
<script src="https://hallpass.gg/sdk/v1/hallpass.js" data-game="YOUR-SLUG" defer></script>

Replace YOUR-SLUG with the board slug you provisioned in section 2. The first
<script> is a tiny SYNCHRONOUS stub: it installs window.HallPass immediately and
queues any early calls, so the game can call HallPass.* right away and can never
hit a "HallPass is undefined" error — even if the real SDK script is blocked or
slow to load. When the real SDK arrives it replaces the stub and drains the
queue. If the SDK never loads (e.g. a sandboxed preview), the stub flips mode to
"inert" after 2 seconds and resolves every queued call with a safe no-op. If you
serve the SDK from a host other than hallpass.gg, point the second <script> src
at ${base}/sdk/v1/hallpass.js.

## 4. Game-over usage
At game over, submit the final score:

  HallPass.submitScore(finalScore);

Note: anonymous players are NEVER prompted. The first submitScore with no stored
handle mints a stable "Guest#NNNN" name, persists it in localStorage, and reuses it
on every later session — no dialog ever appears. Call HallPass.setHandle("ZK")
earlier to choose a name, or pass an explicit one with
HallPass.submitScore(finalScore, { handle: "ZK" }).

Optionally render a top-10 leaderboard:

  HallPass.getScores({ limit: 10 }).then(function (scores) {
    scores.forEach(function (s) {
      // s.rank, s.handle, s.score
    });
  });

Both resolve in every environment. In inert mode submitScore resolves
{ ok:false, reason:"inert" } and getScores resolves []. You do not need a
try/catch — nothing here rejects.

Optional sign-in (same-origin only): a player can stay an anonymous Guest or sign
in with Google for a verified identity. HallPass.getPlayer() resolves the signed-in
player's public identity ({ id, name, image, handle }) or null. HallPass.signIn()
opens a small same-origin POPUP — the game is NEVER reloaded, so an in-progress
round survives — and must be called from a click handler (browsers block popups
without a user gesture); a blocked popup falls back to a top-level redirect.
HallPass.signOut() works the same way, and HallPass.setPlayerHandle("ZK") renames
the verified player. Because the game is not reloaded, listen for the "auth" event
to react when sign-in/out completes:

  HallPass.on("auth", function (e) {
    // e.player is null when signed out, otherwise { id, name, image, handle }
  });

Any guest scores submitted during the CURRENT page visit are automatically claimed
onto the account right after sign-in (the SDK holds short-lived claim tokens in
memory and POSTs them to /api/v1/me/claim). This is this-session only by design:
the tokens never persist, so on a shared computer the next player can never absorb
a previous player's scores.

## 5. Public HTTP API
GET ${base}/api/v1/leaderboard/<game>
  Query: limit (1-100, default 10), period (all | day | week, default all)
  200 -> { game, title, scoreLabel, sort, period,
           scores: [ { rank, handle, score } ] }

POST ${base}/api/v1/leaderboard/<game>
  Body: { score, handle? }
  200 -> { ok: true, rank, handle, score }

Error responses share a uniform body { error } with these status codes:
  404  unknown game (no such slug)
  409  board not initialized (provision it first — see section 2)
  400  invalid score, or missing/invalid JSON body
  429  rate-limited (also returns a Retry-After header)
  503  unavailable (backend storage is temporarily down)

## 6. Client API — window.HallPass (alias window.HP)
- version              SDK major version string, e.g. "1".
- mode                 "loading" | "live" | "inert".
- ready(opts?)         -> Promise<ReadyState { ready, game, handle, mode }>.
                         opts: { game?, api? } to set the slug / API base.
- submitScore(score, opts?)
                       -> Promise<SubmitResult { ok, rank?, error?, reason? }>.
                         opts: { handle?, promptHandle? }.
- getScores(opts?)     -> Promise<ScoreEntry[]>.
                         opts: { limit?, period?, game? }.
- getHandle()          -> string | null (the stored player handle).
- setHandle(handle)    -> string (the normalized handle that was stored).
- getPlayer()          -> Promise<PlayerIdentity | null>. The signed-in player's
                         PUBLIC identity ({ id, name, image, handle }) or null
                         (anonymous / cross-origin / inert). Same-origin,
                         credentialed. EMAIL is never exposed.
- signIn(opts?)        -> void. Opens a small same-origin POPUP for /play/signin;
                         the game is NEVER reloaded. Call from a click handler; a
                         blocked popup falls back to a top-level redirect. Guest
                         scores from this visit auto-attach to the account.
- signOut(opts?)       -> void. Opens a same-origin popup for /play/signout; same
                         no-reload / click-handler / fallback rules as signIn.
- setPlayerHandle(handle)
                       -> Promise<PlayerIdentity | null>. Rename the verified
                         player; resolves the updated identity, else null.
- on(event, cb)        -> HallPass (chainable).
- off(event, cb)       -> HallPass (chainable).
  Events: "ready" | "scores" | "submitted" | "error" | "auth".
  "auth" fires { player: PlayerIdentity | null } when sign-in/out completes (null
  on sign-out). It is sticky: a listener added afterward still gets the current
  identity.

## 7. Environment matrix
- Hosted on hallpass.gg (this site)   -> live  (same-origin fetch).
- Standalone host (your own domain)   -> live  (cross-origin; the API sends
                                          CORS-open headers so the fetch works).
- In-chat AI Canvas / sandbox preview -> inert (the SDK script and network are
                                          blocked) — but the game still runs, and
                                          it goes live the moment it is hosted.

## 8. Failure detection
- Check window.HallPass.mode === "inert" to know networking is unavailable.
- Inspect SubmitResult.reason to see why a submit did not land:
  "no-game" | "bad-score" | "inert" | "network" | "rate-limited" | "http".
- Everything resolves; nothing rejects. There is no error to catch — read the
  result object instead.

## 9. Currently registered game slugs
These ${games.length} slugs are live on this site. A board can be provisioned
only for a slug in this list; use one as data-game:
${slugList}
`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // ~5-min staleness for the machine manifest: this request-time route reads
      // req.url, so revalidatePath("/llms-full.txt") is a no-op here — freshness
      // is governed solely by this max-age, not by tag/path revalidation.
      "cache-control": "public, max-age=300",
    },
  });
}
