# Friend challenges — design

Sibling of `tracker-design.md` and `mobile.md`: the argument for what is being
built, what is deliberately excluded, and the constraints that shaped it.

A **challenge** is a score to beat on a board, aimed at a friend. The game
triggers it through the SDK, HallPass draws the UI, and it resolves by itself
the moment the target posts a qualifying score.

---

## 1. Decisions taken without the user (they were AFK)

Recorded here because they were open questions, not settled ones:

1. **Both parts on one branch**, phased as commit order rather than two PRs.
   Push is **fail-soft when VAPID keys are absent** — the same
   graceful-when-unconfigured pattern `db.ts` uses for `DATABASE_URL`, so the
   feature ships dark and lights up when the env vars land.
2. **Discreet notifications are opt-in, default off**, per the explicit
   instruction. A cloak being active does **not** force discretion — that was
   asked as a question and never answered, so it is not assumed.
3. **You may challenge a friend on a board they have never played.**
4. **Ties do not count.** You must strictly beat the score.

---

## 2. One entity, two kinds — the seam

The requirement is that site-wide/monthly challenges become cheap later without
a rewrite. The way to get that is to stop modelling "A challenges B" and model
**a goal on a board**, with participants and time as separate nullable
dimensions:

| kind       | challenger  | target        | window        |
| ---------- | ----------- | ------------- | ------------- |
| `friend`   | set         | set           | none          |
| `seasonal` | NULL (site) | NULL (anyone) | `starts_at`/`ends_at` |

`kind` is a discriminator with a **per-kind CHECK constraint**, so a malformed
row of either kind is impossible at the database level rather than by
convention. `seasonal` is expressible and constrained; **nothing builds it.**

That distinction is the whole point. The unused `gh_*` columns in migration 021
are the in-repo example of scaffolding that reads as finished — the seam here is
three nullable columns and a CHECK, not a half-built feature.

**Resolution never branches on kind.** It asks "which open challenges does this
score satisfy for this player?" A nullable window evaluated at read time means
seasonal challenges need no sweeper either.

## 3. Constraints that shaped this

Every one of these is load-bearing and came out of reading the code:

- **No cron.** `007_social_graph.sql` says so outright. Nothing here may need a
  sweeper: no deadlines on friend challenges, and seasonal windows are evaluated
  at read time.
- **No cross-statement transactions** on the Neon HTTP driver. Every mutation is
  a single statement, following `scoreboard/store.ts:350` where the score insert
  is one CTE doing rate-limit + insert + rank.
- **Boards are decoupled from games.** `boards.game_slug` is nullable and a game
  may have several boards. A challenge targets a **board**; the UI says the game.
- **`public_id` on the wire, never `players.id`** (a Google subject — a stable
  cross-service identifier for a minor).
- **`social/config.ts` doctrine.** Never rate-limit by IP (schools NAT to one
  address); never cap inbound (a DoS aimed at the victim). Limit the sender,
  plus a per-pair cooldown.
- **`contract.ts` is append-only within v1.** New optional methods and new event
  names are allowed; changing an existing signature costs a `/sdk/v2/`.
- **`/game/[slug]` must stay statically prerendered.** One `auth()` makes it
  dynamic, drops it from `prerender-manifest.json`, and silently removes every
  game URL from the SW precache. All per-viewer data arrives from `/api/`.
- **The parent page cannot see a score submission.** The SDK posts straight to
  `/api/` and external games are cross-origin, so the win is celebrated on
  return to the page, not at the instant it happens.

## 4. Lifecycle

One row per `(challenger, target, board)` for `friend` kind, enforced by a
**partial unique index**, upserted and never deleted — so the row doubles as its
own cooldown record. Friendships needed a separate `friend_request_attempts`
table only because a decline deletes the friendship row; here nothing is deleted.

```
created  →  accepted_at (pressed Play from the inbox)  →  resolved_at (+ resolved_score)
         ↘  dismissed_at (the alternate ending)
```

All timestamps on one row. **No status enum** — there is nothing to keep in sync
with a CHECK, and "open" is `resolved_at IS NULL AND dismissed_at IS NULL`.

**Accept is implicit in pressing Play.** Consent is already covered (challenges
are friends-only), an accept gate would not stop notification spam (the buzz
already happened), and gating resolution on it would mean beating the score
after launching from the catalogue "doesn't count". `accepted_at` is a nullable
timestamp that resolution never reads — it exists so the challenger sees
"they're on it", and as a defensible basis for win/loss records later. As a
*state* it would break the seasonal kind, which nobody accepts; as a timestamp
it fits both.

**Dismiss does not report "declined" back.** `social/config.ts` deletes a
declined friend request rather than storing the status, because "children
decline by accident constantly". Same courtesy: the challenge stops being
pending and the challenger is not told they were turned down.

`target_score` is **snapshotted**, not a reference to a score row — a moderator
deleting the challenger's score must not break the challenge.

Board `sort` is **read at resolve time** via a join, not denormalised: `asc`
boards are time/golf where lower wins, and the board owns that fact.

## 5. Schema

`022_challenges.sql` — idempotent, guarded, one transaction, mirroring
`021_tracker.sql`'s style. `app/lib/challenges/schema.sql` carries the same DDL
as the fresh-install copy and must stay in lockstep.

```
challenges
  id             BIGINT identity PK
  kind           TEXT NOT NULL DEFAULT 'friend'      -- 'friend' | 'seasonal'
  board_id       TEXT NOT NULL → boards(id) CASCADE
  challenger_id  TEXT → players(id) CASCADE          -- NULL for seasonal
  target_id      TEXT → players(id) CASCADE          -- NULL = everyone
  target_score   BIGINT NOT NULL                     -- snapshot
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  accepted_at    TIMESTAMPTZ
  resolved_at    TIMESTAMPTZ
  resolved_score BIGINT
  dismissed_at   TIMESTAMPTZ
  starts_at      TIMESTAMPTZ                          -- seasonal only
  ends_at        TIMESTAMPTZ                          -- seasonal only
```

CHECKs: kind whitelist; per-kind shape (friend ⇒ both ids set and no window;
seasonal ⇒ neither id set and a window); no self-challenge; `resolved_at` and
`resolved_score` set together; `starts_at < ends_at`.

Partial unique index on `(challenger_id, target_id, board_id) WHERE kind =
'friend'` — this is what `ON CONFLICT … WHERE kind = 'friend'` infers for the
upsert. Plus a partial index for the inbox (open rows by target) and one for the
outbox.

`023_push_subscriptions.sql` — `endpoint` as PK (natural dedupe), `player_id`
CASCADE, the two keys, `created_at`/`last_seen_at`. Per-player device cap
enforced in the store.

## 6. Files

**New**
```
app/lib/challenges/config.ts          pure tunables + vocabulary (no db)
app/lib/challenges/config.test.ts
app/lib/challenges/resolve.ts         PURE: does this score beat this challenge?
app/lib/challenges/resolve.test.ts
app/lib/challenges/store.ts           Neon reads/writes
app/lib/challenges/store.test.ts
app/lib/challenges/schema.sql
app/lib/push/config.ts                pure; VAPID presence check
app/lib/push/store.ts                 subscriptions
app/lib/push/store.test.ts
app/lib/push/send.ts                  web-push wrapper, fail-soft
app/lib/push/payload.ts               PURE: full vs discreet copy
app/lib/push/payload.test.ts
app/api/v1/me/challenges/route.ts     GET inbox+outbox, POST create
app/api/v1/me/challenges/[id]/route.ts  PATCH accept/dismiss
app/api/v1/me/push/route.ts           POST subscribe, DELETE unsubscribe
app/embed/challenge/page.tsx          the popup, HallPass-styled
app/embed/challenge/ChallengeEmbed.tsx
app/components/friends/ChallengeList.tsx    the Challenges tab body
app/components/ChallengedHere.tsx     game-page chip (mirrors FriendsWhoPlay)
app/components/challenges/ChallengeToast.tsx
sdk/src/challenge.ts                  popup opener + signal listener
sdk/src/challenge.test.ts
scoreboard/migrations/022_challenges.sql
scoreboard/migrations/023_push_subscriptions.sql
```

**Changed**
```
sdk/src/contract.ts        + Challenge types, challenge?(), "challenge" event
sdk/src/client.ts          + challenge() implementation
sdk/src/index.ts           + safeDefault case for "challenge"
app/api/v1/leaderboard/[slug]/route.ts   resolve challenges after a score lands
app/components/friends/FriendsIsland.tsx + Challenges tab
app/components/GameStore.tsx             + <ChallengedHere>
app/lib/stealth/config.ts                + DEFAULT_QUIET_NOTIFICATIONS
app/lib/stealth/store.ts                 + quietNotifications pref + IDB mirror
app/components/stealth/StealthSettings.tsx + the toggle
public/sw.js               + push and notificationclick handlers
app/layout.tsx             + <ChallengeToast>
.env.example, README.md
```

## 7. Failure modes

Follows the house rules. `isMissingColumnError` → the feature renders as absent
rather than 500ing, because migrations are applied by hand and there is always a
window where code is ahead of schema (`HANDOFF.md` records migration 013 never
reaching prod). `isUnconfiguredDbError` → its own notice. Anything else rethrows;
a real Neon outage must not be disguised as an empty inbox.

**Resolution is fail-soft and must never break a score submission.** It runs
only for signed-in players, in its own try/catch, after the score has already
been recorded.

**Push is fail-soft twice over**: absent VAPID keys mean the feature reports
itself unavailable and no route 500s; a `410 Gone` at send time prunes the dead
subscription inline, which is how subscription hygiene happens without a cron.

**PWA:** `/embed/challenge` must never be precached — it is per-viewer. It is
dynamic (it calls `auth()`), so it stays out of `prerender-manifest.json`
naturally, but `sw.js`'s private-path list gets it explicitly rather than
relying on that.

## 8. Commit plan (~30)

1. design doc
2. migration 022 + schema.sql
3. challenges/config.ts + test
4. challenges/resolve.ts + test
5. challenges/store.ts — reads + test
6. challenges/store.ts — create/upsert + test
7. challenges/store.ts — accept/dismiss/resolve + test
8. contract.ts types
9. contract.ts `challenge?()` + `"challenge"` event
10. GET /api/v1/me/challenges
11. POST /api/v1/me/challenges
12. PATCH /api/v1/me/challenges/[id]
13. embed page shell
14. embed friend picker + send
15. sdk/src/challenge.ts + test
16. client.ts challenge()
17. index.ts safeDefault
18. resolution hook in the score route
19. ChallengeList component
20. FriendsIsland Challenges tab
21. ChallengedHere chip
22. GameStore wiring
23. ChallengeToast + layout
24. migration 023
25. push/config + payload + tests
26. push/store + test
27. push/send
28. sw.js push + notificationclick
29. /api/v1/me/push
30. stealth pref + IDB mirror
31. StealthSettings toggle
32. FeaturePromo permission ask
33. README + .env.example

## 9. Deliberately excluded

Win/loss records and rivalries; deadlines and rematches; group/open challenges;
markdown; realtime; a notification for anything other than being challenged.
Ties do not count. Nothing builds the `seasonal` kind.
