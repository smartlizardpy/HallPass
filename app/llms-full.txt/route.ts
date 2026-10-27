/**
 * `/llms-full.txt` — the complete machine-readable integration guide for the
 * HallPass Scoreboard SDK, written for an AI agent wiring a leaderboard into an
 * existing HTML game.
 *
 * Purpose: a single self-contained, plain-text spec covering the golden rules,
 * one-time board provisioning, the verbatim embed snippet, game-over usage,
 * achievements, challenges/invites/moments, the P2P co-op SDK, the public HTTP API, the client (window.HallPass) API, the
 * environment matrix, failure detection, and the live list of registered game
 * slugs.
 *
 * Load-bearing decisions:
 *  - The base URL is derived from the request so every example/curl resolves on
 *    localhost, previews, and production. The embed snippet itself is reproduced
 *    VERBATIM (it hard-codes hallpass.games/sdk/v1/hallpass.js); a note explains how
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
unlock:e("unlock"),unlockMany:e("unlockMany"),progress:e("progress"),
getAchievements:e("getAchievements"),challenge:e("challenge"),moment:e("moment"),
invite:e("invite"),getLaunch:function(){return null},
signIn:function(){},signOut:function(){},
getHandle:function(){return null},setHandle:function(v){return v},
on:function(){q.push({n:"on",a:[].slice.call(arguments),r:function(){}});return this},
off:function(){q.push({n:"off",a:[].slice.call(arguments),r:function(){}});return this}};
setTimeout(function(){if(w.HallPass.version!=="0")return;w.HallPass.mode="inert";
q.splice(0).forEach(function(c){c.r(c.n==="getScores"||c.n==="getAchievements"||c.n==="unlockMany"?[]:c.n==="getPlayer"||c.n==="setPlayerHandle"?null:c.n==="challenge"?{ok:false,sent:false,reason:"inert"}:c.n==="invite"?{sent:0,link:null,cancelled:true}:{ok:false,reason:"inert"})})},2000)})(window);
</script>
<script src="https://hallpass.games/sdk/v1/hallpass.js" data-game="YOUR-SLUG" defer></script>

Replace YOUR-SLUG with the board slug you provisioned in section 2. The first
<script> is a tiny SYNCHRONOUS stub: it installs window.HallPass immediately and
queues any early calls, so the game can call HallPass.* right away and can never
hit a "HallPass is undefined" error — even if the real SDK script is blocked or
slow to load. When the real SDK arrives it replaces the stub and drains the
queue. If the SDK never loads (e.g. a sandboxed preview), the stub flips mode to
"inert" after 2 seconds and resolves every queued call with a safe no-op. If you
serve the SDK from a host other than hallpass.games, point the second <script> src
at ${base}/sdk/v1/hallpass.js.

## 4. Game-over usage
At game over, submit the final score:

  HallPass.submitScore(finalScore);

Note: anonymous players are NEVER prompted. The first submitScore with no stored
handle mints a stable name like "SkibidiToilet#4821", persists it in localStorage, and reuses it
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

## 4b. Achievements (optional, same-origin, signed-in players)
A game may also have ACHIEVEMENTS: a fixed catalogue provisioned by an admin, one
per game, each addressed by a short "key" (lowercase letters, digits, - and _).
A game cannot mint them; an unknown key is a harmless no-op with the reason
"unknown-achievement".

The whole integration is three lines — one listener and one call:

  HallPass.on("achievement", function (a) { showToast(a.name, a.icon); });
  HallPass.unlock("first-blood");

The "achievement" event fires ONLY when something is NEWLY earned, never for an
achievement the player already holds, so unlock() is safe to call repeatedly. Its
payload always has { key, name, description, icon, points, progress, target,
unlockedAt, game } with name and icon filled in, so a toast can render straight
from it.

  await HallPass.unlock("first-blood");                 // one; idempotent
  await HallPass.unlockMany(["level-1", "no-damage"]);  // several, ONE request
  HallPass.progress("zombies-slain", killCount);        // a counter
  const list = await HallPass.getAchievements();        // the player's shelf

progress() takes an ABSOLUTE value ("the player is now at 57"), never a delta
("add 3"). That is what makes it safe to retry: the server keeps the greater of
what it has and what you send, so a duplicated or out-of-order call can neither
double-count nor move a counter backwards. It is safe to call EVERY FRAME: the
SDK coalesces calls per key on a ~1s trailing edge and flushes whatever is pending
with a beacon when the page is hidden or closed, so the final value is never lost.
Pass { flush: true } to send one immediately (e.g. at game over).

Achievements attach to an account, so they need a signed-in player AND a
same-origin embed (the endpoint is cookie-credentialed). Cross-origin or inert,
every call resolves { ok:false, reason:"signed-out" } or { ok:false,
reason:"inert" } without firing a request — the game is unaffected either way.

Games embedded before SDK 1.2.0 carry an older inline stub that does not know
these methods; there, call them only AFTER ready() resolves (await
HallPass.ready()), or re-paste the snippet in section 3.

## 4c. Challenges, invites and moments (optional)
Challenge a friend (signed-in player, needs a score on the board):

  const r = await HallPass.challenge();   // opts: { game?, board? }
  if (r.sent) toast("Challenged " + r.challenge.to);

It opens a small HallPass-styled picker; the score to beat is the player's own
best, resolved by the server. READ result.sent, NOT result.ok: closing the picker
resolves { ok:true, sent:false, reason:"closed" }, which is not an error.
r.challenge is { to, targetScore, board, game }; the same payload fires the
"challenge" event. Reasons: "no-board" | "no-score" | "not-friends" | "self" |
"signed-out" | "bad-request" | "rate-limited" | "unavailable" | "closed" |
"popup-blocked" | "inert" | "network".

Invite friends into the current session (a co-op room, level or seed):

  const r = await HallPass.invite({ data: { room: "ABCD" }, expiresInMinutes: 30 });
  // r = { sent, link, cancelled }

data is the game's own plain JSON object, at most 1 KB, never interpreted by
HallPass; do not put anything private in it (anyone with the link can open it).
expiresInMinutes defaults to 30 (clamped 1-120). Offline, inert, bad data or a
blocked popup resolve { sent:0, link:null, cancelled:true }. Signed-out players
can still share a link. In the friend's copy of the game:

  await HallPass.ready();
  const launch = HallPass.getLaunch();   // SYNCHRONOUS
  // { kind:"invite", data, from, expiresAt } or null

getLaunch() returns the invite once per page load (a reload returns null) and
only works for games hosted on this site; a game on its own domain gets null.

Mark moments for beta testers:

  HallPass.moment && HallPass.moment("boss-phase-2", { level: 4 });
  HallPass.moment && HallPass.moment("died", { cause: "spikes" }, { shot: false });

In a HallPass beta test session the tester's device screenshots the game at that
instant ({ shot:false } logs the event with no picture); everywhere else it does
nothing (no request, no storage), so the calls can ship permanently. name is
lowercased [a-z0-9._-], up to 40 chars; data is a plain object of about 2 KB.
Resolves { ok:true, name } or { ok:false, reason:"bad-name"|"bad-data"|"inert" }.

Games pasted before SDK 1.3/1.4 have a stub without moment/invite/getLaunch;
guard with HallPass.method && ..., or re-paste the snippet in section 3.

## 4d. P2P co-op SDK (optional, separate from window.HallPass)
For 1-8 player online play with no server of your own. Players connect directly
over WebRTC; HallPass only helps them find each other (HTTP-polling signaling),
and game data never touches HallPass. It is a dependency-free ES module:

  ${base}/sdk/p2p/v1/hallpass-p2p.js        (also hallpass-p2p.min.js, hallpass-p2p.d.ts)

Copy the file(s) into the game and import with a relative path (no build step):

  import { HallPassP2P } from "./lib/hallpass-p2p.js";

Unlike window.HallPass, this SDK REJECTS: failures are P2PError objects with a
stable err.code, and err.message is written for players, so showError(err.message)
is a complete error UI.

  const client = await HallPassP2P.connect({
    gameId: "${exampleSlug}",   // your HallPass game slug
    gameVersion: "1.0.0",      // a joiner on another version gets "version-mismatch"
    name: "Guest 4821"         // fallback; a signed-in player's HallPass name wins
  });

  // Host
  const room = await client.createRoom({ maxPlayers: 4, meta: {}, lockOnStart: true });
  showCode(room.code);         // e.g. "K7QX"; codes are case-insensitive

  // Everyone else
  try { const room = await client.joinRoom(codeInput.value); }
  catch (err) { showError(err.message); }

  room.on("player-join", addToLobby);
  room.on("player-leave", function (e) { /* { id, reason } */ });
  room.setReady(true);
  room.on("start", function (e) {            // { payload, startAt }
    setTimeout(begin, Math.max(0, e.startAt - room.now()));   // shared host clock
  });
  if (room.isHost) room.start({ seed: 123456 });              // host only

  room.send("pos", [x, y], { reliable: false });     // unreliable, ~15-20 Hz
  room.send("event", data);                          // reliable (default), in order
  room.on("pos", function (data, meta) {});          // meta { from, sentAt, reliable }
  room.handle("pickup", async function (data, meta) { return { ok: true }; }); // host
  const res = await room.request("host", "pickup", { itemId: "fuse" }, { timeoutMs: 3000 });

Details:
- send(name, data, { to }) — to: "others" (default) | "all" | "host" | a peer id |
  an array of ids. data: JSON, or ArrayBuffer / typed array (sent as binary).
  Reliable <= 256 KB, unreliable <= 16 KB. Message names may not be room event
  names (start, closed, ...).
- Host-only (others get "not-host"): setRoomMeta, lock, unlock, kick(peerId), start.
  Anyone: setReady(bool), setPlayerMeta(obj), leave(). One room per client.
- Room state: code, selfId, hostId, isHost, meta, locked, started, players[]
  ({ id, name, avatarUrl, isHost, isSelf, ready, meta, hidden, connection }).
- Events: player-join, player-leave, player-update, room-update, start, host-left,
  kicked, closed, visibility, error. The host leaving ends the room (no migration).
- Voice (opt-in): await room.voice.start(); room.voice.on("stream", function (e)
  { /* e.peerId, e.stream */ }); setMuted, setPeerMuted, stop.
- Error codes: room-not-found, room-full, room-locked, version-mismatch, timeout,
  connect-failed (err.reason: no-turn-restrictive-network | turn-failed |
  relay-unavailable | peer-unreachable | signaling-unreachable |
  signaling-unavailable | rate-limited | unknown-game | room-closed), cancelled
  (the player declined the IP notice; return quietly), closed, not-host,
  peer-left, handler-error, message-too-large, send-buffer-full,
  invalid-argument, already-in-room, unsupported, mic-denied, mic-unavailable.
- Privacy: players in a room can see each other's IP address. The SDK shows a
  one-time notice before the first connection (ipNotice: "auto"); relayOnly: true
  routes through TURN so nobody sees anybody's IP.
- Locally (localhost) transport "auto" picks "local": tabs of one browser find
  each other over BroadcastChannel, no HallPass server needed. The "hallpass"
  transport (signaling) is same-origin only, i.e. for games served by HallPass.
- Peers are untrusted: validate names, meta, messages and request data; let the
  host's handle() decide whether an action is legal.

Invite friends into a room (pairs the two SDKs): the host opens a room and calls
HallPass.invite (section 4c) with the room code; the friend's game joins on load.

  // Host
  const room = await client.createRoom({ maxPlayers: 4 });
  await HallPass.invite({ data: { room: room.code } });

  // Friend, on load
  await HallPass.ready();
  const launch = HallPass.getLaunch();
  if (launch && typeof launch.data.room === "string") {
    await client.joinRoom(launch.data.room);   // straight into the lobby
  }

Signaling endpoints (used by the SDK itself; same-origin, you rarely call them):
  GET  ${base}/api/v1/p2p/config                 public name, STUN, short-lived TURN credentials
  POST ${base}/api/v1/p2p/rooms                  open a room
  POST ${base}/api/v1/p2p/rooms/<code>/join      ask to join
  POST ${base}/api/v1/p2p/rooms/<code>/signal    send and receive signals in one request

## 5. Public HTTP API
GET ${base}/api/v1/leaderboard/<game>
  Query: limit (1-100, default 10), period (all | day | week, default all)
  200 -> { game, title, scoreLabel, sort, period,
           scores: [ { rank, handle, score } ] }

POST ${base}/api/v1/leaderboard/<game>
  Body: { score, handle? }
  200 -> { ok: true, rank, handle, score }

GET ${base}/api/v1/games/<game>/achievements
  Same-origin + credentialed for the signed-in player's own progress.
  200 -> { game, achievements: [ { key, name, description, icon, points, target,
           secret, progress, unlocked, unlockedAt } ], earnedPoints, totalPoints }
  An unearned SECRET achievement arrives with its name and description redacted —
  the player is meant to see that something is left to find, not what it is.

POST ${base}/api/v1/games/<game>/achievements
  Same-origin + credentialed; requires a signed-in player.
  Body: { entries: [ { key, progress? } ] }   (max 20 entries per request)
        progress is ABSOLUTE; omit it (or send null) to mean "reach the target",
        i.e. earn the achievement outright.
  200 -> { ok, reason?, results: [ { key, unlocked, alreadyUnlocked, progress,
           target } ] }
        unlocked = NEWLY earned by THIS call (false for one already held) — it is
        the toast signal. An unknown key produces no result element and is NOT an
        error; ok:true with reason:"unknown-achievement" means nothing resolved.

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
- unlock(key, opts?)   -> Promise<UnlockResult { ok, key, unlocked,
                         alreadyUnlocked, progress, target, achievement?,
                         reason? }>. Earns one achievement outright. IDEMPOTENT:
                         one already held resolves ok:true with unlocked:false.
                         opts: { game? }.
- unlockMany(keys, opts?)
                       -> Promise<UnlockResult[]>, in the order the keys were
                         given; sent as ONE request.
- progress(key, value, opts?)
                       -> Promise<UnlockResult>. ABSOLUTE value, never a delta.
                         Safe to call every frame (coalesced ~1s per key, flushed
                         on page hide). opts: { game?, flush? }.
- getAchievements(opts?)
                       -> Promise<PlayerAchievement[]> ({ key, name, description,
                         icon, points, target, secret, progress, unlocked,
                         unlockedAt }). [] on any failure. opts: { game? }.
- challenge(opts?)     -> Promise<ChallengeResult { ok, sent?, challenge?, reason? }>.
                         Opens the friend picker; check sent, not ok. opts:
                         { game?, board? }. See section 4c.
- moment(name, data?, opts?)
                       -> Promise<{ ok:true, name } | { ok:false, reason }>. Beta
                         test sessions only; a no-op elsewhere. opts: { shot? }.
- invite(opts)         -> Promise<{ sent, link, cancelled }>. opts: { data,
                         expiresInMinutes? }. Never rejects.
- getLaunch()          -> { kind:"invite", data, from, expiresAt } | null.
                         SYNCHRONOUS; call after ready(). Hosted games only.
- on(event, cb)        -> HallPass (chainable).
- off(event, cb)       -> HallPass (chainable).
  Events: "ready" | "scores" | "submitted" | "error" | "auth" | "achievement" |
  "challenge".
  "auth" fires { player: PlayerIdentity | null } when sign-in/out completes (null
  on sign-out). It is sticky: a listener added afterward still gets the current
  identity.
  "achievement" fires the earned achievement itself ({ key, name, description,
  icon, points, progress, target, unlockedAt, game }) and ONLY when it is newly
  earned — never for one the player already holds. It is NOT sticky: an unlock is
  a moment, not a state, so a listener added later is not re-toasted.
  "challenge" fires { to, targetScore, board, game } when the player sends one.

## 7. Environment matrix
- Hosted on hallpass.games (this site)   -> live  (same-origin fetch).
- Standalone host (your own domain)   -> live  (cross-origin; the API sends
                                          CORS-open headers so the fetch works).
- In-chat AI Canvas / sandbox preview -> inert (the SDK script and network are
                                          blocked) — but the game still runs, and
                                          it goes live the moment it is hosted.

## 8. Failure detection
- Check window.HallPass.mode === "inert" to know networking is unavailable.
- Inspect SubmitResult.reason to see why a submit did not land:
  "no-game" | "bad-score" | "inert" | "network" | "rate-limited" | "http".
- Inspect UnlockResult.reason to see why an unlock/progress did not land:
  "no-game" | "bad-request" | "signed-out" | "unknown-achievement" | "inert" |
  "network" | "rate-limited" | "http". "signed-out" is what every CROSS-ORIGIN
  embed gets (there is no session cookie to attach an achievement to);
  "unknown-achievement" means that key is not provisioned for this game.
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
