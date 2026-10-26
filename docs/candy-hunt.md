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
from 28 Oct 00:00 to 2 Nov 00:00 UK, which is the championship's `opensAt` to
`closesAt`.

1. **Achievements.** Every game achievement a signed-in player unlocks during
   the window pays that achievement's **candy value**.
   - A super admin sets the value per achievement on the dashboard.
   - The default is 0, which pays nothing until the achievement is rated.
   - The owner's rubric weighs difficulty, effort, skill and farmability:

     | Achievement | Candy |
     |---|---|
     | Launch a game | 0 |
     | Basic clicker milestone | 2 |
     | Easy game completion | 5 |
     | Normal achievement | 8–12 |
     | Challenging score or victory | 15–20 |
     | Difficult achievement | 25–30 |
     | Exceptional achievement | 40 |

   - An achievement unlocks once, so it pays at most once per player.
   - Rating an achievement after a player unlocked it during the window still
     pays them. The credit is made the next time that player's candy is synced.
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
- **Achievements are reported by games, not verified by the server.**
  - A super admin can revoke any credit, with a reason and an audit row.
  - A balance can then go negative, which blocks spending until it's positive.
  - If a board's only accepted runs are later rejected or disqualified, the
    next sync revokes that run credit.
- **Changing an achievement's value never re-prices** credits already made.

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
- Only unlocks during the window count. Earlier unlocks don't, so veterans get
  no windfall from history.
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
   DDL in lockstep (`app/lib/achievements.sql`, and a new
   `app/lib/candy/schema.sql`):
   - `achievements.candy SMALLINT NOT NULL DEFAULT 0`, CHECK 0–40.
   - `candy_ledger`:
     - id, `player_id` → players (CASCADE), `event_id`;
     - `amount` (signed; credits > 0, spends < 0);
     - `kind` CHECK (`achievement`, `ranked_run`, `all_boards`, `placing`,
       `spend`);
     - `award_key` UNIQUE;
     - `ref` (slug/key/board/pack id);
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
     amounts, the rubric tiers for the dashboard.
   - Store, injected `sql` as in `collectibles/store.ts`:
     - `sync(playerId)` inserts every missing credit with `ON CONFLICT DO
       NOTHING`, plus run revocations;
     - `balance`;
     - `history`;
     - `spend(playerId, packId, requestId)`;
     - admin `setAchievementCandy`, `revokeCredit`, and lists.
   - Tests with a fake `sql`.
   - An opt-in `store.db.test.ts` for spend concurrency and no-overspend, gated
     like `p2p/store.db.test.ts`.
5. **API:**
   - `GET /api/v1/candy/me`: `private, no-store`, same-origin, signed out →
     `{signedIn:false}`. It syncs, then returns:
     - balance, spend-by and whether spending is open;
     - recent credits (achievement name and game, never another player);
     - the shop (pack id, price, affordable).
   - `POST /api/v1/candy/spend {packId, requestId}`:
     - 403 cross-site, 401 signed out, 409 not enough candy, 410 spending
       closed, 400 bad pack;
     - on success, the new balance and the sealed pack's public id.
   - Route tests in the style of the existing championship and collection
     route tests.
6. **Dashboard `/dashboard/candy`,** super admin only (`requireRole("super_admin")`
   on the page and every action):
   - every achievement across games with its candy value, set by rubric
     presets or a number;
   - a filter by game and an "unrated" count;
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

- **Sync pulls, nothing pushes.** `sync(playerId)` reads unlocks and accepted runs
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
- **"Unrated" means 0.** The column defaults to 0 and the rubric's "Launch a
  game" is also 0, so the dashboard counts achievements that pay nothing.
- **A sealed pack bought with candy that an admin later revokes is not refunded**
  by code; an admin credits the candy back by granting the pack again or by an
  explicit decision. Spends cannot be revoked.
- **Rare pack prints are derived** from the standard prints by
  `scripts/make-rare-pack-prints.py` (gold RARE plate and foil frame), not
  hand-drawn.
- **Applying it.** Migration `050_candy.sql` needs 048 and 049 before it. The
  owner runs `scripts/migrate-prod.sh`. `docs/dpia.md` may need a line for the new
  ledger (not edited here).
