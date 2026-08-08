# Tracker — design

A monday.com-shaped project tracker for the two people who build HallPass. Admin
surface only: it lives under `/dashboard`, no player ever sees it, and nothing in
it is public.

Status: **design only, nothing built.** This document is the plan to review before
any code lands.

---

## 1. What it is, and what it deliberately is not

**Is.** One place to put the work: a captured idea, the context behind it ("info
about the project"), what state it is in, who owns it, and what happened to it.
A board you open on a Saturday morning to answer "what am I doing today", and a
record six months later of why a thing was parked.

**Is not:**

- **Not a player-facing suggestion box.** No public submissions, no upvotes, no
  roadmap page. That was the other reading of "idea tracker" and it is explicitly
  out — it would drag in the entire moderation stack (rate limits, reports,
  auto-hide, bans, audit log) that `game_reviews` already needed, for two users
  who can just type into the box themselves.
- **Not per-game.** Site features only. Game-specific bugs already have a home in
  the beta programme (`beta_reports`), and duplicating that here would give the
  same bug two competing statuses.
- **Not real monday.com.** No automations, no real-time collaboration, no
  notifications, no dashboards-of-dashboards, no custom column types. Those
  features exist because monday sells to 40-person teams. Every one of them is a
  liability at two users.

### Naming

`Boards` is already taken — `/dashboard/boards` is **leaderboards**, and
`tracker_boards` next to `scoreboard` tables would be a permanent
readability tax. So:

| monday concept | here | route |
|---|---|---|
| Board | **Project** | `/dashboard/tracker/projects` |
| Group | *(none — the status lane is the group)* | — |
| Item | **Item** | `/dashboard/tracker/[id]` |
| Updates | **Updates** (append-only thread) | on the item |
| Activity log | **Activity** (auto-written events) | on the item |

Nav label: **Tracker**. Table prefix: `tracker_`.

**Why no free-form groups.** monday gives you groups *and* a status column, and
in practice they fight: the group says "Q3" while the status says "Done". With
two people the status lane *is* the grouping. One concept, no drift.

---

## 2. The vocabularies

These are the numbers most likely to be widened later by someone who has not read
this section. They live in `app/lib/tracker/config.ts` — pure, no `server-only`,
imported by both the store and the UI so the two cannot disagree (same rule as
`reviews/config.ts` and `beta/config.ts`).

### Status — six values, six lanes

```
inbox → next → building → shipped
                    ↘ parked
                    ↘ dropped
```

- `inbox` — captured, not yet judged. The default. Capture must never require a
  decision, or you stop capturing.
- `next` — agreed, queued, has enough context to start.
- `building` — actively being worked. Stamps `started_at`.
- `shipped` — live on the site. Terminal. Stamps `done_at`.
- `parked` — deliberately not now, revisit later. Reversible, no `done_at`.
- `dropped` — decided against. Terminal, stamps `done_at`, keeps the reasoning.

`parked` and `dropped` are separate on purpose: collapsing them loses the single
most useful thing a tracker records, which is *"we already thought about this and
said no"* versus *"we still want this"*. A tracker without that answer gets the
same idea re-entered every three months.

**No `review` lane.** In this repo the gap between merge and live is one Vercel
deploy, so a lane for it would be empty most of the time and stale the rest.

### Priority — `urgent | high | medium | low`

monday's wording, four values. Defaults to `medium`.

### Effort — `s | m | l | xl`, nullable

Sized in sittings, not story points: `s` = one evening, `m` = a weekend, `l` =
several sessions, `xl` = needs breaking up before it can be started.

Effort earns its place because it is the field that actually decides what gets
built by two people with school and university in the way. Priority alone
produces a board where everything is `high` and nothing moves.

Nullable, because an un-sized item in `inbox` is normal and forcing a guess at
capture time is exactly the friction that kills capture.

---

## 3. Data model

Migration `021_tracker.sql` (020 is the current head), plus the canonical
fresh-install DDL at `app/lib/tracker/schema.sql`. The two are kept in lockstep,
same as `beta/schema.sql` ↔ `016_beta_program.sql`. Fully idempotent, every
statement guarded, whole file in one `BEGIN; … COMMIT;`.

### `tracker_projects`

The "info about the project" layer — a named container with a written brief.

```sql
id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
key         TEXT NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,5}$')  -- "PWA", "SOCIAL"
name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80)
brief       TEXT NOT NULL DEFAULT '' CHECK (length(brief) <= 8000)
accent      TEXT NOT NULL DEFAULT 'brand'
position    INTEGER NOT NULL DEFAULT 0
archived_at TIMESTAMPTZ
created_by  TEXT NOT NULL          -- dashboard_users.email, no FK (see below)
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

`brief` is where the project description goes. Plain text, rendered
`whitespace-pre-wrap` — **never** `dangerouslySetInnerHTML`, matching the rule the
moderation page states for review bodies. No markdown renderer: that is a
dependency and an XSS surface bought for italics.

### `tracker_items`

```sql
id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
project_id   BIGINT REFERENCES tracker_projects(id) ON DELETE RESTRICT
title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140)
body         TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 8000)
status       TEXT NOT NULL DEFAULT 'inbox'
               CHECK (status IN ('inbox','next','building','shipped','parked','dropped'))
priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('urgent','high','medium','low'))
effort       TEXT CHECK (effort IN ('s','m','l','xl'))
owner_email  TEXT
due_on       DATE
position     INTEGER NOT NULL DEFAULT 0
source       TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','beta','review'))
source_ref   TEXT
created_by   TEXT NOT NULL
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
started_at   TIMESTAMPTZ
done_at      TIMESTAMPTZ
archived_at  TIMESTAMPTZ

CONSTRAINT tracker_items_done_at_matches_status
  CHECK ((status IN ('shipped','dropped')) = (done_at IS NOT NULL))
```

Three decisions worth defending:

**`project_id` is `ON DELETE RESTRICT`, and nullable.** Nullable because capture
must not require picking a project — an item with no project is a loose idea, and
that is a legitimate permanent state. `RESTRICT` because the item is the durable
record and the project is a folder: deleting a folder must not silently destroy
twelve items. The UI only ever offers *archive* for a project; a hard delete has
to move its items out first, and the database is what makes that true rather than
a rule someone remembers.

**`done_at` is constrained to agree with `status`.** Moving an item back out of
`shipped` must clear the timestamp, and the CHECK forces the store to do it
instead of leaving a row that claims to be `next` and to have shipped in March.

**`owner_email` has no foreign key to `dashboard_users`.** Same reasoning as
`review_moderation_log.actor_email`: removing someone from the admin allow-list
must not blank out who owned what. It is a string, and history is allowed to name
people who are no longer listed.

`source` / `source_ref` are there so a beta tester's accepted feature report can
be promoted into an item later (phase 3) without a schema change. `source_ref` is
a plain string, not an FK, so a deleted report can never take an item with it.

Indexes:

```sql
tracker_items_board_idx   ON (status, position, id DESC) WHERE archived_at IS NULL
tracker_items_project_idx ON (project_id, status)        WHERE archived_at IS NULL
tracker_items_owner_idx   ON (owner_email, status)       WHERE archived_at IS NULL
tracker_items_due_idx     ON (due_on)
  WHERE archived_at IS NULL AND status NOT IN ('shipped','dropped')
```

All partial on `archived_at IS NULL`, because every board read filters it and the
archive only grows.

### `tracker_item_tags`

```sql
item_id BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE
tag     TEXT NOT NULL CHECK (tag ~ '^[a-z0-9][a-z0-9-]{0,23}$')
PRIMARY KEY (item_id, tag)
```

A join table rather than a `TEXT[]`, so "everything tagged `pwa`" is an index
lookup. `TagEditor` already exists in `app/dashboard/(app)/_ui/` and is reused.

### `tracker_updates`

The monday "Updates" thread — append-only notes on an item.

```sql
id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
item_id      BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE
author_email TEXT NOT NULL
body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000)
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
edited_at    TIMESTAMPTZ
```

Separate from `items.body` because the two are different things: `body` is the
current spec and gets rewritten, an update is a dated note that does not. Losing
"tried X, it did not work because Y" to a spec rewrite is the failure this
prevents.

### `tracker_events`

Auto-written activity. **`item_id` and `project_id` are plain `BIGINT` with no
foreign key** — deliberately, following `review_moderation_log`: the trail has to
survive the thing it describes, and a CASCADE would erase exactly the history you
want when you hard-delete something contentious.

```sql
id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
item_id     BIGINT
project_id  BIGINT
actor_email TEXT NOT NULL
action      TEXT NOT NULL CHECK (action IN
              ('create','status','priority','effort','owner','due','project',
               'edit','tag','untag','archive','restore','comment','delete'))
from_value  TEXT
to_value    TEXT
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 4. The constraint that shapes every mutation

`app/lib/db.ts` uses the `neon()` HTTP driver: **one stateless request per tagged
template, so a transaction cannot span two calls.** "Update the item, then log the
event" as two `await`s has a real window where the first succeeded and the second
did not, and the activity trail silently loses entries.

So every mutation is **one multi-CTE statement**, exactly like `reviews/store.ts`:

```sql
WITH prev AS (
  SELECT id, status FROM tracker_items
   WHERE id = ${id} AND archived_at IS NULL
), moved AS (
  UPDATE tracker_items t
     SET status     = ${next},
         started_at = CASE WHEN ${next} = 'building' AND t.started_at IS NULL
                           THEN now() ELSE t.started_at END,
         done_at    = CASE WHEN ${next} IN ('shipped','dropped')
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

Two properties fall out: the CTE reads the pre-update snapshot so `from_value` is
correct without a second round trip, and **an empty result set is the outcome
code** — no rows means "no such item, or already archived", which is how the
server action decides between `?ok` and `?error`. Same decode-from-one-statement
idiom the review store uses.

**SQL safety.** The `neon()` template parameterises values only and does not
reliably splice fragments. Nothing here interpolates a fragment. The board's
filters (project / owner / priority / tag) are **not** built into a dynamic
`WHERE`: the board reads every non-archived item in one query and groups and
filters in JS. At the realistic size of this table — tens to low hundreds of rows
— that is one round trip instead of a combinatorial set of hand-written
templates, and it is the honest reason, not a performance claim.

---

## 5. Surfaces

```
app/lib/tracker/
  config.ts        statuses, priorities, efforts, labels, lane order — pure
  config.test.ts   invariants (every status has a lane label; terminal set matches the CHECK)
  schema.sql       canonical fresh-install DDL
  store.ts         createTrackerStore(sql) factory
  store.test.ts    fake-tagged-template seam (transitions, timestamps, event pairing)
  index.ts         server-only barrel binding the store to the shared `sql`

app/lib/scoreboard/migrations/021_tracker.sql

app/dashboard/(app)/tracker/
  page.tsx             the board
  actions.ts           server actions (all requireRole-gated)
  [id]/page.tsx        item detail
  projects/page.tsx    project list + brief editor          (phase 2)
  _ui/QuickAdd.tsx     one-field capture form
  _ui/Lane.tsx         one status column
  _ui/ItemCard.tsx     the card
  _ui/Chips.tsx        status / priority / effort chips     (mirrors beta/_ui/Chips.tsx)

app/dashboard/(app)/_ui/DashNav.tsx   +1 nav entry
```

**Server actions, not route handlers.** The convention is stated in
`app/api/v1/games/[slug]/reviews/route.ts`: route handlers are for *player* writes
with no role; every admin write in this codebase is a `requireRole`-gated server
action. The tracker is entirely admin writes, so it follows curation/moderation —
`requireRole("admin")` first, validate, one fallible store call in a try/catch,
`redirect()` **outside** the try, land back on `?ok=` / `?error=`.

### The board (`/dashboard/tracker`)

- **Quick add pinned at the top.** One text field, submit, lands in `inbox` with
  no other decision required. This is the highest-value element on the page — a
  tracker that asks five questions before accepting an idea stops receiving ideas.
- Six lanes, ordered `inbox → next → building → shipped → parked → dropped`, each
  with a count. Desktop: horizontally scrolling columns. Mobile: stacked
  `<details>` sections, open by default only where the lane is non-empty (the six
  columns of a real Kanban board are unusable on a phone, and `mobile.md` treats
  that surface as real).
- Sort within a lane: `pinned/position`, then priority, then `due_on` nulls last,
  then `updated_at` desc.
- Filters as plain links (`?project=`&`?owner=`&`?tag=`) — server-rendered, no
  client state, shareable, works with the back button.

### Item detail (`/dashboard/tracker/[id]`)

Title, `body` spec, and a meta rail: project, status, priority, effort, owner,
due, tags. Below it the Updates thread, and below that Activity. Each meta field
is its own tiny `<form>` with a `<select>` and a submit — no JS required, and it
matches how the rest of the dashboard mutates.

### Nav and badge

`{ href: "/dashboard/tracker", label: "Tracker" }`, placed **third** — after
Overview and Moderation. Moderation keeps second place; its docblock explains that
the position is earned by having a child waiting on the other end of it, and a
personal backlog does not outrank that.

A count badge (urgent + overdue) is phase 2, and should be **server-rendered and
passed down from the `(app)` layout**, not a second polling client component.
`OpenReportBadge` documents why it polls and ends with "if the layout ever grows
the count, delete the effect and take it as a prop" — two independent 60-second
pollers in one sidebar is the version of this to avoid.

---

## 6. Authorization

`requireRole("admin")` on every page and every action — matching Moderation,
Curation, Games, and Beta. Only Users and Logs are `super_admin`.

This is a one-word change if you would rather the tracker be super-admin-only.
The trade: `admin` means Ateş can file and move items; `super_admin` makes it your
private notebook. Recommendation is `admin` — a tracker only one person can write
to is a text file with extra steps. **Flagged as an open question below.**

Nothing here is ever exposed by an `/api/v1/*` route, so no SDK contract change
and no CORS surface.

---

## 7. Failure modes

Follows the repo rules exactly:

- **Schema behind the deploy.** The page catches `isMissingColumnError` and
  renders "run migration 021" rather than a 500. This matters here because
  `scripts/migrate.mjs` is not wired into the deploy and `HANDOFF.md` records a
  live instance of that drift (migration 013 was never applied to prod).
- **`DATABASE_URL` unset.** `isUnconfiguredDbError` renders its own notice.
- **Anything else rethrows.** A real Neon outage must not be disguised as an
  empty board — the same lie the moderation page calls out as its most dangerous.
- **Neon branching.** 021 must be applied to *every* branch the app runs against.
  `npm run migrate -- --status` prints the target host; check it each time.

### PWA / service worker

Nothing to do. `public/sw.js` never intercepts `/dashboard`, and these pages call
`auth()` so they are dynamic and never enter `public/sw-manifest.js`. The tracker
cannot affect offline play — worth stating, because that is the failure mode a
new dashboard route could plausibly introduce.

### Cache

No `unstable_cache`, no cache tags: every read is per-viewer on a dynamic page.
Actions call `revalidatePath("/dashboard/tracker")` and the item path. No
`bumpGamesVersion()` — that sentinel makes every client re-fetch the entire game
corpus, and this is not a PWA concern.

---

## 8. Deliberately not building

| Not building | Why |
|---|---|
| Drag and drop | No dnd library in `package.json`, and adding one for a two-person board is the most expensive thing on this page. Phase 2 gets ▲▼ buttons writing `position`; native HTML5 DnD is a phase-3 maybe. |
| Markdown rendering | A dependency and an XSS surface bought for italics. `whitespace-pre-wrap`. |
| Notifications / email | Two people who talk to each other. |
| Real-time sync | Two people who are rarely on it at once. Server actions + revalidate is enough. |
| Sprints / dates / burndown | Ceremony for a team of two. `due_on` is the whole scheduling model. |
| Custom column types | monday's core product; here it means building a schema editor. |
| Subitems | Deferred. A self-referencing `parent_id` is one additive migration if `xl` items turn out to need it. |

---

## 9. Phasing

**Phase 1 — the board works.** Migration 021, `config.ts`, `store.ts` + tests,
board page with quick add, item detail with the meta rail, status/priority/effort/
owner/due mutations, Updates thread, Activity list, nav entry. Projects exist in
the schema but the UI ships with a single implicit "no project" bucket.

**Phase 2 — organisation.** Projects CRUD with the brief editor, tags + filters,
manual ordering, the sidebar count badge, an "Overview" tile showing lane counts
and anything overdue.

**Phase 3 — connections (all optional).** Promote an accepted `beta_reports`
feature into an item (`source = 'beta'`); a GitHub PR/branch link per item; a
"shipped since <date>" view to draft the ShipNote changelog from.

Phase 1 is the whole point. Everything after it is convenience.

---

## 10. Tests

`vitest`, following the existing seam:

- `config.test.ts` — pure invariants: lane order covers every status exactly once;
  the terminal set (`shipped`, `dropped`) matches what the `done_at` CHECK
  enforces; every enum value has a label.
- `store.test.ts` — `createTrackerStore(fakeSql)`, the fake-tagged-template
  pattern from `reviews/store.test.ts`. What is worth asserting: `building`
  stamps `started_at` once and does not re-stamp on re-entry; leaving a terminal
  status clears `done_at`; every mutation emits exactly one event row in the same
  statement; an archived item is not mutable.

---

## 11. Open questions

1. **`admin` or `super_admin`?** Recommendation `admin`, so Ateş can use it. One
   word either way.
2. **Owner field** — free-text, or a `<select>` populated from `dashboard_users`?
   A picker is nicer and is roughly ten extra lines.
3. **Is `due_on` wanted at all?** For two people, priority + effort may be the
   whole scheduling model, and an always-empty date column is clutter. Easy to
   leave in the schema and off the UI.
4. **Does `shipped` feed the ShipNote changelog?** If yes, phase 3's "shipped
   since" view is worth pulling forward; if you would rather write release notes
   by hand, drop it.
5. **Seed data** — do you want the current in-flight work loaded as items when
   phase 1 lands, or would you rather type it in yourself?
