# Fright Fest 2026 championship — design

Sibling of `challenge-design.md` and `artifacts/fright-fest-architecture.md`. The
argument for what is being built, what is deliberately excluded, and the
constraints that shaped it. The collectible rewards the championship pays out
are designed in `collectibles-design.md`.

The championship is HallPass's first cross-game competition: each event game has
its own ranked board, and ranks (not raw scores) become **Fright Points** on one
overall table. It is a separate feature from the haunted skin. The skin can ship,
expire or be switched off without the championship, and the championship works
with the skin off.

---

## 1. Decisions

Taken with the owner on 26 Oct 2026:

1. **Games join when they are verified.** Only Last Bell has a real event mode
   today (§2). Its board opens with the event. The other two boards are
   configured but `pending`, and an admin opens each one from the dashboard
   once its mode is verified. Fright Points add up across every board that
   opened; Overall Champion needs a result on every board that opened. This is
   published as a rule from day one, so a board opening later is the rules
   working, not a rules change.
2. **The window is 6 days: 28 Oct 00:00 UTC → 3 Nov 00:00 UTC** (last full day
   Mon 2 Nov). The haunted skin's `endAt` moves to the same instant. They share a
   date, not a flag. (Decided as 5 days, ending 2 Nov 00:00; the owner added
   Mon 2 Nov on 27 Oct, before the opening, and moved results to Thu 5 Nov.)
3. **Last Bell's game side** is edited and staged by us (two edits, §2.1); the
   owner runs the production publish.
4. **Collectible art is demo art for now**, clearly marked, swappable without
   code changes (see `collectibles-design.md`).

Taken here, as engineering decisions:

5. **One entry point for games.** A board submission still goes to
   `POST /api/v1/leaderboard/<board>`, which is what Last Bell already codes
   against. The route hands championship boards to the championship intake
   before it touches `scores`. No `boards` row exists for a championship board.
6. **Championship runs live in their own table**, not in `scores`. A ranked run
   needs a server-issued token, a verification state, review metadata and an
   audit trail, and `scores` has none of those. Ordinary boards are untouched.
7. **Signed-in players only.** A ranked run belongs to a `players.id` taken from
   the session, never from the request body.
8. **Dates are in code, lifecycle is in the database.** The window and the rules
   are reviewed, versioned code. Admin state (game open/paused, suspended,
   verification, finalised) is a database row, so it changes without a deploy
   and every change is logged.


**Update, 27 Oct 2026 (owner decision): SCP: Lockdown replaces Shadow Core in
the lineup.** The championship is now Last Bell, SCP: Lockdown and Survive Till
Dawn: Pixel Edition. Shadow Core: Halloween Dash leaves the championship and
stays an ordinary arcade game (its everyday board is untouched). SCP's ranked
mode is "The Haunting": escape time in ms (lower wins), ghosts banished as the
tiebreak, Normal difficulty, solo, one seeded site layout (20261031). Its rules
are `proposed`, its board is `pending` until an admin opens it, and its
contract is in `docs/championship-integration.md` section 5. The audit in §2
and the tables below were written before the swap; read "Shadow Core" in them
as superseded by this note. A leftover `shadow-core-halloween-dash` row in
`championship_games` (seeded by migration 048) is ignored: standings are built
from the config.

---

## 2. Audit: the three games

| | Last Bell — The Halloween Shift | Shadow Core — "Cursed Dash" | Survive Till Dawn — "Blood Moon" |
|---|---|---|---|
| Event mode exists | **Yes** (`halloween/` in the game source) | **No.** Only a HallPass label | **No.** Only a HallPass label |
| Live build has it | No (blob of 18 Oct predates it) | n/a | n/a |
| Submits scores | Feature-detected named board + meta + run token | `submitScore(totalMs)` to board `haloween-fastest-level-time` | **Never calls `submitScore`** |
| Equal conditions | Fixed school (seed 2026118), Normal, solo, 8:00 clock, fixed blackout rules | Deterministic levels, but score is a lifetime sum of per-level bests kept in localStorage | Unseeded RNG; player picks realm, length, difficulty, character; permanent meta-upgrades |
| Verifiability | Medium, **with** server run tokens | Low: one bare integer, forgeable by a localStorage edit | None today |

### 2.1 Last Bell (verified by the owner)

From `~/Documents/Projects/last-bell/halloween/{config,score,mode}.js` and its
contract `docs/halloween/hallpass-request.md`:

- **Metric:** whole seconds left on the 8:00 clock at the escape. Integer
  0–480, higher is better. Normal has no exit bonus, so 480 is a hard maximum.
- A run is one escape attempt. Only `escaped` runs with no local flags are sent,
  once per run, as `submitScore(timeLeft, { board: 'last-bell-halloween-shift',
  promptHandle: false, meta: { event, v, seed, time, wall, bound, flags, token } })`.
- It asks for a token with `HallPass.runStart({ game, board, seed })` when the
  run clock starts, and only posts if `HallPass.supports('leaderboard.boards')`.
- **Two edits are needed before publishing** (we make them, §10):
  1. The SDK tag loads `https://hallpass-rouge.vercel.app/sdk/v1/hallpass.js`.
     The SDK takes its API origin from its own `src`, so every request is
     cross-origin, sent without the session cookie, and **anonymous**. It must
     load `/sdk/v1/hallpass.js` like every other HallPass game.
  2. `halloween/config.js` closes the window at 1 Nov 00:00 UTC. Runs on 1 Nov
     would be flagged `phase` and never sent. It moves to 3 Nov (it was moved
     to 2 Nov first; the event gained Mon 2 Nov on 27 Oct).
- Weak points, all client-side: a modified client can post any score with
  `flags: []`. The server's real defences are the token's server timestamps,
  the seed, and consistency between score, game time and elapsed time.

### 2.2 Shadow Core: Halloween Dash (not verified)

No "Cursed Dash" mode exists in the game. It posts the sum of 15 per-level best
times (ms, lower is better) from localStorage after each clear. Editing
`shadow_dash_level_stats` posts any total, and pre-event bests carry over. It is
**not rankable as built**. What the game team needs to add is in
`docs/championship-integration.md` (a continuous 15-sector run with a run token,
per-sector splits in `meta`).

### 2.3 Survive Till Dawn: Pixel Edition (not verified)

No "Blood Moon" mode (it is a random mid-run objective and a perk), no score
submission, unseeded RNG, player-chosen difficulty and permanent upgrades. **Not
rankable as built.** Proposed mode: fixed realm, Standard, 20-minute night,
solo, seeded, no meta-upgrades; metric = seconds survived (0–1200), tiebreak
kills. Also in `docs/championship-integration.md`.

**Consequence:** Shadow Core and Survive Till Dawn ship as `pending` boards with
proposed rules. Their homepage cabinets stay mystery cabinets until opened.

---

## 3. Rules (published on /fright-fest before any ranked run)

**Window.** Ranked runs count if the server receives them between 28 Oct 00:00
UTC and 3 Nov 00:00 UTC (UK time is UTC throughout: BST ended 25 Oct). The
device clock is never consulted. A game that opens later counts from its
opening moment.

**Who.** Signed-in HallPass players. Guests can play the modes, but runs are not
ranked. Public names are the player's chosen handle or `@username`, never a
real name. Avatars follow the player's existing privacy settings.

**Per-game boards.** Each event game has its own board. A player's **best**
accepted run counts. A new run can only improve it, and worse runs never cost
or earn anything. Ordering:

| Game | Primary | Tiebreak 1 | Then |
|---|---|---|---|
| Last Bell — Halloween Shift | Seconds left at escape (high) | Game time to escape (low) | Earlier server receipt, then lower run id |
| Shadow Core — Cursed Dash *(proposed)* | Total time (low) | Deaths (low) | Same |
| Survive Till Dawn — Blood Moon *(proposed)* | Seconds survived (high) | Kills (high) | Same |

Ranks are strict: the tiebreaks always separate two runs, so no two players
share a place.

**Fright Points.** Each opened board turns a player's rank into points:

| Rank on a game board | Points |
|---|---:|
| 1st | 100 |
| 2nd | 80 |
| 3rd | 65 |
| 4th–5th | 40 |
| 6th–10th | 20 |
| 11th and below | 5 |
| No result | 0 |

Every board is worth the same maximum (100), so no game dominates. The table
stays meaningful for a field of 3–20 players, which is what HallPass has (19
signed-in players were active in the 30 days before the event). With fewer than
four entrants on a board, only the top three bands apply.

**Overall table.** Total Fright Points across opened boards. Ties are broken,
in order, by:

1. Results on more opened boards.
2. Better best-placings: compare each player's board ranks sorted best-first
   (a 1st beats a 2nd, and so on).
3. Whoever reached their final total first (the latest receipt time among
   their counting runs, earlier wins).
4. Public player id, as a last resort, so the order is always defined.

**Eligibility.** The **Overall Champion** is the highest-placed player with an
accepted result on **every** board that opened. Others still appear, marked
with the games they are missing.

**Verification.** Standings are provisional until an admin finalises them after
the close. Flagged runs are hidden until reviewed. Disqualifications are
recorded with a reason. Rewards are paid only from finalised standings (§7).

---

## 4. Lifecycle

```
upcoming ──28 Oct──▶ live ──3 Nov──▶ closed ──admin──▶ verification ──admin──▶ finalised ──admin──▶ archived
                      │  ▲
              admin   ▼  │ admin
                   suspended            (also reachable from closed/verification)
```

`phase = f(config window, admin state, now)`, pure, in
`app/lib/championship/phase.ts`:

- `suspended` when the admin flag is set. Nothing is accepted and standings show
  a notice. The skin is unaffected.
- `finalised` / `archived` from the admin status.
- `upcoming` before `opensAt`; `live` until `closesAt` or an admin early close;
  then `closed`, or `verification` once an admin starts it.

Per-game status, also admin state: `pending` → `open` ⇄ `paused`, or
`withdrawn` (with a reason; a withdrawn board stops counting for points).

**Time.** All instants are UTC ISO strings with `Z`. Acceptance uses the
database clock (`now()`) inside the write. Display formats with
`Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' })`. Client islands
use `useSyncExternalStore` with a neutral server snapshot (the existing
FrightFestPhase pattern), so there is no hydration mismatch.

---

## 5. Architecture

### 5.1 Run tokens and intake

```
game (same-origin iframe)          HallPass
  runStart({board, seed}) ───────▶ POST /api/v1/leaderboard/<board>/runs
                                     session player? event live? board open?
                                     per-player issue limit
                                     INSERT championship_runs (token_hash, issued_at=now())
                     ◀── { token, expiresAt }
  … plays …
  submitScore(score, {board, meta:{token,…}}) ──▶ POST /api/v1/leaderboard/<board>
                                     championship board → intake (scores untouched)
                                     session player == token's player
                                     one UPDATE … WHERE status='issued' (single use)
                                     server checks → accepted | flagged | rejected
                     ◀── { ok, status, rank }
```

- **Tokens:** 32 random bytes, base64url. Only the SHA-256 is stored. Bound to
  the issuing player, the event and the game, single-use, expiring 75 minutes
  after issue (`tokenTtlSec`, longer than the longest ranked run).
- **Finishing grace:** a run whose token was issued before the close may still
  be recorded for `submitGraceSec` (10 minutes) after it, so nobody is cut off
  mid-escape at midnight. A run started after the close never gets a token.
  Starting verification ends the grace; the dashboard does not offer it until
  the grace has passed. A paused board refuses runs in flight without spending
  their tokens.
- **Outcome is shown by HallPass, not the game:** Last Bell does not read the
  submit result. SDK 1.5 posts the outcome (`hallpass:championship`) to the
  same-origin parent page, whose overlay shows "Entered: 3rd", "Sign in to
  enter" or "Held for review".
- **Idempotency:** a repeat submission of a used token by the same player returns
  the stored outcome (`duplicate: true`), so a network retry is harmless.
- **Impersonation:** the player is always the session's. A token issued to
  someone else is "not found" for you.
- **Rate limits (per player, never per IP: schools share an IP):** at most 20
  tokens per 10 minutes, and one submission per game per 20 seconds.

### 5.2 Server checks (Last Bell)

Hard rejections (`rejected`, never shown):

- score not an integer in [0, 480]
- `meta.event ≠ 'fright-fest-2026'` or `meta.seed ≠ 2026118`
- clock time used (`480 − score`) under 26 s, the route's straight-line bound
- clock time used more than server elapsed time + 5 s (the clock ran faster than
  real time)
- received outside the window or the board's open period, or token expired

Flags (`flagged`, hidden until an admin approves):

- `meta.flags` not empty (the game never sends flagged runs)
- `|meta.time − (480 − score)| > 3` (game time disagrees with the clock)
- `meta.wall < meta.time − 2` (the game's own speed signal)
- clock time used under the game's reported route bound × 0.9

**What this does not prove (stated honestly on the rules page and in the
dashboard):** the server cannot see the escape. A modified client that waits a
plausible real time and then posts a plausible score passes. That is the limit
of a client-side game. Mitigations are review of the top results before
finalising, and the audit trail. There is no fingerprinting, no IP storage on
runs, and no data beyond what the run needs.

The pending games get the same shape with their own bounds (§2), implemented
as data-driven validators so opening them does not need new intake code, only
the game sending the agreed `meta`.

### 5.3 Data model (migration `048_championship.sql`)

| Table | Purpose |
|---|---|
| `championship_events` | One row per event: `status` (scheduled/verification/finalised/archived), `suspended`, `closed_early_at`, `final_standings` JSONB snapshot, `finalised_at/_by`. |
| `championship_games` | `(event_id, game_slug)`: `status` (pending/open/paused/withdrawn), `opened_at`. Seeded: Last Bell open from 28 Oct 00:00, the others pending. |
| `championship_runs` | One row per token: player, game, `token_hash` (unique), `issued_at`, `submitted_at`, `status` (issued/accepted/flagged/rejected/disqualified), `score`, `tiebreak`, `meta`, `flags[]`, `reason`, `reviewed_by/_at`. History is never deleted. |
| `championship_log` | Every admin action: actor email (from `requireRole`, never a form field), action, run/game/player, reason, data. |

Runs cascade on account deletion, like every per-player table. The finalised
snapshot stores public ids and points, and names are resolved at read time, so a
deleted account shows as "Former player".

### 5.4 Standings

Per board: `DISTINCT ON (player_id)` over accepted runs ordered by the game's
sort and tiebreaks, then the outer order. The overall table is computed in
TypeScript from the per-board lists (`app/lib/championship/points.ts`, pure,
fully tested). At HallPass's size this is a few hundred rows. It is computed on
request behind a CDN cache (`s-maxage=30, stale-while-revalidate=120`), with
no Next data cache. So nothing short-lived sits under a prerendered page
(incident #131), and no client polls: the page fetches once per view.

### 5.5 API

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/v1/leaderboard/<board>/runs` | session | issue a run token |
| `POST /api/v1/leaderboard/<board>` | session | submit (championship boards branch to the intake) |
| `GET /api/v1/leaderboard/<board>` | public | a championship board in the existing `LeaderboardResponse` shape, so the SDK's `getScores({game: board})` works |
| `GET /api/v1/championship/<event>` | public, CDN-cached | phase, lineup, every board's top 25, overall top 50 |
| `GET /api/v1/championship/<event>/me` | session, `no-store` | my bests, ranks, points, eligibility, recent runs and their states |

### 5.6 SDK 1.5.0 (additive, v1 stays v1)

- `submitScore(score, { board?, meta? })`: `board` overrides the configured
  board for one call, and `meta` is a JSON object ≤ 4 KB.
- `runStart({ board?, seed? }) → Promise<{ token, expiresAt } | null>`. It
  resolves `null` when no run can start (signed out, event not live, network),
  so Last Bell's `t?.token || t || null` stores `null`.
- `supports(feature)` and `capabilities`: `leaderboard.boards`,
  `leaderboard.meta`, `runs`.
- New `SubmitReason`s (append-only): `signed-out`, `closed`, `rejected`.

---

## 6. Interface

All championship UI is championship code (`app/components/championship/`),
never theme code. It uses base tokens so it reads correctly with the skin off,
plus skin-scoped polish under `html[data-hp-skin="haunted"]` in the skin's own
stylesheet.

- **/fright-fest**: the approved night scene stays. Below it, while the
  championship is enabled: phase banner, overall standings, per-game boards (a
  tab per game; pending games say "Joins when verified"), your progress
  (signed-in), how Fright Points work, schedule, rules and eligibility, rewards
  preview. Empty boards use an intentional empty state. Nothing is invented: no
  sample names, no participation counts.
- **Homepage card**: the approved card keeps its markup and classes. A
  championship-side slot renders the theme's `EventBoard` while the
  championship is off, and the same card with live copy and a top-3 standings
  island while it is on.
- **Game pages**: a championship panel (client island, so the prerendered page
  never reads live data) on event games: how to enter, your best and rank, link
  to standings.
- **Announcement**: the theme registry's single `ANNOUNCED` flag becomes
  per-game. Last Bell is announced; the other two stay mystery cabinets until
  their boards open (a one-line data change each). *2026-10-28:* SCP: Lockdown
  and Survive Till Dawn are announced too, with both boards open. Neither has
  its own hall cabinet art yet, so the hall names them on the mystery body
  (`ART_KEYS` in `app/fright-fest/hall/props.ts`).

## 7. Rewards hook

Paid out through the collectibles grant service, with idempotent grant keys
(`fright-fest-2026:participation:<player>` and so on):

- **Participation Pack:** an accepted result on every board in the final
  lineup. Granted at finalisation with the others: a pending board could still
  join and change who qualifies, and one payout moment is easier to explain
  ("packs are given out once the results are final").
- **Game Champion Pack** per opened board and **Overall Champion Pack**: only at
  finalisation, from the snapshot. One player can earn several.
- If the collectibles tables are not there yet, finalisation still records the
  winners, and "Grant rewards" can be pressed again later (every grant is
  idempotent).

## 8. Administration (`/dashboard/championship`, role `admin`)

Lineup controls (open/pause/withdraw with reason), suspend/resume, close early,
start verification, review queue (flagged first), every run with its server
checks and raw `meta`, approve / disqualify (reason required) / reinstate,
provisional winners, finalise (refuses while flagged runs are unreviewed),
grant rewards, award history, audit log. Every action is a server action that
calls `requireRole` first and writes `championship_log` in the same statement as
its change. Admins cannot review their own runs. There are no public admin
APIs.

## 9. Independence

| Theme | Championship | Result |
|---|---|---|
| on | off | today's site: upcoming card, no ranked runs |
| on | on | haunted site, live card, ranked runs |
| off (or expired) | on | normal site; /fright-fest and game panels still show the competition |
| off | off | normal site; /fright-fest shows its ended state |

Tests enforce it in both directions: theme files never import championship
modules, and championship modules never import theme modules. The existing
`events.test.ts` rule ("nothing imports the championship flag yet") becomes that
two-way rule.

## 10. Plan: files, order, commits (branch `fright-fest-championship`)

1. `docs: championship + collectibles design` (this file and its sibling).
2. **Event window**: theme `endAt` → 2 Nov; tests and copy follow.
3. **Schema**: `048_championship.sql` + fresh-install `app/lib/championship/schema.sql`.
4. **Core (pure)**: `app/lib/championship/{types,config,fright-fest-2026,phase,validate,points,standings}.ts` with tests.
5. **Store**: `app/lib/championship/store.ts` (injected `sql`, statement-shape tests) + `index.ts` barrel.
6. **Intake**: `runs` route, leaderboard route branch, `championship/[event]` and `/me` routes, with route tests.
7. **SDK 1.5.0**: `board`/`meta`, `runStart`, `supports`/`capabilities`, reasons, CHANGELOG, README, rebuild.
8. **Admin**: `app/dashboard/(app)/championship/{page,actions}.tsx`, nav entry.
9. **UI**: /fright-fest sections, homepage card slot, game panel, per-game announcement.
10. **Integration contract** for the other two games: `docs/championship-integration.md`.
11. **Last Bell staging**: the two edits in the source, staged copy for `publish-game --republish`.

Checks before calling it done: `npm run lint`, `npm test`, `npm run build`, and
the opt-in DB tests against the **dev** Neon branch only.

**Deployment (owner):** apply `048` to production *before* merging (reads fail
soft, but the intake answers 503 until the tables exist), merge, then publish
the Last Bell build. The order of the last two does not matter: an old SDK
answers `supports('leaderboard.boards')` with `undefined`, so the game sends
nothing.

## 11. Verification

- Pure rules (phase, grace, validators, ranking, points, eligibility, privacy of
  the wire shape): vitest, `app/lib/championship/*.test.ts`.
- Intake (tokens, single use, replay, expiry, grace, pause, gap, ranking): an
  in-memory store with the same guards, `intake.test.ts`.
- The SQL itself: the store bundled with esbuild and run against PGlite
  (Postgres 17 in WASM) with migration 048 applied, covering every statement
  and guard (59 checks). PGlite is not a repo dependency, so this ran as a
  one-off; `store.test.ts` pins the privacy and guard clauses in-repo. Found
  and fixed one bug: `INSERT … ON CONFLICT` checks the proposed row's CHECK
  constraint before resolving the conflict, which broke pausing a board.

## 12. Excluded

Server-side replay of runs, device fingerprinting, IP logging on runs, physical
prizes, cross-event leaderboards, team play (the modes are solo), and any
change to ordinary boards.
