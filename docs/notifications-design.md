# Notifications — design

Sibling of `challenge-design.md` and `tracker-design.md`: the argument for what
is being built, what is deliberately excluded, and the constraints that shaped
it.

A **notification** is one thing that happened which somebody asked to be told
about. It always lands in the **bell** — the in-app inbox in the header — and
*may* additionally leave the browser as a **Web Push**, depending on the kind
and on a per-player preference.

---

## 1. What already existed, and what did not

Migration `023_push_subscriptions.sql` shipped a complete Web Push **transport**:
a per-device subscriptions table, VAPID config that tolerates absent keys, a
send path that prunes dead endpoints inline, and a service worker that picks
between a full and a discreet rendering of the copy.

What it had **no product layer for**:

- No way to turn notifications on except a promo modal that only appeared *after*
  somebody had already been challenged — so the feature was invisible to anyone
  who had not yet used it.
- No notion of notification **kinds**, and therefore nothing to have a preference
  *about*.
- **Nothing was ever stored.** A push was fired and forgotten. Miss the banner
  and the event was gone, which is why an inbox could not have been built on top
  of it without new state.
- One producer (challenges) and no others.

This design adds the product layer and leaves the transport almost untouched.

---

## 2. Decisions taken with the user

1. **Everything end-to-end in one pass** — schema, preferences, bell, page and
   the real producers — rather than a foundation with an empty bell. A bell that
   is always empty teaches people to stop looking at it.
2. **Admin spike alerts are explicitly out of scope this pass.** See §7.
3. **The bell sits in the header on mobile too**, beside the streak chip, rather
   than hiding inside `/play/you`.
4. **Producers wired:** social (challenges, friend requests, accepts), game
   drops, achievements, beta assignments, and admin moderation events.

---

## 3. Constraints that shaped this

Every one is load-bearing and came out of reading the code:

- **No cron.** `007_social_graph.sql` says so outright, and `push/store.ts`
  relies on it. Nothing here may need a sweeper — which decides retention (§6)
  and rules out spike detection (§7).
- **No cross-statement transactions** on the Neon HTTP driver. Every mutation is
  a single statement, following `push/store.ts`'s subscribe-and-cap CTE.
- **A service worker cannot read `localStorage`.** The stealth preferences live
  there, so a push payload must carry *both* a full and a discreet rendering and
  let the device choose. `push/payload.ts` established this; every new kind must
  honour it, so **every kind ships discreet copy** (§5).
- **The header is a horizontal budget.** `SiteHeader`'s docblock spells out that
  every control costs search-field width. The bell is one 44px circle and is not
  allowed to grow a label.
- **Schema is applied by hand**, and `HANDOFF.md` records a live case where a
  migration never reached production. Every read here is fail-soft: a database
  with no `notifications` table renders an empty bell, never a 500.

---

## 4. The data model

Three tables, in `024_notifications.sql`.

### `notifications` — what happened

One row per notification, with **`player_id` nullable**:

| `player_id` | meaning                                                    |
| ----------- | ---------------------------------------------------------- |
| set         | personal — this happened *to you*                           |
| `NULL`      | **site-wide broadcast** — this happened, and it is for everyone |

**Why a nullable owner rather than fanning out one row per player.** A game drop
is aimed at the entire site. Fanning out writes `O(players)` rows for a single
event, and — with no cron to prune with — that cost is paid permanently, for
every player who ever registered, including the ones who never came back. One
row plus a read-time union is `O(1)` to write and cannot grow that way.

The cost is honest: a broadcast cannot carry per-player state, which is what
decides the read model below.

**`dedupe_key` with a partial unique index** is how a producer says "this event
has an identity". Marking a game New, un-marking it and marking it again is one
drop, not three, because the key is `game_drop:<slug>` and the insert is
`ON CONFLICT DO NOTHING`. Producers with no natural identity leave it `NULL`,
which the partial index ignores — so "no key" means "never deduped" rather than
"collides with every other keyless row".

### `notification_state` — how far you have read

One `seen_at` timestamp per player. **Unread = anything created after it**, for
personal rows and broadcasts alike.

**Why a watermark and not a `read_at` per row.** A broadcast is one shared row
and physically cannot carry a per-player `read_at` without the fan-out table
that §4 just rejected. Given the read model has to work for broadcasts by
timestamp anyway, having a *second*, different mechanism for personal rows buys
inconsistency rather than capability. One rule — "unread means newer than your
mark" — covers both, and it is what the bell badge actually needs.

What it costs, stated plainly: **you cannot keep one notification unread while
dismissing its neighbours.** Opening the bell clears the badge for everything.
That is what the bells people are used to already do, and the per-item "new" dot
still renders from `created_at > seen_at`, so nothing is lost visually. A
`read_at` column can be added later for personal rows without changing what the
watermark means.

### `notification_prefs` — what you want to hear about

`(player_id, kind) → channel`, and **sparse**: a row exists only where a player
has *deviated* from the kind's default.

**Why sparse.** The alternative is materialising every kind for every player at
signup, which means a backfill every time a kind is added and a schema where
"this player has no opinion" is indistinguishable from "this player was created
before this kind existed". With defaults living in code (§5), a new kind is live
for everybody the moment it deploys, with no migration.

---

## 5. Kinds live in code, not in the database

`app/lib/notifications/config.ts` is the single catalogue. Each kind declares
its audience, its group on the settings page, its label and description, its
default channel, whether push is offerable at all, and whether it is personal or
a broadcast.

**There is no `kinds` table.** A kind is not data an admin edits — it is a
branch of the program, with a producer that has to be written and copy that has
to be worded. Putting it in the database would let somebody create a kind that
nothing can ever emit, and it would put the *defaults* — which are a product
judgement — behind a migration.

The channels are an ordered three:

| channel | means                          |
| ------- | ------------------------------ |
| `off`   | do not tell me at all          |
| `bell`  | inbox only                     |
| `push`  | inbox **and** buzz my phone    |

`push` implies `bell`. There is deliberately no "push but not inbox": a push
notification that leaves no trace is a message you cannot go back and re-read.

**Defaults are chosen per kind, and the loud ones are the ones about you.** A
friend challenging you defaults to `push`; a game drop defaults to `bell`,
because it fires for the whole site at once and a default-on push for everybody
is how an arcade teaches people to disable notifications entirely. Push for
drops is one toggle away for anyone who wants it.

**Every kind ships discreet copy.** The stealth argument in `push/payload.ts` is
not challenge-specific — a banner reading "You unlocked *Duskfall: Deathless*"
during a lesson is exactly the thing the panic key exists to prevent. So the
generic payload builder takes both renderings and refuses to guess.

**Admin kinds are resolved at send time**, never stored as an audience on the
player. Delivery asks who the admins are *now* — `dashboard_users` plus the
`SUPER_ADMIN_EMAILS` allow-list — and maps those emails to player rows. Somebody
who stops being an admin stops being told, without a cleanup step. An admin with
no arcade account simply has nowhere to deliver to, which is silence rather than
an error.

---

## 6. Retention without a sweeper

Both inserts are bounded **in the same statement that writes them**, exactly as
`push/store.ts` caps devices:

- a personal insert deletes that player's rows beyond the newest
  `NOTIFICATIONS_KEEP_PER_PLAYER`;
- a broadcast insert deletes broadcasts beyond the newest
  `NOTIFICATIONS_KEEP_BROADCASTS`.

The table is therefore bounded by `players x cap + broadcast cap` by
construction, with no scheduled job and no unbounded growth. This is the same
argument `023_push_subscriptions.sql` makes for pruning dead endpoints inline:
hygiene happens at the only moment it is discoverable and costs nothing extra.

The eviction is by `created_at`, not by read state — an old notification you
never opened is still old.

---

## 7. Deliberately excluded

- **Spike alerts on users/plays.** Asked for, and left out on purpose. Detecting
  a spike means comparing a rolling window on a schedule, and there is no
  scheduler. The two ways to fake one both cost more than the feature is worth
  right now: evaluating on the hot play/signup write paths taxes the busiest
  queries in the app, and evaluating when an admin happens to look means the
  alert cannot fire a push and is really just a dashboard panel wearing a bell.
  The deterministic admin events that *are* wired — a review posted, a review
  reported, a bug report filed — are write-triggered and cost nothing. Spikes
  belong with a scheduler, and this document is where that decision is recorded
  rather than rediscovered.
- **Per-item dismissal.** See §4.
- **Digests and quiet hours.** Both need a scheduler.
- **Email.** No transport, and a school arcade emailing pupils is a different
  consent conversation entirely.

---

## 8. Privacy notes

- The bell endpoint is `private, no-store` and derives the player from the
  session cookie, never from a parameter — the invariant `request-guard.ts`
  documents for every credentialed route.
- `/play/you/notifications` is `robots: noindex`, matching its sibling tabs.
- The service worker's `isPrivatePath` already covers the whole `/play/you`
  subtree as a prefix, so the new tab is excluded from the shared runtime cache
  without anyone having to remember to add it.
- Notification bodies are stored in plain text and name games and players. That
  is the same exposure the leaderboards already carry, and the discreet copy —
  not the storage — is what answers the shoulder-surfing threat.
