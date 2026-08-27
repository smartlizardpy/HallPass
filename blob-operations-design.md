# Blob operations: what we spend, why it ran out, and how it is stopped

Written after the advanced-operation allowance hit 100% and publishing stopped
working. It is the reference for "why does that read from Neon" and "what do I
turn off first".

## The two allowances

Vercel meters Vercel Blob usage in two classes, and they are an order of
magnitude apart:

| Class | Primitives | Hobby allowance |
|---|---|---|
| **Simple operations** | `head`, `del` | 10,000 / month |
| **Advanced operations** | `put`, `copy`, `list` | **2,000 / month** |

Data transfer is billed separately again and is not what this document is about.

The advanced class is the dangerous one, and not only because it is smaller: a
spent advanced allowance takes `put` down with it. The failure is not "the site
is slower", it is **nobody can publish a game, accept a screenshot, or cache a
cover until the month rolls over**.

## What we were spending it on

Measured over one 30-day window, before this work:

| Where | Operation | Count | Share |
|---|---|---|---|
| `getServingBlobMap()` listing `games/**` | `list` | 920 | 98% |
| Everything else (publishes, media, covers, promotions) | `put` / `copy` | 14 | 2% |

920 of 934. Roughly 46% of the entire monthly allowance went on one listing
whose only job was to answer "which games have a published override?". It also
paginates, so a single refresh could be several operations, and it sat on the
serving path for every asset of every play.

The simple allowance had already been through the same lesson twice: the
`/games-version` sentinel `head()` was 5,974 of 6,100 simple operations (95%),
and the media serving route's per-image `head()` was fixed by migration 015
storing the URL that `put()` had already returned.

## The fix: stop asking the object store what we already know

`put()` returns the public URL. A writer that records what it wrote turns every
read into database work.

**`game_blobs`** (migration 026) mirrors the `games/**` prefix in Neon: pathname,
slug, url, size, uploaded_at. Every writer of a `games/**` blob records its row
in the same action and every deleter forgets it — the three source mutators, the
external-game cover cache, and `scripts/publish-game.mjs`, which is why that
script now requires `DATABASE_URL`.

**`app_settings`** (same migration) holds the games-version counter, which
retires the `games/version.txt` sentinel — one `put` per publish and one `head`
per cache window, gone — and the kill switches described below.

Where the operations went:

| Path | Before | After |
|---|---|---|
| Serving a game asset | share of a cached `list()` | 0 |
| Polling `/games-version` | share of a cached `head()` | 0 |
| Dashboard games grid | share of a cached `list()` | 0 |
| A game's control center | 1 `list()` per view | 0 |
| Publishing one HTML file | 1 `put` + 1 `list` + 1 `put` (sentinel) | 1 `put` |
| Publishing an N-file bundle | N `put` + 1 `list` + 1 `put` | N `put` |
| Resetting a game to default | 1 `list` + 1 `put` (sentinel) | 0 advanced |

Steady state goes from ~934 advanced operations a month to one per file a person
deliberately publishes.

### Why a lossy mirror is acceptable

A blob missing from `game_blobs` reads as "this game has no override", and
`chooseGameSource()` answers that from the baked-in `public/games/` twin. That is
a **degradation, not a breakage** — the same fail-soft the original
`head()`-fails branch had, and the state every game is in between a `sync-games`
run and the next upload. So drift serves slightly stale bytes; it never 404s and
never corrupts anything. That is what lets the mirror be rebuilt lazily instead
of being a correctness cliff.

`reindexGameBlobs()` — the **only `list()` left in the application** — rebuilds
the table from one sweep. It is a super-admin button on `/dashboard/blob`, never
on a request path. Run it after applying migration 026, after publishing from a
script that could not reach the database, or after editing a blob in the Vercel
dashboard.

## The kill switches

What remains is a `put` or a `copy` per file a human deliberately publishes.
Small, but not zero — and not something a deploy should be needed to stop.

`/dashboard/blob` (super admin only) lists every feature that spends an advanced
operation, rendered straight from `ADVANCED_BLOB_OPS` in `app/lib/blob-ops.ts`,
with a switch each and a "disable everything" button that writes them all in one
statement.

| Switch | Op | Cost | What OFF means |
|---|---|---|---|
| Game source publishing | `put` | 1 per file (a 300-file zip is 300) | Upload/paste/bundle refuse with a banner. **Reset still works** — it writes no blob. |
| Game media uploads | `put` | 1 per image, ≤8 per game | The batch refuses before any of it is written. Reorder, alt text and delete are unaffected. |
| Beta replay clips | `put` | 1 per clip | The token is not minted; the report is still filed, and the tester sees the existing "clip didn't upload" toast. |
| Beta screenshot evidence | `put` | 1 per image | Same: the report is filed without the image. |
| External game cover caching | `put` | 1 per game created/re-cached | The game keeps its placeholder. Re-caching names the switch instead of shrugging. |
| Promote beta shots to gallery | `copy` | 1 per promoted shot | The shot stays **pending**, not accepted-and-invisible, so nobody is paid for a decision that was not made. Rejecting still works. |
| Rebuild the blob index | `list` | a few per sweep | The reindex button is disabled. Turn this back on **first**. |

### The env lock, for when the database is not an option

The switches live in `app_settings`, which needs migration 026 applied — and the
moment you most want to stop spending is a moment when running a migration may
not be possible. Setting **`BLOB_READ_ONLY=1`** in the environment and
redeploying forces every switch off **without reading the database at all**.

- It short-circuits *before* the settings read, not after — a lock that had to
  query first would be a lock you could not trust in the only case it is for.
- It is a **lock, not a default**: it beats an explicit `ON` row, the dashboard's
  buttons are greyed while it holds, and the write actions refuse. A switch that
  reports a state it does not have is worse than one that will not move.
- Accepted values are an explicit allow-list — `1`, `true`, `yes`, `on`
  (trimmed, case-insensitive). Anything else, including `0` and `false` (both
  truthy strings in JavaScript), fails **open** and leaves the table in charge,
  so a typo cannot silently freeze publishing.
- Vercel materialises env vars at deploy time, so a change takes effect on the
  next deployment, not the next request.

Remove the variable and redeploy to hand control back to the table.

### Running without migration 026

Every read fails soft, so an unmigrated deployment degrades rather than breaks:

| Surface | Behaviour |
|---|---|
| Serving a game | `game_blobs` is unreadable → empty index → every asset serves the `public/games/` twin. The deploy workflow runs `sync-games` before the build, so that twin is current as of the last deploy. |
| `/games-version` | Returns `"0"`; the service worker reads an unchanged version as "nothing to do". |
| Blob-op switches | All read **ON** — the fail-soft direction. Use `BLOB_READ_ONLY` instead. |
| Publishing | The blob write still succeeds; only the bookkeeping fails, and it is best-effort. The published file will not be visible to the serving route until the migration runs and the index is rebuilt. |

### Design decisions worth not re-litigating

- **A switch that cannot be read reads as ENABLED.** A Neon outage must not
  silently freeze the whole admin surface behind a message claiming somebody
  turned it off — the operator would hunt a setting nobody set. The cost is that
  during an outage a disabled feature sees Blob's own error instead of ours,
  which is what it saw before any of this existed.
- **The check goes immediately before the Blob call**, after validation. A
  switch thrown while a slow upload was still streaming is still honoured, and an
  admin whose file was going to be rejected anyway hears about the file.
- **The registry is the whole surface.** A feature not in `ADVANCED_BLOB_OPS` is
  not on the page and cannot be turned off, so listing it is part of adding it.
- **The reindex is switchable too**, so "disable everything" means everything: a
  `list()` that is going to fail is not worth attempting.
- **Nothing destructive is gated.** `del` is a simple operation; being unable to
  un-publish a broken game because the advanced allowance is spent would be the
  worst possible time for that.

## Adding a feature that writes to Blob

1. Add an entry to `ADVANCED_BLOB_OPS` in `app/lib/blob-ops.ts` — label, which
   primitive, how the spend scales, and the banner the refusal shows.
2. Call `isBlobOpEnabled(<id>)` immediately before the Blob call and turn a
   `false` into that banner.
3. If it writes under `games/`, record it with `recordGameBlobs()` and forget it
   with `forgetGameBlobs()`/`forgetGameBlobsForSlug()` in the same action.
4. If it writes anywhere else, store the URL `put()` returned on the row, the way
   `game_media.blob_url` does — never rediscover it with a `head()` per request.
