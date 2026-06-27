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
getHandle:function(){return null},setHandle:function(v){return v},
on:function(){q.push({n:"on",a:[].slice.call(arguments),r:function(){}});return this},
off:function(){q.push({n:"off",a:[].slice.call(arguments),r:function(){}});return this}};
setTimeout(function(){if(w.HallPass.version!=="0")return;w.HallPass.mode="inert";
q.splice(0).forEach(function(c){c.r(c.n==="getScores"?[]:{ok:false,reason:"inert"})})},2000)})(window);
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

### React to events

```js
HallPass
  .on("submitted", (r) => console.log("rank", r.rank))
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
| `on(event, cb)` / `off(...)`    | `HallPass`               | Events: `ready`, `scores`, `submitted`, `error`. Chainable.           |

### `submitScore` reasons

`no-game` · `bad-score` · `inert` · `network` · `rate-limited` · `http`.

The window global is installed as both `window.HallPass` and the alias
`window.HP`.

## License

MIT (see the published package).
