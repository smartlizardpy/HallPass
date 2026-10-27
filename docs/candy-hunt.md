# Candy Hunt: plan

Halloween Candy is earned by playing during Fright Fest 2026 and spent on
everyday packs. The owner decided every rule below on 26 Oct. Where this plan
fills a gap, the gap is listed under **Assumptions**.

Two pull requests:
- **This one (backend, catalogue, dashboard)** is built from `main`.
- **The Candy Hunt section on `/fright-fest`** follows once the event hall
  (`feature/fright-fest-hall`) is merged.

## 1. Plan what

### Earning
Everything is recorded on the server. Candy is earned only while the event runs:
from 28 Oct 00:00 to 3 Nov 00:00 UK, which is the championship's `opensAt` to
`closesAt`. (The owner added Mon 2 Nov on 27 Oct; it was 2 Nov 00:00 before.)

1. **Your best score of the day, ranked on the leaderboard.** (Decided 26 Oct,
   replacing achievements, which are self-reported and easy to fake.)
   - **Which boards:** any board that belongs to a game and has a candy value
     above 0. A super admin sets each board's value (0 to 40) on the Candy desk,
     using the owner's rubric. The default is 0, which pays nothing until the
     board is rated. The value is the payout for a rank-1 daily best; the rank
     tiers scale it.
   - **Whose scores:** only signed-in players'. An anonymous, handle-only score
     never earns, but it still counts on the board when ranking.
   - **The daily best:** for each (player, board, UK calendar day) inside the
     earning window, the player's best row that day, in the leaderboard's own
     order (the board's sort, then the earlier `created_at`, then the lower id:
     `app/lib/scoreboard/rank.ts`). Days are UK days
     (`Europe/London`); the window is six of them, 28 Oct to 2 Nov.
   - **Its rank is the rank it held when it was set,** on the Halloween board:
     `1 + the rows strictly better than it with created_at >= opensAt and
     created_at <= its own`. This is `rankForScore`'s rule (strictly-better
     rows, competition-style ties) restricted to rows that existed then, so it
     is the rank the site showed the player and a later score never changes a
     payout. `N` is the number of rows in that same span.
   - **During Fright Fest the leaderboards show only scores set in the event
     window,** so the rank counts only rows from `opensAt` on. A strong score
     from before 28 Oct never counts, not even for ranking, and cannot push an
     in-window best down. (The candy SQL applies this itself; it does not rely
     on the scoreboard code.)
   - **The share, by rank:**

     | Rank | Share |
     |---|---|
     | 1st | 100% |
     | 2nd–3rd | 75% |
     | 4th–10th | 50% |
     | Top half (rank ≤ ceil(N/2)) | 25% |
     | Anywhere else on the board | 5% |

   - **The amount** is integer maths, the same in TypeScript and SQL:
     `max(1, (value * share + 50) / 100)` with integer division, when the value
     is above 0. A 40-candy board pays 40 / 30 / 20 / 10 / 2. A 2-candy clicker
     pays 2 / 2 / 1 / 1 / 1.
   - **One credit per player per board per day.** Award key
     `candy:<event>:daily_best:<playerId>:<boardId>:<YYYY-MM-DD>`; the ledger
     `ref` is `<boardId>#<YYYY-MM-DD>#<rank>`.
   - **Paid once the UK day is over** (owner decision, 26 Oct). The sync only
     credits finished UK days, by the database clock, so a day's candy lands on
     the first sync after midnight UK time. The first build paid on any sync, so
     a visit to `/fright-fest` mid-day locked in the best score so far, and a
     better score later that day earned nothing extra. The section tells players
     the candy arrives after midnight.
   - **Valued at sync time.** Rating a board after players scored still pays
     those earlier days in the window at the next sync. Changing a value never
     re-prices a credit already made.
   - **The owner's rubric** (for choosing a board's value):

     | Game | Candy |
     |---|---|
     | Doesn't pay | 0 |
     | Clicker or idle game | 2 |
     | Easy game | 5 |
     | Normal game | 8–12 |
     | Challenging game | 15–20 |
     | Difficult game | 25–30 |
     | Exceptional game | 40 |

   - **Achievements pay nothing.**
2. **Fright Fest ranked runs.**
   - A player's first accepted ranked run on each counting board pays **10**.
   - A result on every board pays **+20**, once, when the championship is
     finalised: the player's overall entry in the frozen final standings is
     `eligible`. It is not paid from live boards, so one early run on a single
     open board earns the 10 for that board and nothing more.
3. **Placing,** paid once results are final (phase `finalised`), on each board:
   - **1st: 40**
   - **2nd–3rd: 30**
   - **4th–10th: 20**

### Spending
Candy can be spent from 28 Oct until **30 Nov 2026, 23:59 UK**. After that,
unspent candy expires. The date is shown everywhere candy appears.

| Price | Packs |
|---|---|
| 30 candy | The four everyday packs as they are: HallPass Originals, Internet Culture, Brainrot, Turkish Internet Culture (3 cards, standard odds) |
| 100 candy | **Four new Rare packs**, one per everyday collection. Slot 1 is one card from the collection at standard odds (60/25/10/4/1). Slots 2 and 3 are each one card from the collection at the already published rare-or-better odds (75% rare, 20% epic, 5% legendary). |

- A bought pack is granted sealed into the player's Pack Room (`/packs`)
  through `collectiblesStore.grantPack`, with `source: 'event'`.
- It opens like any other pack.
- The new packs appear in "What's in each pack" with their odds, like every
  pack.

### Rules
These amend collectibles decision 1, "no currency", for this one token.
- Candy is earned only by playing.
- It is never sold.
- It has no cash value.
- It can't be traded or gifted.
- It is spent only on packs, at published prices and published odds.
- It expires on 30 Nov.

### Integrity
- **The ledger is append-only.** Every credit carries a unique award key, so
  syncing twice never pays twice.
- **A spend is atomic with its grant.** It is one transaction behind a
  per-player advisory lock, with no overspending and an idempotent request id
  so a double-tap can't buy twice.
- **Scores are submitted by games, not verified by the server,** so the Candy
  desk's top earners show daily-best totals and the best rank reached.
  - A super admin can revoke any credit, with a reason and an audit row.
  - A balance can then go negative, which blocks spending until it's positive.
  - If a board's only accepted runs are later rejected or disqualified, the
    next sync revokes that run credit.
- **Changing a board's value never re-prices** credits already made.

### Deliberately excluded
- Buying candy.
- Gifting or trading candy.
- Daily rewards and streaks.
- Earning candy from plays or launches.
- Candy outside Fright Fest 2026.
- Any change to existing pack versions or odds.
- Deploying, and running migrations on production. The owner runs
  `scripts/migrate-prod.sh`.

### Assumptions
- Only scores set during the window count, for earning and for ranking.
  Earlier scores don't, so veterans get no windfall from history.
- Values are capped at 40 by the database, the rubric's maximum.
- Each run, all-boards and placing amount is a single config value
  (`app/lib/candy/fright-fest-2026.ts`), changed by commit.

## 2. Plan how

1. **Docs.**
   - This file as `docs/candy-hunt.md`.
   - Amend decision 1 and §9 of `docs/collectibles-design.md` to allow
     Halloween Candy on the terms above.
   - Note in the PR that `docs/dpia.md` may need a line for the new ledger. Do
     not edit the DPIA itself.
2. **Migration** `app/lib/scoreboard/migrations/050_candy.sql`, with fresh-install
   DDL in lockstep (`app/lib/scoreboard/schema.sql`, and a new
   `app/lib/candy/schema.sql`):
   - `boards.candy SMALLINT NOT NULL DEFAULT 0`, CHECK 0–40 (it was
     `achievements.candy` in the first draft; 050 was unreleased, so it was
     edited in place).
   - `candy_ledger`:
     - id, `player_id` → players (CASCADE), `event_id`;
     - `amount` (signed; credits > 0, spends < 0);
     - `kind` CHECK (`daily_best`, `ranked_run`, `all_boards`, `placing`,
       `spend`);
     - `award_key` UNIQUE;
     - `ref` (board#day#rank, board slug, slug#rank or pack id);
     - `player_pack_id` for spends;
     - `created_at` (db `now()`);
     - `revoked_at`, `revoked_by`, `revoked_reason`;
     - an index on (player, event).
   - `candy_log`: the admin audit, shaped like `collectibles_log`.
3. **Catalogue.** Append the four Rare packs (new ids, version 1, existing odds
   tables), update `catalogue.lock.json` the way the lock test requires, and
   add pack prints if the print pipeline needs them (document what is missing).
4. **`app/lib/candy/`:**
   - Config: window, spend-by date, prices by pack id, run/all-boards/placing
     amounts, the daily-best shares and the rubric tiers for the dashboard.
   - Store, injected `sql` as in `collectibles/store.ts`:
     - `sync(playerId)` inserts every missing credit with `ON CONFLICT DO
       NOTHING`, plus run revocations;
     - `balance`;
     - `history`;
     - `spend(playerId, packId, requestId)`;
     - admin `setBoardCandy`, `revokeCredit`, and lists.
   - Tests with a fake `sql`.
   - An opt-in `store.db.test.ts` for spend concurrency and no-overspend, gated
     like `p2p/store.db.test.ts`.
5. **API:**
   - `GET /api/v1/candy/me`: `private, no-store`, same-origin, signed out →
     `{signedIn:false}`. It syncs, then returns:
     - balance, spend-by and whether spending is open;
     - recent credits (game and day, never another player);
     - the shop (pack id, price, affordable).
   - `POST /api/v1/candy/spend {packId, requestId}`:
     - 403 cross-site, 401 signed out, 409 not enough candy, 410 spending
       closed, 400 bad pack;
     - on success, the new balance and the sealed pack's public id.
   - Route tests in the style of the existing championship and collection
     route tests.
6. **Dashboard `/dashboard/candy`,** super admin only (`requireRole("super_admin")`
   on the page and every action):
   - every game's boards with their candy value, set by rubric presets or a
     number;
   - a filter by game and a count of boards paying 0;
   - recent credits and spends;
   - revoke a credit with a reason;
   - an audit log.
   - Nav: add it to `SUPER_ADMIN_ITEMS`. Another PR (#178) is moving
     Collectibles into that list, so expect a trivial merge.
7. **Checks:** `npm run lint`, `npm test` and `npm run build` against the
   baseline, which is lint errors only in `public/games/last-bell/*` and test
   failures only in `console-capture.test.ts` and `streak-event.test.ts`.
   Migrations: `npm run migrate -- --status`, then `npm run migrate`, which
   applies to the **dev** Neon branch that `.env.local` points at. Never touch
   production; `scripts/migrate-prod.sh` is the owner's.

## 3. As built (backend, catalogue and dashboard)

Decisions made while building, inside the plan above.

- **Sync pulls, nothing pushes.** `sync(playerId)` reads scores and accepted runs
  and inserts what the ledger lacks. It runs on every `GET /api/v1/candy/me`, in
  one transaction behind the player's advisory lock.
- **Run credits revoke and restore automatically.** If a board has no accepted run
  left for the player, its 10 is revoked (`revoked_by = 'system'`); if an accepted
  run returns, only a system revocation is restored. An admin's revocation stays.
- **The all-boards bonus is paid from the frozen snapshot, like placings.** Once
  the status is `finalised` or `archived`, a player whose entry in
  `final_standings->'overall'` has `eligible = true` gets the 20, once (same
  award key). It is never paid from live boards, because while only one board is
  open a single run would otherwise earn "a result on every board". Paid from
  verified final results it is final, so there is no clawback logic; an admin can
  still revoke one by hand.
- **Placings come from the frozen snapshot**, never live standings, and only once
  the championship status is `finalised` or `archived`. The ledger `ref` is
  `<board slug>#<rank>`.
- **Top earners is how a forger is found.** Scores are self-submitted by games,
  so the newest-50 feed will not surface a cheater. `/dashboard/candy` lists the
  top 25 players by unrevoked credited candy (public name and id only) with their
  daily-best total and count, best rank, spend and balance, each linking to
  `?player=<publicId>` which shows all of that player's credits for revocation.
- **"Unrated" means 0.** The column defaults to 0 and the rubric's "Doesn't pay"
  is also 0, so the dashboard counts boards that pay nothing.
- **A sealed pack bought with candy that an admin later revokes is not refunded**
  by code; an admin credits the candy back by granting the pack again or by an
  explicit decision. Spends cannot be revoked.
- **Rare pack prints are derived** from the standard prints by
  `scripts/make-rare-pack-prints.py` (gold RARE plate and foil frame), not
  hand-drawn.
- **Applying it.** Migration `050_candy.sql` needs 048 and 049 before it. The
  owner runs `scripts/migrate-prod.sh`. `docs/dpia.md` may need a line for the new
  ledger (not edited here).

### As built: daily best replaces achievements (26 Oct)

The owner changed how candy is earned before anything shipped. Migration 050 was
edited in place (it was only on the DEV branch); the DEV database was reset by
dropping `candy_log` and `candy_ledger`, dropping `achievements.candy`, deleting
the `050_candy.sql` row from `schema_migrations` and re-running `npm run migrate`.

- **The rules are in the Earning section above.** The code is one SQL statement
  in `sync`, behind the same transaction and advisory lock as before, with
  `DISTINCT ON (board, UK day)` for the best row and a join to `scores` for the
  rank and `N`. The pure helpers `dailyBestPct` and `dailyBestAmount` in
  `fright-fest-2026.ts` encode the same tiers; the DB test checks the two agree.
- **Rank as of submission, on the Halloween board.** Ranking against rows that
  existed at the time keeps the payout equal to what the player saw and stable
  against later scores. Restricting those rows to the event window matches the
  leaderboards, which show only event scores during Fright Fest: the ranking is
  done in the candy SQL, not by changing `app/lib/scoreboard`.
- **A board id over 120 characters never pays** (the ledger `ref` and award key
  have length checks). Board ids are slugs, so this does not arise.
- **`GET /api/v1/candy/me`** has `rules.maxGameCandy` (40) in place of
  `maxAchievementCandy`, `rules.dailyBest` (the five shares), and `games`
  (`boardId`, `slug`, `title`, `boardTitle`, `candy` for every rated board,
  highest first; public). Daily-best entries in `recent` have `kind:
  "daily_best"`, a label like "Best score on 29 Oct · 3rd" and `game` set to the
  game title.
- **The Candy desk** lists boards (game, board, sort, scores and signed-in
  players in the window, value) and top earners show the daily-best total, count
  and best rank. "Max unlocks per minute" is gone. Recent credits read
  "<game> · <date> · <ordinal rank>".
- **Revocation** stays manual: scores are append-only, so there is no automatic
  clawback for daily bests.
- **Out of this change:** the copy on the `/fright-fest` Candy Hunt section still
  describes achievements and is updated with its restyle.

## 4. The section on /fright-fest (plan)

What players see and use on the event page. It ships in the Fright Fest 2026 PR
together with the hall and the backend.

- **The noticeboard** in the hall becomes a link to `#candy`
  (`CANDY_HUNT_OPEN = true`). The server renders the neutral words "Candy Hunt"
  (the page is static); a small client island adds the status from the clock and
  the candy config dates: "from 28 Oct", "open", "spend by 30 Nov", "over".
- **The `#candy` section** sits after "Your Fright Fest" and before "How Fright
  Points work". `FrightFestSections` takes an optional `afterProgress` slot that
  `page.tsx` fills, so the championship components import no candy code.
  Contents: heading and one line, your candy (balance, "+N new", recent), how to
  earn, the Candy Shop (30 and 100 candy shelves), the rules. (Since the
  restyle it is the last object on the page, after the rules notice.)
- **Buying** is an inline confirm in the item, not a modal. A `requestId` is
  minted when the confirm opens and reused for retries of that purchase.
  Every spend status (200 incl. `alreadySpent`, 400, 401, 409, 410, 503/network)
  has its own words; buttons carry a visible reason when disabled.
- **Static.** All live data is a client fetch of `/api/v1/candy/me` after
  hydration; the server render shows rules, the earn table and prices only.
- **Where the code lives:** `app/fright-fest/hall/candy/` (props, logic, island,
  css), because it belongs to the event page and not to the championship.
- **Excluded:** any change to the candy API, store, schema or dashboard; new art;
  changes to `/packs`.

### As built: the section on /fright-fest

Code is in `app/fright-fest/hall/candy/` (the event page's own folder, not
`components/championship`, which stays free of candy imports): `props.ts`
(server-built plain props from the candy config and catalogue), `logic.ts`
(phase, noticeboard words, button states, spend-response wording; unit-tested),
`CandyHunt.tsx` (the island), `CandyStatus.tsx` (the noticeboard status) and
`candy.css` (the shelf grid only). `FrightFestSections` takes an `afterProgress`
slot that `page.tsx` fills; `CANDY_HUNT_OPEN` is now `true`; the plate links to
`#candy`; `sections.css` frames `#candy` like the prize frame under the haunted
skin. It ships in the Fright Fest 2026 PR with the hall and the backend.

Decisions:
- `/fright-fest` stays static. The server render has the rules, earn table and
  shop with prices; `GET /api/v1/candy/me` is fetched after hydration.
- The phase comes from the API's `earn.open` / `spend.open` flags once they have
  arrived, and from the device clock (to the minute) before that. Display only;
  the database clock decides a spend.
- Buying is an inline confirm. The `requestId` is minted when it opens and kept
  for retries of that purchase (a 503 or a dropped connection keeps the confirm
  open with "Try again"). Escape and Cancel return focus to the item's Buy button.
- After a successful buy `/me` is read again quietly to refresh "Recent" (this
  runs the sync again, which is idempotent).
- A shelf item's affordability is computed from the balance and the static price,
  not read from the API's `shop`.
- The "+N new" badge shows the amount of candy credited by that load.

Known issues:
- The noticeboard status comes from the device clock, so a wrong device clock can
  show the wrong word there (the section's buttons use the server's flags once
  they arrive).
- Pack names on the shelves come from the catalogue as they are.

### As built: the section after the daily-best rules (27 Oct)

The "How to earn" part of `#candy` now says the daily-best rules, not
achievements. It has four pinned notices:

- **Your best score each day.** One plain paragraph (once a day your best score in
  each rated game is ranked on that game's Halloween leaderboard; only scores set
  from 28 Oct count) and the five bands as candy for a 40-candy game
  (1st 40, 2nd-3rd 30, 4th-10th 20, top half 10, on the board 2), then "Easier
  games pay less." The amounts are computed on the server in `props.ts`
  (`buildCandy`) with `dailyBestAmount` from the config's `maxGameCandy`; nothing
  is typed in the component. `DAILY_BEST_PROBE` picks one rank inside each band.
- **Games that pay.** The `games` array of `GET /api/v1/candy/me` (rated boards,
  best payers first; returned to signed-out visitors too): each title links to
  `/game/<slug>`, a board title that differs is small text, at most 8 rows with a
  "Show all (N)" toggle (`aria-expanded`). Loading shows a fixed-height skeleton,
  an empty list says "Games are being rated. Check back on 28 Oct."
- **Fright Fest ranked runs** and **Final results**, unchanged.

`config.rubric` is an admin tool (the dashboard's presets) and is no longer passed
to the section: `CandyProps.rubric` and its test are gone. `CandyProps` gained
`dailyBest`, `maxGameCandy` and `printPx` (`PACK_PRINT_PX`, 96x140).

Shelf prints were drawn at 72x105 (about 0.75x, uneven pixels). They are now
drawn at exactly 96x140, pixelated, at every width (two per row fit at 390). The
reward tickets already drew their prints at 96x140.
