# Fright Fest 2026: integration contract for game developers

This is for the developers of two HallPass games that will join the Fright Fest
2026 cross-game championship:

- **SCP: Lockdown** (slug `scp-lockdown`), mode "The Haunting". SCP replaced
  Shadow Core in the lineup on 27 October 2026 (owner decision).
- **Survive Till Dawn: Pixel Edition** (slug `survive-till-dawn-pixel-edition`),
  mode "Blood Moon".

Last Bell (`last-bell`, mode "The Halloween Shift") is already integrated. It is
the worked example throughout.

Everything below is taken from the HallPass code in
`app/lib/championship/`. Where this page says "the server checks X", that check
exists in `validators.ts` or `intake.ts`. If the code and this page ever
disagree, the code wins and this page is wrong; tell us.

## 1. Status and window

**Status: proposed rules.** The SCP: Lockdown and Survive Till Dawn rules on this
page are proposals (`rules: "proposed"` in `fright-fest-2026.ts`). The Last Bell
rules are verified.

A board opens only after HallPass verifies your event mode. Until an admin opens
it, the board is `pending`, the server refuses every run start with
`board-pending`, and **nothing is ranked**. Building the mode early costs you
nothing; shipping it does not enter anyone.

| Item | Value |
| --- | --- |
| Championship id | `fright-fest-2026` |
| Opens | 28 October 2026, 00:00 UTC |
| Closes | 3 November 2026, 00:00 UTC |
| Finishing grace | 10 minutes (`submitGraceSec: 600`) |
| Run token lifetime | 75 minutes (`tokenTtlSec: 4500`) |
| Results by | 6 November 2026, 00:00 UTC |

The window is in UTC. Do not work it out from the player's local time.

A run that **started before the close** may finish up to 10 minutes after it.
The server records it with `late: true`. A run that started at or after the
close is refused with `closed`. If staff start verification before then, late
runs are refused with `verification`. An admin can also close the event early;
the close moves to that moment.

A board that opens after 28 October only counts runs that started after its own
opening. A run that started before the board opened is refused with
`started-before-board-opened`.

## 2. Hosting requirements

1. **The game must be served by HallPass, same origin.** Run starts and
   submissions need HallPass's session cookie. A game embedded from another
   domain gets `null` from `runStart` and cannot enter. The server also refuses
   any request whose `Origin` header names another site (HTTP 403).
2. **Load the SDK with a relative path**, not an absolute URL on another origin:

   ```html
   <script src="/sdk/v1/hallpass.js" data-game="scp-lockdown" defer></script>
   ```

   For Survive Till Dawn use `data-game="survive-till-dawn-pixel-edition"`.
3. **Use SDK 1.5.0 or later.** Event boards and run tokens arrived in 1.5.0.
4. **Only signed-in players can enter.** There is no guest entry. A signed-out
   player gets `reason: "signed-out"` and the run is not counted.

## 3. The flow

Each ranked run has three steps. Nothing else is needed.

1. **Detect.** Ask the SDK whether it supports event boards. If not, play the
   mode as practice and send nothing.
2. **Start.** Call `runStart` at the moment the **ranked clock starts**, not at
   the menu and not at page load. Keep the `token` it returns.
3. **Submit.** At the end of the run, call `submitScore` once, with the token in
   `meta.token`.

```js
// 1. Detect. Never guess from the SDK version.
const hp = window.HallPass;
const canEnter = !!(hp && hp.submitScore && hp.supports && hp.supports("leaderboard.boards"));

// 2. Start: the moment the ranked clock starts.
let run = null;
if (canEnter && hp.runStart) {
  run = await hp.runStart({ board: "scp-lockdown-haunting", seed: 20261031 }); // { token, expiresAt } or null
}

// 3. Submit: once, when the run ends.
const r = await hp.submitScore(escapeMs, {
  board: "scp-lockdown-haunting",
  promptHandle: false,
  meta: { token: run && run.token, event: "fright-fest-2026", mode: "haunt", /* ... */ },
});
```

### Reference: Last Bell

Last Bell starts the run when its clock starts (`halloween/score.js`, `begin`):

```js
const hp = sdk();
const p = hp?.runStart?.({ game: 'last-bell', board: HALLOWEEN.board, seed: g.seed });
if (p?.then) p.then((t) => this.rec && (this.rec.runToken = t?.token || t || null)).catch(() => {});
```

and submits when the run ends (`_submit`):

```js
if (!boardSupport(hp)) return 'unsupported';          // supports('leaderboard.boards')
hp.submitScore(r.timeLeft, {
  board: HALLOWEEN.board,                             // 'last-bell-halloween-shift'
  promptHandle: false,
  meta: { event: r.event, v: r.v, seed: r.seed, time: +r.gameTime.toFixed(2),
          wall: +r.wallTime.toFixed(2), bound: +r.lowerBound.toFixed(1),
          flags, token: r.runToken },
});
```

Things Last Bell does that you should copy:

- It feature-detects, and sends nothing if the SDK does not support boards.
- It starts the token at clock start, so server time and game time line up.
- It sends `promptHandle: false`, so no handle dialog interrupts the run end.
- It measures game time and wall time itself and sends both.
- It only submits a run when its own checks found no problems.
- `runStart` is awaited in the background; if it fails the run is simply not
  entered. The game keeps working.

### What `runStart` returns

| Result | Meaning |
| --- | --- |
| `{ token, expiresAt }` | A run is open. HTTP 201. `token` is 43 characters, URL-safe. |
| `null` | The board takes no run: signed out, board not open, event not live, rate limited, game on another domain, or the request failed. It never throws. |

`runStart` accepts `{ board?, seed? }`. `seed` is stored with the run only if it
is a safe integer. The Last Bell and SCP: Lockdown validators compare it with the fixed seed (see section 10).

### What `submitScore` returns

On success (`r.ok === true`):

| Field | Meaning |
| --- | --- |
| `status` | `"accepted"`: ranked now. `"flagged"`: recorded, hidden until an admin reviews it. |
| `rank` | The player's place on the board after this run. Present for accepted runs only. |
| `best` | `true` when this run is now the player's best on the board. |
| `detail` | Extra reason text, used on failures. |
| `championship` | `"fright-fest-2026"`. |

The HTTP body also carries `late` and `duplicate`. The SDK 1.5.0 notes list
`status`, `best`, `detail` and `championship` as the new `SubmitResult` fields;
do not rely on `late` or `duplicate` being passed through the SDK.

On failure (`r.ok === false`), read `r.reason`:

| `reason` | HTTP | Meaning | What to do |
| --- | --- | --- | --- |
| `signed-out` | 401 | No session. | Tell the player to sign in. The run is lost. |
| `closed` | 409 | The board or event takes no run now. `detail` says why (below). | Say so. Do not retry. |
| `no-run` | 409 | No valid token in `meta.token`. | Do not retry. Start a new run next time. |
| `expired` | 409 | The token lived longer than 75 minutes. The token is now spent. | Do not retry. |
| `rejected` | 422 | Failed a server check. `detail` is the validator's reason code. | Do not retry. Fix the game. |
| `rate-limited` | 429 | Too many runs or submissions too close together. | See section 7. |
| `unavailable` | 503 | HallPass could not record it. | May retry once with the same token, see below. |
| `bad-board` | n/a | The board id is not one HallPass knows. | Fix the id. |

`closed` carries one of these in `detail`: `off`, `upcoming`, `closed`,
`suspended`, `verification`, `finalised`, `board-pending`, `board-paused`,
`board-withdrawn`, `board-not-open-yet`, `started-before-board-opened`.

HallPass also shows the outcome to the player itself ("Entered: 3rd", "Sign in
to enter"), so a game that ignores the result still tells the truth. Show your
own message anyway.

### Token rules

- **One token, one run, one player, one board.** The server looks the token up
  by its hash and the signed-in player together, so a leaked token is useless to
  anyone else.
- **Single use.** The first completed submission spends it. Submitting the same
  token again returns the stored outcome with `duplicate: true` (accepted or
  flagged) or `already-rejected` (HTTP 422). It never creates a second entry.
- A submission that is **not recordable right now** (board paused, event
  suspended) leaves the token unspent. It may be tried again until it expires.
- An **expired** token is spent as rejected the first time it is presented.
- **Rate limits.** At most 20 run starts per player in any 600 seconds, across
  the whole championship. Recorded runs on one board must be at least 20 seconds
  apart per player.
- `meta` is a plain object of at most **4 KB** of JSON. A larger one is dropped
  whole, so the token goes with it and the run gets `no-run`.
- The server deletes `meta.token` before storing `meta`.

## 4. How the server judges a run

The game runs entirely in the browser, so the score and the game's own timers
are claims. The one thing the server measures itself is **real time between the
token being issued and the result arriving** (`elapsedSec`, from the database
clock). Each validator compares your score with that.

Every validator makes two kinds of decision.

- **Rejected.** The run is impossible on the server's own evidence or the
  published rules. It is never ranked and is kept for the audit trail. The
  player gets `rejected` with a reason code in `detail`.
- **Flagged.** The run is implausible on the game's own claims. It is recorded
  (`status: "flagged"`) and hidden until an admin looks. It does not count for
  points until approved.

Network delay is real, so every "faster than real time" check allows
`LATENCY_SLACK_SEC = 8` seconds.

Any strings in `meta.flags` (an array; only strings count; the first 10 are
read) become `game:<flag>` flags on the run. **One honest game-side flag is
enough to hold a run for review.**

## 5. SCP: Lockdown, The Haunting

Find a Level 4 keycard and escape the site. The fastest escape wins. These
rules are **proposed**: the game does not send them yet.

| Item | Value |
| --- | --- |
| Board id | `scp-lockdown-haunting` |
| Slug | `scp-lockdown` |
| `meta.mode` | `"haunt"` |
| Score | Escape time in whole **milliseconds**, from the round start to the escape |
| Sort | Ascending: lower is better |
| Score rules | Integer. At least 30,000 and at most 3,600,000 (placeholder bounds, see section 10) |
| Tiebreak | Ghosts banished, more is better (`meta.banished`) |
| Ranking rule | "Escape fastest: find a Level 4 keycard and get out. Equal times are split by more ghosts banished." |

SCP's other Fright Fest modes (Trick or Treat, Night of the Living Dead) stay
playable and are **unranked**. Only The Haunting enters this board.

### `meta` fields the validator reads

| Field | Type | Needed | Notes |
| --- | --- | --- | --- |
| `token` | string | yes | From `runStart`. |
| `event` | string | yes | Exactly `"fright-fest-2026"`. |
| `mode` | string | yes | Exactly `"haunt"`. |
| `diff` | integer | yes | Exactly `1` (Normal). |
| `seed` | integer | yes | Exactly `20261031`, the seed that lays out the doors and the keycard. Also pass it to `runStart`. |
| `coop` | boolean | yes in practice | Send `false` for a solo run. `true` is rejected. |
| `time` | number | should | Game seconds from the round start to the escape. Should match the score: `time * 1000` within 1,000 ms of it. |
| `wall` | number | should | Wall-clock seconds over the same span, measured by the game. |
| `banished` | integer | should | Ghosts banished in the run, at least 0. The tiebreak. |
| `v` | integer | optional | Your mode's version. Stored, never checked. |
| `flags` | array of strings | optional | Your own warnings. Any entry flags the run. |

### Rejected

The checks run in this order; the first that fails is the reason.

| Reason code | When |
| --- | --- |
| `bad-score` | Score is not an integer, is under 30,000 ms, or is over 3,600,000 ms. |
| `wrong-event` | `meta.event` is not `"fright-fest-2026"`. |
| `wrong-mode` | `meta.mode` is not `"haunt"`. |
| `co-op-not-ranked` | `meta.coop` is exactly `true`. |
| `wrong-difficulty` | `meta.diff` is not the integer `1`. |
| `wrong-layout` | `meta.seed` is not `20261031`, or the seed stored by `runStart` is set and is not `20261031`. |
| `clock-faster-than-real-time` | Score in seconds is more than `elapsedSec + 8`. |

### Flagged for review

| Flag | When |
| --- | --- |
| `no-game-time` | `meta.time` is missing or not a number. |
| `game-time-mismatch` | `meta.time * 1000` differs from the score by more than 1,000 ms. |
| `game-time-ahead-of-wall` | `meta.wall` is more than 2 seconds below `meta.time`. |
| `no-banished` | `banished` is missing, not an integer, or negative. The tiebreak is then empty. |
| `unusually-fast` | Score is under 60,000 ms. This threshold is a placeholder until real times are known. |
| `game:<flag>` | One per entry in `meta.flags`. |

### What the mode must guarantee

- **The same site layout for everyone.** Seed `20261031` lays out the doors and
  the keycard. Send it in `meta.seed` and pass it to `runStart`. Ghost spawns may
  stay random.
- **Normal difficulty, forced.** No difficulty choice in The Haunting; send
  `diff: 1`.
- **Solo only.** Co-op is not ranked. Do not offer to enter a co-op run. If one
  slips through, send `coop: true` honestly and the server rejects it.
- **`runStart` when the escape clock starts**, which is the round start. Menus
  and loading screens are outside it.
- **Submit once, on escape only.** Never on death, never on a quit. A run that
  does not end in an escape is not entered.
- **The other Fright Fest modes stay unranked.** Trick or Treat and Night of the
  Living Dead never call `submitScore` for this board.
- SCP's everyday multiplier scoring and leaderboard are unrelated and
  untouched.

## 6. Survive Till Dawn: Pixel Edition, Blood Moon

Survive a fixed 20-minute night. The longest survival wins; reaching dawn is the
maximum.

| Item | Value |
| --- | --- |
| Board id | `survive-till-dawn-blood-moon` |
| Slug | `survive-till-dawn-pixel-edition` |
| `meta.mode` | `"blood-moon"` |
| Score | Whole **seconds** survived |
| Sort | Descending: higher is better |
| Score rules | Integer. At least 0 and at most 1200 (1200 is dawn at 20:00) |
| Tiebreak | Kills, more is better (`meta.kills`) |
| Ranking rule | "Survive the longest, up to dawn at 20:00. Equal times are split by more kills." |

### `meta` fields the validator reads

| Field | Type | Needed | Notes |
| --- | --- | --- | --- |
| `token` | string | yes | From `runStart`. |
| `event` | string | yes | Exactly `"fright-fest-2026"`. |
| `mode` | string | yes | Exactly `"blood-moon"`. |
| `coop` | boolean | yes in practice | Send `false` for a solo run. `true` is rejected. |
| `kills` | integer | should | Whole run, at least 0. The tiebreak. |
| `flags` | array of strings | optional | Your own warnings. Any entry flags the run. |

### Rejected

| Reason code | When |
| --- | --- |
| `bad-score` | Score is not an integer, is below 0, or is above 1200. |
| `wrong-event` | `meta.event` is not `"fright-fest-2026"`. |
| `wrong-mode` | `meta.mode` is not `"blood-moon"`. |
| `co-op-not-ranked` | `meta.coop` is exactly `true`. |
| `clock-faster-than-real-time` | Score is more than `elapsedSec + 8`. |

### Flagged for review

| Flag | When |
| --- | --- |
| `no-kills` | `kills` is missing, not an integer, or negative. The tiebreak is then empty. |
| `unusual-kill-rate` | Score above 0 and kills divided by score above 15 per second. This ceiling is generous until real runs are seen. |
| `game:<flag>` | One per entry in `meta.flags`. |

### What the mode must guarantee

- **Fixed conditions for everyone.** The same realm (Bleeding Woods), the same
  difficulty (Standard) and the same 20-minute night. The proposal also says
  seeded, so every player meets the same spawns.
- **Solo only.** Co-op is not ranked. Do not offer to enter a co-op run. If one
  slips through, send `coop: true` honestly and the server rejects it.
- **No permanent upgrades.** Everyone starts the night from the same state.
- **Score is survival time only.** Whole seconds, from the first playing frame
  to death or dawn. A run that reaches dawn scores exactly 1200.

## 7. Anti-cheat expectations

The honest limit first: **a modified client that waits a plausible time and
posts a plausible score passes the server checks.** That is true of every game
that runs in the browser, and the rules page says so. The backstop is admin
review of the top results before the standings are finalised. Your job is to
make honest runs easy to tell apart from dishonest ones.

In plain terms:

- **Do not let your clock run faster than real time.** The server measures the
  time between `runStart` and submit. A score that implies more game time than
  that (plus 8 seconds) is rejected. Use `performance.now()` deltas, clamp a
  single frame's `dt`, and do not scale time with frame rate or speed settings.
- **Game time may be shorter than real time, never longer.** Pauses, tab blur and
  menus make real time exceed game time. That is normal and passes.
- **Call `runStart` when the clock starts.** Calling it early only lengthens
  `elapsedSec`; calling it late can make an honest run look faster than real
  time and get it rejected.
- **Keep honest game-side flags.** If the game knows a debug switch, a cheat
  code, a forced event or a speed change was used, put it in `meta.flags`.
  Last Bell does: `speed`, `route`, `debug`, `rules`, `phase`, `hidden`. A flag
  holds the run for review; it does not delete it.
- **Do not build client-side "anti-cheat".** No obfuscation, no hidden checksums,
  no secrets in the page, no "tamper" detection that pretends to be proof. The
  server cannot trust any of it, and it hides the honest signals we do want.
  Send plain facts and let the server compare.
Last Bell does not submit a run its own checks flagged (apart from `phase`
practice runs). You may do the same.

## 8. Testing before verification

Test against a local HallPass.

1. Run HallPass: `npm run dev`.
2. Serve your game from HallPass, same origin, with the relative SDK tag from
   section 2. A game on another port or domain will get `null` from `runStart`.
3. **Sign in** as a player.
4. **A board must be opened by an admin** in `/dashboard/championship`.
   Until then every run start fails with `board-pending`, and `runStart` gives
   you `null`. Sign in as an admin, open `/dashboard/championship`, and open
   your game's board. The board takes runs from its own opening moment.
5. The event is live only from 28 October 00:00 UTC; before that the server
   answers `upcoming`. To test earlier, change `opensAt` in
   `app/lib/championship/fright-fest-2026.ts` **in your local checkout only**
   (for example to yesterday), and make sure the board's `opened_at` in your
   local database is not later than now. Never commit that change.
6. Play a run. Check:
   - `runStart` resolves `{ token, expiresAt }`.
   - `submitScore` resolves `ok: true`, `status: "accepted"` and a `rank`.
   - The same token submitted twice does not create a second entry.
   - The board appears at `/api/v1/leaderboard/<board>` and on the Fright Fest
     page.
7. Try the failure cases on purpose, so your game's messages are right: signed
   out, a missing token, an old token, a score of the wrong unit, `coop: true`
   (Survive Till Dawn, SCP: Lockdown), the wrong seed or a difficulty other than
   Normal (SCP: Lockdown), an escape time that disagrees with `meta.time`
   (SCP: Lockdown).

### Verification checklist

HallPass runs this before opening a board. A "no" on any line keeps it
`pending`.

- [ ] The game is served by HallPass, same origin, with the relative SDK tag
      and the right `data-game`.
- [ ] SDK is 1.5.0 or later; the game feature-detects `leaderboard.boards`.
- [ ] The event mode exists, is reachable from the menu, and matches the rules
      text on `/fright-fest` word for word: how to enter, solo, fixed
      conditions, ranking rule.
- [ ] Conditions are identical for every player (seed 20261031 and Normal
      difficulty for The Haunting; Bleeding Woods, Standard, 20-minute night for
      Blood Moon).
- [ ] `runStart` is called at the ranked clock start, with the right board id.
- [ ] `submitScore` is called once per run, with the board id, `promptHandle:
      false` and `meta.token`.
- [ ] The score has the right unit, sort direction and bounds for the board.
- [ ] `meta` carries exactly the fields in this page, with the right types, and
      stays under 4 KB.
- [ ] A normal run is `accepted` and ranks. A deliberately broken run is
      `rejected` with the expected reason.
- [ ] The Haunting only: `meta.time * 1000` matches the score within 1,000 ms
      on every test run, a death never submits, and co-op cannot enter.
- [ ] Blood Moon only: a co-op run cannot enter, and reaching dawn scores 1200.
- [ ] The game's clock does not run faster than real time (checked by playing
      with the tab in the background, and with a throttled frame rate).
- [ ] Nothing is submitted from the ordinary game mode or from practice.
- [ ] Nothing in `meta` identifies the player.
- [ ] The game still works, with no errors, when `runStart` returns `null` or
      `submitScore` fails.
- [ ] Real timing data from a handful of test runs is shared, so the
      placeholder thresholds can be set from it (see "Open points" below).

## 9. What not to do

- **Do not submit outside the event mode.** Ordinary play, practice, tutorials
  and co-op never go to the event board. Event runs never go to the game's
  everyday board either.
- **Do not send personal data in `meta`.** No name, email, handle, user id or
  device details. HallPass already knows who the player is from the session.
- **Do not exceed 4 KB of `meta`.** The whole object is dropped, the token with
  it, and the run is lost. Send small facts, not replays or frame logs.
- **Do not retry with a new token for the same run.** If a submission is
  refused, the run is over. A second `runStart` for the same play-through, with
  the same result, is an attempt to enter twice. The only retry that is fine is
  re-sending the **same** token after a network failure or a `503`; the server
  returns the stored outcome rather than a second entry.
- **Do not start a token before the clock starts, or hold one across runs.** One
  token is for one run. Do not reuse a token from the last run.
- **Do not start runs you will not submit in a loop.** Twenty run starts per
  player per ten minutes is the cap; hitting it blocks real runs.
- **Do not submit twice in quick succession.** Two recorded runs on one board
  must be 20 seconds apart.
- **Do not change the mode after verification.** Published rules do not change
  mid-event.
- **Do not log or display the token.** It is a secret until it is spent.

## 10. Open points in the proposed rules

These are the places where the proposals are provisional or where the code is
narrower than the text. We will settle them with real data before opening the
boards.

- **The Haunting thresholds.** The 30,000 ms hard floor, the 60,000 ms review
  line and the 3,600,000 ms ceiling are placeholders. Real escape times should
  raise them.
- **Survive Till Dawn kill rate.** 15 kills a second is a generous ceiling.
- **Token lifetime and The Haunting.** A token lives 75 minutes, longer than
  the 60-minute Haunting ceiling (3,600,000 ms), so a legitimate run never
  outlives its token. A run paused for longer than that would expire.
- **Seeds.** `runStart({ seed })` stores a seed. The Last Bell validator checks
  one (`2026118`) and so does The Haunting (`20261031`). The Survive Till Dawn
  validator reads no seed, so "same layout for everyone" there is enforced by
  your game, not the server. Ghost spawns in The Haunting may stay random.
- **Fields the proposals mention but the server does not read:** realm and `v`
  (and, for Blood Moon, difficulty). They are stored with `meta` if you send them, but nothing
  rejects on them. Send them anyway; reviewers will look.
- **Fields the SDK passes through.** `late` and `duplicate` are in the HTTP body
  but not in the 1.5.0 `SubmitResult` notes.

## 11. Quick reference

| | Last Bell | SCP: Lockdown | Survive Till Dawn |
| --- | --- | --- | --- |
| Rules | verified | proposed | proposed |
| Slug | `last-bell` | `scp-lockdown` | `survive-till-dawn-pixel-edition` |
| Board | `last-bell-halloween-shift` | `scp-lockdown-haunting` | `survive-till-dawn-blood-moon` |
| Mode | The Halloween Shift | The Haunting | Blood Moon |
| Score | whole seconds left | whole ms escape time | whole seconds survived |
| Sort | descending | ascending | descending |
| Bounds | 0 to 480 | 30,000 to 3,600,000 | 0 to 1200 |
| Tiebreak | escape time, ascending | ghosts banished, descending | kills, descending |
| `meta.event` | `fright-fest-2026` | `fright-fest-2026` | `fright-fest-2026` |
| `meta.mode` | not checked | `haunt` | `blood-moon` |
| Seed | `2026118` | `20261031` | not checked |
| Difficulty | not checked | `diff: 1` | not checked |
| Co-op | not ranked | rejected | rejected |
| Reward pack ids | `ff26-winner-last-bell` | `ff26-winner-scp-lockdown` | `ff26-winner-survive-till-dawn` |

Points per board: 100, 80, 65, 40, 40, 20, 20, 20, 20, 20 for places 1 to 10,
and 5 for everyone else who is ranked. Participation reward: `ff26-participation`.
