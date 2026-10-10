# HallPass Scoreboard SDK

A tiny, dependency-free leaderboard client for browser games. Drop in two
`<script>` tags and call `HallPass.submitScore(finalScore)` when the game ends.
Achievements ride along on the same bundle: `HallPass.unlock("first-blood")`, and
one `"achievement"` event to hang a toast on.

**Golden rule:** every method always resolves and never throws. In a sandboxed
preview with no network or storage the SDK goes _inert_ and quietly no-ops
(`getScores → []`, `submitScore → { ok: false, reason: "inert" }`) so it can
never break the game it is embedded in.

The runtime is served from a version-stable URL:
`https://hallpass.gg/sdk/v1/hallpass.js`.

## Install

Paste this once near the end of `<body>`. The first inline block is a small inline
stub that captures early calls (including `on`/`off` listeners); the second loads
the real SDK. Replace `YOUR-SLUG` with the board slug you were given.

```html
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
<script src="https://hallpass.gg/sdk/v1/hallpass.js" data-game="YOUR-SLUG" defer></script>
```

The stub means calls made before the real script finishes loading are queued and
replayed; if the network never delivers the SDK, the stub settles those calls
safely after 2 seconds.

## Configure

Configuration is resolved in this precedence order:

| What   | 1. `window.HALLPASS_CONFIG` | 2. `<script>` attribute | 3. Fallback                          |
| ------ | --------------------------- | ----------------------- | ------------------------------------ |
| `game` | `.game`                     | `data-game`             | `null`                               |
| `api`  | `.api`                      | `data-api`              | script origin, else page origin      |

To set the slug from JavaScript instead of `data-game`:

```html
<script>window.HALLPASS_CONFIG = { game: "snake" };</script>
```

## Use

### Submit a score on game over

```js
// Fire-and-forget is fine — it never throws.
HallPass.submitScore(finalScore);

// Or inspect the result:
const res = await HallPass.submitScore(finalScore);
if (res.ok) {
  console.log("You ranked #" + res.rank);
} else {
  console.log("Not submitted:", res.reason); // e.g. "rate-limited", "inert"
}
```

The first submission with no stored name prompts the player once for a handle and
remembers it (`localStorage`). Skip the prompt with
`HallPass.submitScore(score, { promptHandle: false })`, or pass an explicit name
with `{ handle: "ZK" }`.

### Render a leaderboard

```js
async function renderLeaderboard() {
  const scores = await HallPass.getScores({ limit: 10, period: "all" });
  const el = document.querySelector("#leaderboard");
  el.innerHTML = scores
    .map((s) => `<li>#${s.rank} ${s.handle} — ${s.score}</li>`)
    .join("");
}
renderLeaderboard();
```

### Sign in (optional, same-origin)

Players can stay anonymous (the handle prompt above) or sign in with Google so
their scores carry a verified identity (display name + avatar). Sign-in is
same-origin only — it works on game pages served from the HallPass catalog.

`signIn()` opens a small same-origin popup for Google sign-in; the game keeps
running — it is **never reloaded**. Because it opens a popup, `signIn()` must be
called from a real click handler (browsers block popups opened outside a user
gesture); if the popup is blocked the SDK falls back to a top-level redirect.
`signOut()` behaves the same way. Both are no-ops in an inert preview.

```js
const player = await HallPass.getPlayer(); // { id, name, image, handle } | null
if (player) {
  console.log("Signed in as", player.handle);
  // Let the player rename themselves on the leaderboard:
  await HallPass.setPlayerHandle("ZK");
} else {
  // Anonymous — offer a sign-in button. Must be a user-gesture click handler:
  signInButton.onclick = () => HallPass.signIn();
}
```

`getPlayer()` returns `null` for anonymous or cross-origin embeds (no session
cookie) — never an error. EMAIL is never exposed.

The game is not reloaded, so listen for the `"auth"` event to live-update your UI
the moment sign-in (or sign-out) completes in the popup:

```js
HallPass.on("auth", ({ player }) => {
  if (player) {
    signInLabel.textContent = "Signed in as " + player.handle;
  } else {
    signInLabel.textContent = "Sign in";
  }
});
```

The `"auth"` event is **sticky**: a listener added after sign-in already happened
still fires once with the current identity, so you never miss it.

Any guest scores submitted **during this same page visit** are automatically
attached to the account right after sign-in — no extra call needed. This is
this-session only by design: the tokens live in memory and die with the page (on
a shared computer the next player can never absorb a previous player's scores).

### Achievements (optional, same-origin)

Achievements are provisioned by an admin, one catalogue per game, and addressed
by `key`. Show a toast with three lines:

```js
HallPass.on("achievement", (a) => showToast(a.name, a.icon));

// somewhere in the game:
HallPass.unlock("first-blood");
```

The `"achievement"` event fires **only when something is newly earned**, never
for an achievement the player already holds — so you can call `unlock()` as often
as you like and the player is congratulated exactly once. `name` and `icon` are
always filled in, so a toast can render straight from the payload.

```js
// One achievement. Idempotent: calling it twice is not an error.
const r = await HallPass.unlock("first-blood");
// { ok: true, key: "first-blood", unlocked: true, alreadyUnlocked: false,
//   progress: 1, target: 1, achievement: { name, icon, points, ... } }

// Several at once — ONE request.
await HallPass.unlockMany(["level-1", "no-damage", "speedrun"]);

// A counter. The value is ABSOLUTE ("now at 57"), never a delta ("+3").
HallPass.progress("zombies-slain", killCount);

// The player's shelf, for a UI:
const list = await HallPass.getAchievements();
// [{ key, name, description, icon, points, target, secret,
//    progress, unlocked, unlockedAt }, ...]
```

`progress()` is **safe to call every frame.** Calls are coalesced per key on a ~1s
trailing edge, so a 60fps loop sends about one request per second, and whatever is
pending is flushed with a beacon when the page is hidden or closed — the final
value is never lost. If you want a value sent right now (at game over, say), pass
`{ flush: true }`.

Achievements need a signed-in player and a same-origin embed, because they attach
to an account. In a cross-origin embed or a sandboxed preview every call resolves
`{ ok: false, reason: "signed-out" | "inert" }` and no request is made — nothing
throws, and the game plays on regardless.

> **Games embedded before v1.2.0** carry an older inline stub that does not know
> these methods. They still work — just call them **after `ready()` resolves**
> (`await HallPass.ready()`), by which point the real SDK has replaced the stub.
> Re-paste the snippet above to get early-call queueing for them too.

### Mark moments for beta testers (optional)

```js
HallPass.moment && HallPass.moment("boss-phase-2", { level: 4, hp: 31 });
HallPass.moment && HallPass.moment("died", { cause: "spikes" }, { shot: false });
```

`moment()` flags an instant worth looking at. In a HallPass **beta test session**
the tester's device takes a picture of the game at that instant (and logs it to
their recording's events file), which they can pin to a bug report or send as a
screenshot. `{ shot: false }` logs the event with no picture. Anywhere else —
every public player — it does nothing: no request, no storage. So leave the calls
in.

Names are lowercased `[a-z0-9._-]`, up to 40 characters. `data` is a plain object
of about 2 KB of JSON, kept with the picture. Repeats of one name are throttled by
the session, so calling it from a loop is fine. It resolves `{ ok: true, name }`
or `{ ok: false, reason: "bad-name" | "bad-data" | "inert" }`.

> The `HallPass.moment &&` guard matters for a game that pasted the snippet before
> v1.3.0: its stub has no `moment`, and calling a missing method would throw.
> Re-paste the snippet above to drop the guard.

### React to events

```js
HallPass
  .on("submitted", (r) => console.log("rank", r.rank))
  .on("auth", ({ player }) => console.log("signed in?", !!player))
  .on("achievement", (a) => showToast(a.name, a.icon))
  .on("error", (r) => console.warn("submit failed", r.reason));
```

## API

| Member                          | Returns                  | Notes                                                                 |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `version`                       | `string`                 | SDK major, `"1"` (matches the `/sdk/v1/` URL).                        |
| `mode`                          | `"loading"\|"live"\|"inert"` | Runtime state.                                                     |
| `ready(opts?)`                  | `Promise<ReadyState>`    | `opts` may set `{ game, api }` at runtime. Always resolves.            |
| `submitScore(score, opts?)`     | `Promise<SubmitResult>`  | `opts`: `{ handle?, promptHandle? }`. Resolves `{ ok, rank?, reason? }`. |
| `getScores(opts?)`              | `Promise<ScoreEntry[]>`  | `opts`: `{ limit?(1–100), period?("all"\|"day"\|"week"), game? }`. `[]` on failure. |
| `getHandle()`                   | `string \| null`         | The stored player handle.                                             |
| `setHandle(handle)`             | `string`                 | Sanitises to `[A-Za-z0-9 _-]{1,12}` and persists; returns the result. |
| `getPlayer()`                   | `Promise<PlayerIdentity \| null>` | Signed-in player's PUBLIC identity (`{ id, name, image, handle }`), else `null`. Same-origin, credentialed. Cached in memory. EMAIL is never exposed. |
| `signIn(opts?)`                 | `void`                   | Opens a small same-origin popup for `/play/signin`; the game is **never reloaded**. Must be called from a click handler; a blocked popup falls back to a top-level redirect. `opts.redirectTo` → `callbackUrl`. No-op when inert. |
| `signOut(opts?)`                | `void`                   | Opens a same-origin popup for `/play/signout`; the game is **never reloaded**. Same click-handler / fallback rules as `signIn`. No-op when inert. |
| `setPlayerHandle(handle)`       | `Promise<PlayerIdentity \| null>` | Persist the signed-in player's chosen handle; resolves the updated identity, else `null`. |
| `unlock(key, opts?)`            | `Promise<UnlockResult>`  | Earn one achievement outright. Idempotent — an already-held one resolves `{ ok: true, unlocked: false, alreadyUnlocked: true }`. `opts`: `{ game? }`. |
| `unlockMany(keys, opts?)`       | `Promise<UnlockResult[]>` | Earn several in ONE request; results come back in the order the keys were given. |
| `progress(key, value, opts?)`   | `Promise<UnlockResult>`  | Report ABSOLUTE progress. Coalesced per key (~1s) and flushed on page hide. `opts`: `{ game?, flush? }`. |
| `getAchievements(opts?)`        | `Promise<PlayerAchievement[]>` | This player's view of the game's achievements. `[]` on any failure. `opts`: `{ game? }`. |
| `moment(name, data?, opts?)`    | `Promise<MomentResult>`  | Mark a moment for beta testers; a no-op for everyone else. `opts`: `{ shot? }` (`false` = event only). |
| `on(event, cb)` / `off(...)`    | `HallPass`               | Events: `ready`, `scores`, `submitted`, `error`, `auth`, `achievement`. `auth` fires `{ player }` when sign-in/out completes (sticky). `achievement` fires the earned achievement — only on a NEW unlock, never sticky. Chainable. |

### `submitScore` reasons

`no-game` · `bad-score` · `inert` · `network` · `rate-limited` · `http`.

### `unlock` / `unlockMany` / `progress` reasons

`no-game` · `bad-request` · `signed-out` · `unknown-achievement` · `inert` ·
`network` · `rate-limited` · `http`.

`signed-out` covers every cross-origin embed (there is no session cookie to write
against); `unknown-achievement` means that key is not provisioned for this game.

The window global is installed as both `window.HallPass` and the alias
`window.HP`.

## P2P co-op (`hallpass-p2p.js`)

A separate, dependency-free **ES module** that lets a HallPass game run 1–8
player online play with no server of its own: players connect directly to each
other over WebRTC, and HallPass only helps them find each other.

| | |
| --- | --- |
| Version | **1.0.0** (`HallPassP2P.version`) |
| Hosted at | `https://hallpass.gg/sdk/p2p/v1/hallpass-p2p.js`, `hallpass-p2p.min.js` (49 KB, 17 KB gzipped), `hallpass-p2p.d.ts` |
| Source | `sdk/p2p/src/` (build: `npm run build:sdk:p2p`) |
| Demo / manual test page | `/sdk/p2p/demo/index.html` (coloured dots + chat) |
| Design | `docs/p2p-design.md` |

Unlike the scoreboard SDK above, this one **does reject**: failures are
`P2PError`s with a stable `code`, and their `message` is written for players, so
`showError(err.message)` is a complete error UI.

### Install

Copy `hallpass-p2p.js` (or the `.min.js`) and `hallpass-p2p.d.ts` into your game
and import it with a relative path. No build step.

```js
import { HallPassP2P } from './lib/hallpass-p2p.js';
```

### Quickstart

```js
const client = await HallPassP2P.connect({
  gameId: 'last-bell',      // your HallPass game slug
  gameVersion: '1.2.0',     // a joiner on another version gets 'version-mismatch'
  name: 'Guest 4821',       // used when the player is not signed in to HallPass
});

// Host
const room = await client.createRoom({ maxPlayers: 4, meta: { difficulty: 'normal' }, lockOnStart: true });
showCode(room.code);        // e.g. 'K7QX' — friends type this in

// Everyone else
try {
  const room = await client.joinRoom(codeInput.value);
} catch (err) {
  showError(err.message);   // err.code: room-not-found | room-full | room-locked | version-mismatch | connect-failed | timeout
}

room.on('player-join', (p) => addToLobby(p));
room.on('player-leave', ({ id, reason }) => removeFromLobby(id, reason));
room.setReady(true);

// Host starts; everybody gets the same seed and begins on the same frame.
room.on('start', ({ payload, startAt }) => {
  const wait = startAt - room.now();          // room.now() is the shared (host) clock
  setTimeout(() => beginRun(payload.seed), Math.max(0, wait));
});
if (room.isHost) room.start({ seed: 123456 });

// Positions: unreliable, ~15–20 Hz. Events: reliable (the default).
setInterval(() => room.send('pos', [x, y, z, yaw], { reliable: false }), 50);
room.on('pos', (p, meta) => moveGhost(meta.from, p));

// Ask the host to validate an action.
room.handle('pickup', (data, meta) => ({ ok: tryPickup(meta.from, data.itemId) }));   // host
const res = await room.request('host', 'pickup', { itemId: 'fuse' }, { timeoutMs: 3000 }); // anyone
```

### Running it locally

`transport: 'auto'` (the default) uses the **local** transport on `localhost`,
`127.0.0.1` and `[::1]`: tabs of one browser profile find each other over
`BroadcastChannel` and connect with real WebRTC — no HallPass server, no
internet. Open your game in two or more tabs.

```js
HallPassP2P.connect({ gameId: 'last-bell', transport: 'local', simulate: { latencyMs: 80, jitterMs: 30, lossPct: 5 } });
```

`simulate` (local only) adds one-way latency and jitter to both channels (reliable
messages stay in order) and drops `lossPct` % of unreliable messages.

The HallPass endpoints are same-origin only, so the `hallpass` transport works
for games served by HallPass. To try it locally, run `npm run dev` with
migration 040 applied to your database and open
`/sdk/p2p/demo/index.html?transport=hallpass` in two tabs.

**Safari:** Safari and WebKit hide a page's local ICE candidates until the page
has camera or microphone permission, so two Safari tabs on one machine cannot
connect over the local transport. Grant the microphone (start voice) first, or
turn on Develop → WebRTC → Disable ICE Candidate Restrictions. Players on
different machines are unaffected.

### API

```js
const client = await HallPassP2P.connect(options);
```

| Option | Default | |
| --- | --- | --- |
| `gameId` | — | Required. On HallPass, your game's slug (a staged game works only for players who can see it). |
| `gameVersion` | `''` | Joining a room whose host runs a different version fails with `version-mismatch`. |
| `name` | `'Player'` | Fallback display name. A signed-in HallPass player gets their public HallPass name instead (handle, else `@username`) — never their real name. |
| `transport` | `'auto'` | `'auto'` \| `'hallpass'` \| `'local'`. |
| `relayOnly` | `false` | Route everything through a TURN relay so other players never see your IP. Fails with `connect-failed`/`relay-unavailable` when HallPass has no TURN server. Ignored by `local`. |
| `simulate` | `null` | Local transport only: `{ latencyMs, jitterMs, lossPct }`. |
| `debug` | `false` | Log to the console. |
| `api` | page origin | *Extension.* HallPass origin for the `hallpass` transport. |
| `iceServers` | HallPass's | *Extension.* Replace the ICE servers (`local` uses none). |

`connect()` rejects only for `invalid-argument` (bad `gameId`) and `unsupported`
(no WebRTC). If HallPass cannot be reached it still resolves, with your fallback
name; creating or joining a room then fails with a clear `connect-failed`.

**Client:** `client.self` `{ id, name, avatarUrl }` (`id` is random per
`connect()`, never tied to an account; `avatarUrl` is currently always `null`) ·
`client.transport` · `client.createRoom({ maxPlayers = 4 (1–8), meta = {}, lockOnStart = false })` ·
`client.joinRoom(code, { timeoutMs = 20000 }?)` · `client.close()`. One room at a
time per client (`already-in-room`).

`joinRoom` resolves once you are connected to **every** player. Codes are
case-insensitive (`k7qx` works).

**Room state:** `code`, `selfId`, `hostId`, `isHost`, `meta`, `locked`,
`started`, `maxPlayers` (*extension*), and `players` — each
`{ id, name, avatarUrl, isHost, isSelf, ready, meta, hidden, connection: { state, rttMs, relay } }`.
`connection` is *your* link to that player: `state` is
`'connecting' | 'connected' | 'reconnecting'`, `rttMs` is `null` until measured.
`hidden` (*extension*) is true while their tab is in the background. These
getters return copies.

**Lobby:** `setReady(bool)` · `setPlayerMeta(obj)` (shallow merge; set a key to
`null` to remove it; ≤ 4 KB) · host only: `setRoomMeta(obj)` (≤ 8 KB), `lock()`,
`unlock()`, `kick(peerId, reason?)`, `start(payload?)`. Host-only methods called
by anyone else throw `not-host`. A kicked player cannot rejoin with the same
client. `start` sends everyone `{ payload, startAt }` where `startAt` is ~500 ms
ahead on the shared clock; with `lockOnStart` the room locks and players still
mid-join are turned away. A player who joins a started, unlocked room receives
the last `start` right after `joinRoom` resolves.

**Messages:** `room.send(name, data, { to = 'others', reliable = true })`.
`to`: `'others'` · `'all'` (you too, delivered asynchronously) · `'host'` · a peer
id · an array of ids. `data`: anything JSON-serialisable, or an `ArrayBuffer`,
typed array or `DataView` (sent as binary; it arrives as the same type).
`room.on(name, (data, meta) => …)` returns an unsubscribe function;
`meta = { from, sentAt, reliable }`, with `sentAt` on the shared clock.
`room.off(name, fn)` also works (*extension*).

- Reliable messages arrive exactly once and in order per sender. Unreliable ones
  may drop or arrive out of order and are never retried.
- Handlers always run asynchronously, in the order events arrived.
- Message names may not be room event names (`start`, `closed`, …): `send` throws
  `invalid-argument`.
- `'others'` means the players *you* currently know. A newcomer becomes reachable
  from your side when you get its `player-join` (one hop after its own
  `joinRoom` resolves).

**Request / response:** `room.handle(name, async (data, meta) => result)` (one
handler per name; returns an unregister function) and
`room.request(to, name, data, { timeoutMs = 5000 })` with `to` = `'host'` or a
peer id. Rejections: `timeout` (also when nobody handles the name),
`handler-error` (the handler threw; `message` is its message), `peer-left`,
`closed`.

**Shared clock:** `room.now()` — milliseconds on the host's clock (an epoch
timestamp), estimated from ping/pong using the lowest-RTT samples. Agrees within
a few ms on one machine; never runs backwards.

**Events:**

| Event | Payload | When |
| --- | --- | --- |
| `player-join` | player | Someone joined (and is connected to everyone). |
| `player-leave` | `{ id, reason }` | `left` (left or closed the page) · `kicked` · `disconnected` (connection closed without a goodbye) · `timeout` (unreachable for 10 s). |
| `player-update` | player | Ready, meta, name, or your connection state/relay to them changed. Not raised for RTT changes — poll `room.players` for those. |
| `room-update` | room | Meta, lock, started or capacity changed. |
| `start` | `{ payload, startAt }` | The host started. |
| `host-left` | — | The host left, closed their tab, or was unreachable for 10 s. Always followed by `closed`. |
| `kicked` | `{ reason }` | You were kicked. Followed by `closed`. |
| `closed` | `{ reason }` | The room is over for you: `left` · `kicked` · `host-left` · `timeout` · `error`. |
| `visibility` | `{ id, hidden }` | Another player's tab went to the background or came back. |
| `error` | `P2PError` | One of your handlers threw, or a host lost its server registration. |

**Voice** (off until you call it): `await room.voice.start({ echoCancellation, noiseSuppression, autoGainControl })`
asks for the microphone (`mic-denied` / `mic-unavailable`).
`room.voice.on('stream', ({ peerId, stream }) => …)` gives you each player's raw
`MediaStream` (a late subscriber is told about streams that already arrived);
`'stream-end'` when they stop. `setMuted(bool)`, `setPeerMuted(peerId, bool)`,
`stop()`, and *extensions* `active`, `muted`. You hear players who started voice
even if you have not (listen-only).

```js
const ctx = new AudioContext();               // resume() it from a click
room.voice.on('stream', ({ peerId, stream }) => {
  const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse' });
  ctx.createMediaStreamSource(stream).connect(panner).connect(ctx.destination);
  panners.set(peerId, panner);                 // move panner.positionX/Y/Z with that player
});
```

**Diagnostics:** `await room.stats()` → `{ [peerId]: { rttMs, lossPct, bytesIn, bytesOut, relay } }`
(`lossPct` = lost pings on the unreliable channel). `await HallPassP2P.selfTest()`
→ `{ stun, turn, natType, notes: string[] }` for a "Test connection" button; the
notes are sentences a player can read.

**Leaving:** `await room.leave()`, `await client.close()`. Closing the tab sends a
best-effort goodbye too.

### Error codes

`room-not-found`, `room-full`, `room-locked` (also: kicked from that room),
`version-mismatch`, `timeout` (the host never answered), `connect-failed` with
`err.reason`:

| `reason` | Meaning |
| --- | --- |
| `no-turn-restrictive-network` | Direct connection failed and HallPass has no relay server. |
| `turn-failed` | Could not connect even through the relay. |
| `relay-unavailable` | Relay-only was asked for (by you, the host, or HallPass) but there is no relay. |
| `peer-unreachable` | Reached the host but not every other player. |
| `signaling-unreachable` / `signaling-unavailable` | HallPass could not be reached / P2P is switched off or not deployed. |
| `rate-limited` | Too many attempts; wait a minute. |
| `unknown-game` | HallPass does not know `gameId` (or you may not see that staged game). |
| `room-closed` | The room closed while you were joining. |

Also: `closed`, `not-host`, `peer-left`, `handler-error`, `message-too-large`,
`send-buffer-full`, `invalid-argument`, `already-in-room`, `unsupported`,
`mic-denied`, `mic-unavailable`.

### Gotchas

- **IP addresses.** Peer-to-peer means each player's IP address is visible to the
  others in the room. `relayOnly: true` (or `P2P_FORCE_RELAY=1` on HallPass)
  routes everything through TURN so nobody sees anybody's IP; a host's
  `relayOnly` applies to everyone who joins its room. It needs a TURN server.
- **Background tabs.** Browsers throttle timers in background tabs (to once a
  second, and after a while once a minute in Chrome). A host that tabs away keeps
  answering messages but its game loop slows — listen for `visibility` and pause
  or hand off. A backgrounded host also notices join requests more slowly.
- **Chrome and Web Audio.** Chrome only plays a remote WebRTC stream through Web
  Audio if the stream is also attached to a media element. The SDK attaches each
  remote voice stream to a muted `<audio>` element for you; just use
  `createMediaStreamSource`.
- **Message size and rate.** Reliable messages up to 256 KB (split into 16 KB
  chunks under the hood); unreliable up to 16 KB, and keep them far smaller —
  positions are a few numbers. Send positions at ~15–20 Hz over the unreliable
  channel and smooth on the receiving side; send events and state changes
  reliably. Unreliable messages are dropped rather than queued when a link is
  backed up; reliable ones queue (16 MB cap, then `send-buffer-full`).
- **One mesh.** Every player connects to every other player (max 8). On strict
  networks without TURN some pairs may never connect: `joinRoom` then fails with
  `connect-failed` rather than leaving you half-connected.
- **Peers are untrusted.** Names, player meta, messages and request data all come
  from other players' browsers; validate them like any network input (the host's
  `handle` is the place to check an action is legal). Avatar URLs other than
  HallPass's own or Google's avatar host are replaced with `null`, so a modified
  client cannot make you load a tracking image.
- **Host leaves = room ends (v1).** No host migration yet.
- **Voice in one browser.** Safari lets only one tab use the microphone at a
  time; testing voice with several tabs of one Safari mutes all but the last.

### How it works (short)

HallPass runs serverless functions and Postgres, no WebSocket server, so
signaling is HTTP polling: `POST /api/v1/p2p/rooms` (open), `…/rooms/<code>/join`
(ask to join), `…/rooms/<code>/signal` (send and receive in one request), and
`GET /api/v1/p2p/config` (your public name, STUN, short-lived TURN credentials).
Only the joiner↔host handshake and reconnects use it; signals between two guests
are relayed by the host over its data channels, and game data never touches
HallPass. Presence is host-authoritative and lives on the data channels. See
`docs/p2p-design.md`.

### Tests

- `npx vitest run sdk/p2p app/lib/p2p app/api/v1/p2p` — unit and integration tests
  (room behaviour over the real local transport with an in-memory WebRTC; the
  hallpass transport against the real route handlers).
- `node sdk/p2p/e2e/run.mjs` — the brief's section 6 scenarios in headless
  Chromium or WebKit with real WebRTC (opt-in; see the file header for setup).
  `P2P_BASE_URL=http://localhost:3000` runs them against `npm run dev`.
- `P2P_DB_TEST=1 … app/lib/p2p/store.db.test.ts` — the signaling SQL against a
  real (non-production) database.

## License

MIT (see the published package).
