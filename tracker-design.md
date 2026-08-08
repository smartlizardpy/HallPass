# Tracker — design

A shared project board on `/dashboard`. Admins paste in what they want built and
watch its status; I move the status as I build. Tags and status are the whole
vocabulary.

Status: **phase 1 built and live** (§8). The board, the composer, the item detail
page, tags, updates and the activity trail are in. Migration `021_tracker.sql` is
applied to **prod** (Neon branch `main`); the `dashboard-dev` branch is still on
020, so a local checkout shows the "run migration 021" notice until it is applied
there too — see §7.

Moving an item between lanes and deleting one for good are **super-admin-only**;
everything else on the board is open to any admin. See §5, *Authorization*.

---

## 1. What it is

Two directions through one surface:

- **In** — an admin writes a title, pastes the details of what they want, tags
  it, and it lands on the board.
- **Out** — they open the board and can see what I am building right now, what is
  queued, what shipped, and what got declined.

That second direction is the product. A status chip alone does not tell anyone
anything, so the item detail carries an **Updates** thread — dated notes from me
about where a thing actually is.

**Not** a player-facing suggestion box (no public writes, no moderation stack).
**Not** per-game (game bugs live in the beta programme's `beta_reports`).
**Not** monday.com — no automations, no notifications, no real-time, no custom
column types. Those exist for 40-person teams and are pure liability here.

### One entity, not two

The earlier draft had Projects containing Items. **Collapsed to one entity: the
item.** Someone pastes a project's details in — that *is* the item, and its
status is what they came back to check. A second level would mean deciding
whether the status lives on the parent or the child, and the answer would be
wrong half the time.

Tags do the grouping instead. When GitHub issues get connected later, the *issues*
become the sub-work — which is the level that actually wants a parent/child
relationship. See §6.

> **Assumption to confirm:** collapsing Project and Item into one thing is my
> read of "they paste in details about project and they see what I am building".
> If you pictured a project holding several tracked pieces of work, say so — it
> is one extra table and a `parent_id`, cheap now and awkward later.

### Naming

`Boards` is taken — `/dashboard/boards` is **leaderboards**. Route is
`/dashboard/tracker`, nav label **Tracker**, table prefix `tracker_`.

---

## 2. The vocabulary

Lives in `app/lib/tracker/config.ts` — pure, no `server-only`, imported by both
the store and the UI so the two cannot drift (same rule as `reviews/config.ts`
and `beta/config.ts`).

### Status — six values, worded for the person reading, not the person building

| Status | What it tells the reader |
|---|---|
| `new` | Pasted in. I have not looked at it yet. |
| `planned` | Agreed, queued, not started. |
| `building` | **Being built right now.** |
| `shipped` | Live on the site. |
| `parked` | Not now, still want it. |
| `declined` | Not doing this. |

`parked` and `declined` stay separate. Collapsing them destroys the one answer a
board like this exists to give — *"we still want it"* versus *"we already said
no"* — and without it the same request gets pasted in again every few months.

`building` stamps `started_at`; `shipped` and `declined` stamp `done_at` and are
the terminal pair. Nothing else is stamped.

### Tags — free-form, first-class

The only other dimension. Lowercase, hyphenated, `^[a-z0-9][a-z0-9-]{0,23}$`.
Free-form rather than a fixed enum, because the useful labels here are not
predictable in advance (`pwa`, `mobile`, `stealth`, `perf`, `needs-art`).

No `tracker_tags` registry table — the tag list for the filter bar and the
autocomplete is `SELECT DISTINCT tag`, which at this size is one cheap index-only
scan and cannot drift from what is actually in use.

### Deliberately absent

No priority, no effort, no due dates, no assignee. One person builds, so the
answer to "what is next" is the board order, and a `priority` column on a
two-person board becomes six items marked `high`. They are one additive migration
each if the board ever proves otherwise.

---

## 3. Schema

Migration `021_tracker.sql` (now the head, applied to prod), plus canonical
fresh-install DDL at `app/lib/tracker/schema.sql`, kept in lockstep the way
`beta/schema.sql` ↔ `016_beta_program.sql` are. Idempotent, every statement
guarded, whole file in one `BEGIN; … COMMIT;`.

### `tracker_items`

```sql
id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140)
brief        TEXT NOT NULL DEFAULT '' CHECK (length(brief) <= 20000)
status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new','planned','building','shipped','parked','declined'))
position     INTEGER NOT NULL DEFAULT 0
created_by   TEXT NOT NULL          -- dashboard_users.email, no FK (see below)
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
started_at   TIMESTAMPTZ
done_at      TIMESTAMPTZ
archived_at  TIMESTAMPTZ

-- GitHub seam. Nullable, unused in phase 1 — see §6.
gh_repo         TEXT
gh_issue_number INTEGER
gh_synced_at    TIMESTAMPTZ

CONSTRAINT tracker_items_done_at_matches_status
  CHECK ((status IN ('shipped','declined')) = (done_at IS NOT NULL))
```

> **Stale comment in a shipped migration.** `021_tracker.sql` says of
> `archived_at`: *"Soft delete. The board filters on it; nothing in the UI
> hard-deletes."* The second half stopped being true when the super-admin delete
> landed. It is left uncorrected **on purpose** — `scripts/migrate.mjs` records a
> sha256 of each file as it is applied and warns (exit 1) when an applied file's
> contents change, and 021 is already on prod. Editing a shipped migration to fix
> a comment is exactly the habit that check exists to break. This doc and the
> README are the live description; the migration is a historical record.

`brief` is the pasted detail — **20 000 characters**, because "paste in the
details" means someone will drop a whole spec, a chat log, or a bullet list in
there and hitting a limit at that moment is how a tool gets abandoned. Rendered
`whitespace-pre-wrap`, **never** `dangerouslySetInnerHTML` — the rule the
moderation page states for review bodies applies to every free-text field on this
dashboard. No markdown renderer: a dependency and an XSS surface bought for
italics.

`created_by` has **no foreign key** to `dashboard_users`, matching
`review_moderation_log.actor_email`: removing someone from the admin allow-list
must not blank out who asked for what.

`done_at` is constrained to agree with `status`, so moving an item back out of
`shipped` has to clear the timestamp instead of leaving a row that claims to be
`planned` and to have shipped in March.

```sql
tracker_items_board_idx  ON (status, position, id DESC) WHERE archived_at IS NULL
tracker_items_gh_idx     ON (gh_repo, gh_issue_number)  WHERE gh_issue_number IS NOT NULL  -- UNIQUE
```

### `tracker_item_tags`

```sql
item_id BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE
tag     TEXT NOT NULL CHECK (tag ~ '^[a-z0-9][a-z0-9-]{0,23}$')
PRIMARY KEY (item_id, tag)
```

Plus `tracker_item_tags_tag_idx ON (tag, item_id)` so "everything tagged `pwa`"
is an index lookup. A join table rather than a `TEXT[]` for exactly that reason.
`TagEditor` already exists in `app/dashboard/(app)/_ui/` and gets reused.

### `tracker_updates`

The progress narrative — append-only notes, which is how "they see what I am
building" becomes real information rather than a coloured chip.

```sql
id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
item_id      BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE
author_email TEXT NOT NULL
body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000)
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
edited_at    TIMESTAMPTZ
```

Separate from `brief` because they are different things: the brief is the current
ask and gets rewritten, an update is a dated note that does not. Losing "tried X,
it does not work because Y" to a brief rewrite is the failure this prevents.

### `tracker_events`

Auto-written activity. `item_id` is a plain `BIGINT` with **no foreign key**,
following `review_moderation_log` — the trail has to survive the thing it
describes, and a CASCADE erases exactly the history you want after a hard delete.

```sql
id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
item_id     BIGINT
actor_email TEXT NOT NULL
action      TEXT NOT NULL CHECK (action IN
              ('create','status','edit','tag','untag',
               'archive','restore','comment','link','unlink','delete'))
from_value  TEXT
to_value    TEXT
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 4. The constraint that shapes every mutation

`app/lib/db.ts` uses the `neon()` HTTP driver: **one stateless request per tagged
template, so a transaction cannot span two calls.** "Update the status, then log
the event" as two `await`s has a real window where the first succeeded and the
second did not, and the activity trail silently loses entries.

So every mutation is **one multi-CTE statement**, the idiom `reviews/store.ts`
already uses:

```sql
WITH prev AS (
  SELECT id, status FROM tracker_items
   WHERE id = ${id} AND archived_at IS NULL
), moved AS (
  UPDATE tracker_items t
     SET status     = ${next},
         started_at = CASE WHEN ${next} = 'building' AND t.started_at IS NULL
                           THEN now() ELSE t.started_at END,
         done_at    = CASE WHEN ${next} IN ('shipped','declined')
                           THEN coalesce(t.done_at, now()) ELSE NULL END,
         updated_at = now()
    FROM prev
   WHERE t.id = prev.id
  RETURNING t.id, t.status
)
INSERT INTO tracker_events (item_id, actor_email, action, from_value, to_value)
SELECT moved.id, ${actor}, 'status', prev.status, moved.status
  FROM moved, prev
RETURNING item_id;
```

Two properties fall out: the CTE reads the pre-update snapshot, so `from_value` is
correct with no second round trip; and **an empty result set is the outcome code**
— no rows means "no such item, or already archived", which is how the server
action picks between `?ok` and `?error`.

**SQL safety.** The `neon()` template parameterises values only and does not
reliably splice fragments. Nothing here interpolates one. The board's tag filter
is not a dynamic `WHERE`: the board reads every non-archived item plus its tags in
one query and filters in JS. At tens-to-low-hundreds of rows that is one round
trip instead of a combinatorial set of hand-written templates — and that, not a
performance claim, is the honest reason.

---

## 5. Surfaces

```
app/lib/tracker/
  config.ts        statuses, labels, lane order, tag regex — pure
  config.test.ts   invariants (lane order covers every status once; terminal set
                   matches the done_at CHECK; every value has a label)
  schema.sql       canonical fresh-install DDL
  store.ts         createTrackerStore(sql) factory
  store.test.ts    fake-tagged-template seam
  index.ts         server-only barrel binding the store to the shared `sql`

app/lib/scoreboard/migrations/021_tracker.sql

app/dashboard/(app)/tracker/
  page.tsx         the board
  actions.ts       server actions, all requireRole-gated
  [id]/page.tsx    item detail — brief, tags, status, Updates, Activity
  new/page.tsx     the paste-it-in form
  _ui/Composer.tsx title + big brief textarea + tags
  _ui/Lane.tsx     one status column
  _ui/ItemCard.tsx title, tags, last-update timestamp
  _ui/Chips.tsx    status + tag chips (mirrors beta/_ui/Chips.tsx)

app/dashboard/(app)/_ui/DashNav.tsx   +1 nav entry
```

**Server actions, not route handlers.** Stated as the convention in
`app/api/v1/games/[slug]/reviews/route.ts`: route handlers are for *player* writes
with no role, and every admin write in this codebase is a `requireRole`-gated
server action. So the tracker follows curation/moderation — `requireRole("admin")`
first, validate, one fallible store call in a try/catch, `redirect()` **outside**
the try, land back on `?ok=` / `?error=`.

### The board

Six lanes, `new → planned → building → shipped → parked → declined`, each with a
count. **`building` renders first and widest** — it is the answer most people open
this page for. Desktop: horizontally scrolling columns. Mobile: stacked
`<details>` sections, open only where the lane is non-empty (six Kanban columns are
unusable on a phone, and `mobile.md` treats that surface as real).

Tag filter as plain links (`?tag=pwa`) — server-rendered, no client state,
shareable, works with the back button.

### The composer

A dedicated `/dashboard/tracker/new` page rather than an inline one-liner, because
the input here is a *paste*, not a capture: a full-width textarea that can hold a
spec without fighting a board layout for room. Title + brief + tags, lands in
`new`. Plain `<form>` + server action, no JS required.

### Item detail

Brief at the top, tags and status beside it, then Updates, then Activity. Status
is a `<select>` + submit; adding an update is a textarea + submit. No JS required
anywhere, matching how the rest of the dashboard mutates.

### Nav

`{ href: "/dashboard/tracker", label: "Tracker" }`, placed **third** — after
Overview and Moderation. Moderation keeps second: its docblock explains the
position is earned by having a child waiting on the other end of it, and this does
not outrank that.

A "new items" count badge is possible later, but should be **server-rendered from
the `(app)` layout**, not a second polling client component — `OpenReportBadge`
documents why it polls and ends with "if the layout ever grows the count, delete
the effect and take it as a prop". Two independent 60-second pollers in one
sidebar is the version to avoid.

### Authorization

`requireRole("admin")` on every page, and on every action except two, matching
Moderation, Curation, Games and Beta. Everyone who can reach the dashboard can
paste an item in and read every status — which is the point. Nothing is exposed
through `/api/v1/*`, so no SDK contract change and no CORS surface.

**Two actions are `super_admin` only.**

| | admin | super_admin |
|---|---|---|
| Paste in, edit, retag, post updates | ✅ | ✅ |
| Archive / restore | ✅ | ✅ |
| Move between lanes | — | ✅ |
| Delete for good | — | ✅ |

*Status,* because it is the one field that is a claim about the work rather than
a description of the ask. "Building" and "Shipped" mean something only if the
person who moved them there is the person doing the building; a board where
anyone can mark anything shipped answers the question it exists to answer
incorrectly, which is worse than not answering it. It is also the field the
database ties to another — `tracker_items_done_at_matches_status` rewrites
`done_at` on every move in and out of a terminal lane. A plain admin sees a
read-only chip and the lane's hint, and says what they know in an update
instead; that is a better record anyway, because "still blocked on the API key"
is information and a lane change is not.

*Delete,* because it is the only unrecoverable thing here. Archive stays shared
precisely so that the shared control is the reversible one.

The guard and the render condition are **one fact, not two**. Both read
`TRACKER_DEV_ROLE`, `canMoveStatus` and `canDeleteItem` from `config.ts`. Written
separately they drift, and the drift is silent in the dangerous direction: an
action that still accepts what the UI stopped offering is an unenforced rule.
The actions re-check independently of what the page rendered, because hiding a
`<select>` does not hide the endpoint behind it — `requireRole` is the
enforcement, `canMoveStatus` only decides what is worth drawing.

One sharp edge worth knowing: `requireRole` only enforces a *level* when `min`
is `"super_admin"` (`app/lib/auth.ts`). Passing it `"admin"` admits both roles.
So `TRACKER_DEV_ROLE` has to be exactly that literal or the guard silently
becomes a no-op that still reads like a restriction — `config.test.ts` pins it.

---

## 6. The GitHub seam (designed now, built later)

`gh_repo` / `gh_issue_number` / `gh_synced_at` ship nullable and unused in phase 1
so that connecting issues later is not a migration.

The hard part is not the API call — it is **deciding which side owns status**, and
that decision should be made when the integration is built, not now. The three
options, so the choice is on the record:

1. **Tracker owns status, GitHub is a mirror.** An item can link N issues; closing
   them does nothing here. Simplest, but the board will drift from reality the
   first busy week.
2. **GitHub owns status, tracker mirrors it.** `building` when an issue is open
   with a linked PR, `shipped` when it closes. Honest and self-maintaining, but
   `parked` and `declined` have no GitHub equivalent, so the vocabulary would have
   to shrink to what labels can express.
3. **Split — tracker owns intake (`new`/`planned`/`parked`/`declined`), GitHub owns
   execution (`building`/`shipped`).** Each state has exactly one authority. This
   is the one worth trying, and it is why `started_at`/`done_at` are stamps rather
   than derived.

Whichever way it goes, runtime GitHub access needs a token or GitHub App
credential in the Vercel environment — none exists today, and it belongs in the
env table in the README when it does.

---

## 7. Failure modes

Follows the repo's existing rules:

- **Schema behind the deploy** — the page catches `isMissingColumnError` and
  renders "run migration 021" instead of a 500. This matters: `scripts/migrate.mjs`
  is not wired into the deploy, and `HANDOFF.md` records a live case of that drift
  (migration 013 never reached prod).
- **`DATABASE_URL` unset** — `isUnconfiguredDbError` renders its own notice.
- **Anything else rethrows.** A real Neon outage must not be disguised as an empty
  board — the same lie the moderation page names as the most dangerous one it
  could tell.
- **Neon branching** — 021 must be applied to *every* branch the app runs against.
  `npm run migrate -- --status` prints the target host; check it each time.

**PWA:** nothing to do. `public/sw.js` never intercepts `/dashboard`, and these
pages call `auth()` so they are dynamic and never enter `public/sw-manifest.js`.
The tracker cannot affect offline play — worth stating, since that is the failure a
new dashboard route could plausibly introduce.

**Cache:** no `unstable_cache`, no tags — every read is per-viewer on a dynamic
page. Actions call `revalidatePath("/dashboard/tracker")` and the item path. Never
`bumpGamesVersion()`; that sentinel makes every client re-fetch the entire game
corpus.

---

## 8. Phasing

**Phase 1 — the loop works.** Migration 021, `config.ts`, `store.ts` + tests, the
composer, the board with tag filtering, item detail with status/tags/Updates/
Activity, nav entry. This is the whole product.

**Landed after phase 1.** The super-admin split (§5, *Authorization*) and a
permanent delete alongside archive. Neither was in the original phasing; both
came out of the first read of the built board.

**Phase 2 — comfort.** Archive view, `SELECT DISTINCT tag` autocomplete, manual
ordering via ▲▼ writing `position`, a "new items" count in the sidebar, an
Overview tile showing what is `building`.

**Phase 3 — GitHub.** §6, once the ownership question is answered.

Deliberately not building, at any phase: drag-and-drop (no dnd library in
`package.json`, and it is the most expensive thing on this page), markdown
rendering, notifications, real-time sync, and sprint/date machinery.

---

## 9. Open questions

1. **One entity or two?** §1 collapses Project and Item. Confirm, or say if a
   project should hold several tracked pieces of work.
2. **Should tags be free-form or a short fixed set?** Free-form as designed; a
   fixed set is tidier but someone has to maintain it.
3. **Anything to seed?** Happy to load the current in-flight work as items when
   phase 1 lands, or leave the board empty for you to paste into.
