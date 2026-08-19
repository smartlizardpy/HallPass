# Friends on the leaderboard — design

Sibling of `challenge-design.md`, `discovery-design.md` and `marketing-design.md`:
what is being built, what is deliberately excluded, and the constraints that
shaped it.

The ask was "what can we add?", answered with "the simple one". Four candidates
were put up; this is the smallest of them, and it is small for a specific
reason: **the missing piece is a `JOIN`, not a system.** `friendships`,
`boards.game_slug`, `scores` and `players` all live in the same Neon database
and have never once been read together.

---

## 0. What is being built

On `/game/<slug>`, a signed-in player sees **where they and their friends stand
on that game's board** — a short table of the friend set only: rank, who, best
score. Nobody else's scores appear.

That is the whole feature. It is one store method, one credentialed endpoint,
one client island, and one mount point.

## 1. Why this, of the four

**Because the data is already there and nothing renders it.** A leaderboard on
this site is visible in exactly two places today: inside the game frame (drawn by
the game itself through the SDK) and on `/play/you` (your own boards, as a list
of your ranks). `/game/<slug>` — the page a shared link lands on, the page with
the Play button — shows **no standings at all**.

**Because the social graph and the scoreboard have never met.** `grep -n friend
app/lib/scoreboard/*.ts` returns nothing. We have friends, friend requests,
friend codes, "friends who play this", friend challenges and challenge links —
all of it built around a leaderboard that cannot be scoped to the people you
know. A global top-10 is a wall of strangers; the same board filtered to four
people you sit next to is a race.

**Because it needs no migration.** `007_social_graph.sql` and
`001_decouple_boards.sql` are both long since applied. Nothing here is dark
waiting on a `npm run migrate` — which, given §7, matters.

## 2. Decisions

### 2a. The rank shown is the GLOBAL rank, with the repo's existing semantics

Each row prints the player's rank **on the whole board**, not their position
within the friend set. Their position among friends is the row order.

Global, because "you are 2nd of 3 friends" is a fact about your friends and
"you are 41st" is a fact about you — and the second one is the one that makes the
first worth reading. Both are on the row: the order says who is winning between
you, the number says what that is worth.

The rank is computed as **`1 + strictly-better rows`**, character for character
the semantics of `rankForScore` and `getPlayerStandings`. That count is over
*rows*, not distinct players, so a board where one player holds several better
scores reports a rank higher than the position they occupy on the rendered
leaderboard (which collapses to one row per player via `DISTINCT ON`).

**This is a known inaccuracy and it is inherited on purpose.** `/play/you`
already prints that exact number for that exact player on that exact board. A
more accurate count here would mean two HallPass surfaces disagreeing about one
person's rank, which is a worse bug than the one being inherited — a reader can
absorb "the rank counts attempts"; they cannot absorb two different answers.
Fixing it is a single-line change in two places (`count(DISTINCT …)` over the
collapsed set) and should be done to both at once or to neither.

### 2b. It includes you

A ranking of your friends that omits you is not a race, it is a spectator sport.
Your row is marked and never dropped.

### 2c. Every board the game has, not just the first

`boards.game_slug` is a link, not a key — a game may carry several boards, and
`listBoardsForGame` already returns them. Rendering only the first would quietly
claim a game has one leaderboard when it has three. Boards with no score from
anyone in the friend set are omitted entirely rather than shown empty.

### 2d. Anonymous scores cannot appear, by construction

The join keys on `scores.player_id`, which is `NULL` for a guest submission. A
friend who scored while signed out is not in the friend set for that score,
because that score belongs to nobody. This is the same rule the rest of the site
plays by, and it is the reason `POST /api/v1/me/claim` exists.

### 2e. No block filter, for the same reason `friendsPlaying` has none

Blocking DELETEs the friendship row, so an accepted friendship and a block cannot
coexist. This is a property of `007_social_graph.sql`, restated here so the next
reader does not "fix" its absence.

### 2f. Nothing new is disclosed

Every score in the panel is already public on `/api/v1/leaderboard/<board>` with
its handle attached. The panel reorders public data for one viewer; it does not
reveal a private one. Profile visibility is therefore not consulted — the same
call `FriendsWhoPlay` makes, and for the same reason.

### 2g. A client island, and it has to be

`/game/[slug]` must stay statically prerendered. One `auth()` on that page makes
the route dynamic, drops it from `prerender-manifest.json`, and therefore drops
every `/game/<slug>` from the service-worker precache — silently breaking offline
play with no error anywhere. This is written into `FriendsWhoPlay`,
`GameAchievements` and `friends/activity`; it applies here unchanged.

It follows that the panel is **offline-blind**: the SW never intercepts `/api/`,
the fetch simply rejects, and the island renders nothing. No spinner (it would
spin forever) and no banner (it would appear on every game page, including the
ones with no board at all).

## 3. Deliberately excluded

- **A `?scope=friends` parameter on `/api/v1/leaderboard/<board>`.** That route
  answers `Access-Control-Allow-Origin: *` and carries no credentials on
  purpose, because games call it cross-origin. Adding a per-viewer scope to it
  means credentialed CORS for arbitrary game origins — a materially larger
  security surface than this feature is worth. The per-viewer read lives at
  `/api/v1/me/…`, where every other credentialed read on this site lives.
- **An SDK method,** for the same reason: the friend set is not something a game
  should be able to enumerate.
- **A "your friend passed you" notification.** It is a genuine idea and it is a
  new notification kind with a producer, a preference default and copy in two
  renderings (see `notifications-design.md` on quiet mode). Out of scope for the
  small option; nothing here forecloses it — the producer would hang off the
  same score-submission path that already resolves challenges.
- **A friends filter inside the game frame.** The game draws its own board.

## 4. The shape

```
app/lib/scoreboard/config.ts     FRIEND_BOARD_ROWS, FRIEND_BOARD_MAX_BOARDS
app/lib/scoreboard/store.ts      getFriendStandingsForGame(playerId, gameSlug)
app/lib/scoreboard/store.test.ts branch + mapping tests against the fake sql
app/api/v1/me/friends/scores/    GET ?slug=<game>, credentialed, no-store
app/components/friends/FriendsBoard.tsx   the island
app/components/GameStore.tsx     mounts it beside the other personalised islands
```

One query, one round trip: a `pool` CTE (me ∪ my accepted friends), a `bests` CTE
collapsing each pool member to their personal best per board, and an outer select
that joins the board for its title/sort/label and the player for their display.
`sort` is branched inside `CASE` expressions over the **stored** column, never
spliced — the load-bearing SQL rule of every store in this repo.

## 5. Phasing

1. Design (this file).
2. Config bounds + the store method.
3. Its tests.
4. The endpoint.
5. The island.
6. The mount + README.

## 6. What this does NOT solve

The catalogue is still 30 games, which every design doc in this repo has now said
in turn. A friends board makes a title people already play more competitive; it
does not create a title. It also does nothing for a player with no friends added
— for them the island renders nothing at all, which is the honest outcome and
also the argument for why the friend-code and search surfaces came first.

## 7. Migrations — flagged, not applied

Per the ask, this is a flag and nothing more. `HANDOFF.md` records that
`013_game_videos.sql` was never applied to the database the app runs against, so
"Save video" fails on **every** game, not only external ones. Migrations 021–025
each gate a shipped feature (tracker, challenges, push, notifications, challenge
links) and degrade to empty when absent. This container has no `DATABASE_URL` and
cannot check or apply any of them.

**This feature needs none of them.** It reads only tables from `001` and `007`.
