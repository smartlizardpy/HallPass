# Halloween in games: ask HallPass, keep no calendar

**Status:** shipped in SDK 1.7.0 (`GET /api/v1/event`, `HallPass.getEvent()`, the `"event"` signal, and the dashboard switch at `/dashboard/events`).

## The rule, in one sentence

**A game shows Halloween only while HallPass says the event is on. When HallPass says there is no event, Halloween does not exist in the game: no menu entry, no decorations, no event mode, no event board, no countdown. The player sees the normal game.**

An admin can flip this from the dashboard at any moment, in the middle of the event, and the game must follow. So a game must never decide by its own dates, and a hard-coded window is only ever a *dev* convenience.

## What HallPass gives a game

```js
const ev = await HallPass.getEvent();
// { active, event, phase, startAt, opensAt, endAt, serverTime }  |  null
```

| Field | Meaning |
|---|---|
| `active` | **The only thing to branch on.** `true` = show Halloween. |
| `event` | `"fright-fest"` while active, else `null`. |
| `phase` | `"live"` while active, `"ended"` after the window, else `"off"` (not started, or switched off). |
| `startAt`, `opensAt`, `endAt` | ISO UTC instants while active, else `null`. Before `opensAt` the event is a preview: a game may mark runs as practice. |
| `serverTime` | HallPass's clock. Use it instead of the device clock if you need "now". |
| `null` (the whole result) | HallPass could not be reached. **Treat as no event.** |

An inactive answer never carries a name or dates, so a game that keyed on any of them has nothing to show.

Live updates:

```js
HallPass.on("event", (ev) => applyHalloween(!!ev.active));
```

`"event"` is **sticky** (a late listener gets the last state immediately) and fires again when the answer changes. Once something listens, the SDK re-checks every 60 seconds while the tab is visible, so an open game follows the dashboard switch. A player who reloads sees it at once. The server caches the answer for 30 seconds.

Feature-detect: `HallPass.supports && HallPass.supports("event")` (also `HallPass.capabilities.event`). An SDK older than 1.7 has neither: treat as no event.

## The gate every game uses

```js
// hw = "is Halloween on in this game right now?"
const q = new URLSearchParams(location.search).get("halloween"); // or the game's own flag name
const localDev = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);

hw = (localDev && q === "1")                       // dev only: force ON to work on the look
  || (!!ev && ev.active && q !== "0" && !playerOptedOut);
```

In words:

1. **HallPass says no (or `null`, or no SDK): off.** Nothing a player can type or save turns it on.
2. `?halloween=0` (or the game's equivalent) forces it OFF anywhere: harmless, handy for support.
3. `?halloween=1` forces it ON **only on localhost**, so the look can be developed out of season. On the live site it does nothing.
4. A player's own "turn the event off" setting may switch it off. A player setting must **never** force it on.
5. The game's old hard-coded dates are **deleted** (or kept only behind `localDev`). They are no longer a fallback.

When the answer flips to `false` mid-session, the game drops Halloween as it would on a fresh load: remove the menu entry, hide the decorations and event mode. Do not interrupt a run that is already in progress; apply the change at the next menu or the next round.

## What the dashboard switch does and does not do

`/dashboard/events` (super admin to change, any dashboard role to look) sets `app_settings` key `event:fright-fest` to `auto` (follow the event dates) or `off` (the event does not exist in any game, even mid-event). The page states this in plain words.

It does **not** control the site's own haunted look: that is painted by a static boot script from `app/lib/events/fright-fest.ts`, so only `enabled: false` there (plus a deploy) turns the site skin off. Moving the dates is the same file; `phaseAt` is the single definition of "live", and the route reads it, so the games and the site cannot disagree about when the event is.

## Test recipe (any game)

1. Serve the game from the HallPass origin (so the SDK talks to a real `/api/v1/event`), or stub the SDK:
   ```js
   window.HallPass = { supports: () => true, getEvent: async () => ({ active: true, event: "fright-fest", phase: "live", startAt: "2026-10-25T00:00:00Z", opensAt: "2026-10-28T00:00:00Z", endAt: "2026-11-03T00:00:00Z", serverTime: new Date().toISOString() }), on() { return this; } };
   ```
2. Check each row of the gate: active/inactive/`null`/no SDK; `?halloween=0`; `?halloween=1` on localhost vs on a non-local host; player opt-out; and a flip from active to inactive while the game is open (call the `"event"` callback with `{ active: false, ... }`).
3. With the stub set to `{ active: false, event: null, phase: "off", ... }` confirm **no trace** of Halloween remains: no menu entry, no event assets requested, no event mode reachable.

## Per game

- **SCP: Lockdown** (`laboratory.js`, a minified bundle): the gate is `dY()`, built on `HC` (the hard-coded 28 Oct to 3 Nov window), `GY()` (the `laboratory-settings.fest` player setting, where `1` forces it on) and the `?fest=` flag. `GY() === 1` forcing it on, and `pY()` (the date check), both go.
- **Last Bell** (`halloween/config.js`): the gate is `halloweenAvailable()` over `HALLOWEEN.startAt/endAt/teaserFrom` and `?halloween=`. Its `eventPhase()` also drives practice-vs-ranked, which should now use `opensAt` from HallPass instead of its own constant. Its ranked board still needs `supports("leaderboard.boards")` as before; that is unrelated.
