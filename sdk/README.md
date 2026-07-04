# HallPass Scoreboard SDK

A tiny, dependency-free leaderboard client for browser games. Drop in two
`<script>` tags and call `HallPass.submitScore(finalScore)` when the game ends.

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
signIn:function(){},signOut:function(){},
getHandle:function(){return null},setHandle:function(v){return v},
on:function(){q.push({n:"on",a:[].slice.call(arguments),r:function(){}});return this},
off:function(){q.push({n:"off",a:[].slice.call(arguments),r:function(){}});return this}};
setTimeout(function(){if(w.HallPass.version!=="0")return;w.HallPass.mode="inert";
q.splice(0).forEach(function(c){c.r(c.n==="getScores"?[]:c.n==="getPlayer"||c.n==="setPlayerHandle"?null:{ok:false,reason:"inert"})})},2000)})(window);
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

### React to events

```js
HallPass
  .on("submitted", (r) => console.log("rank", r.rank))
  .on("auth", ({ player }) => console.log("signed in?", !!player))
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
| `on(event, cb)` / `off(...)`    | `HallPass`               | Events: `ready`, `scores`, `submitted`, `error`, `auth`. `auth` fires `{ player }` when sign-in/out completes (sticky). Chainable. |

### `submitScore` reasons

`no-game` · `bad-score` · `inert` · `network` · `rate-limited` · `http`.

The window global is installed as both `window.HallPass` and the alias
`window.HP`.

## License

MIT (see the published package).
