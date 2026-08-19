# HALLPASS

## What this is

HALLPASS is a Next.js 16 site hosting 26 unblocked browser games. A game is either a single self-contained `index.html` or a **multi-file bundle** (its own JS, images, audio in subfolders). Each game runs inside an iframe pointed at `/game-html/<slug>/` — the trailing slash is load-bearing: it makes the game's relative asset URLs resolve inside its own directory. That URL hits `app/game-html/[slug]/[[...path]]/route.ts`, which serves **every game file blob-first**: it streams `games/<slug>/<file>` from Vercel Blob when present and 307s to the baked-in copy under `public/games/<slug>/` otherwise. Once a visitor loads the site, a hand-rolled service worker precaches the shell, every hashed JS/CSS chunk, every game route, and every game file — so the entire arcade keeps working with no network.

## Stack

- Next.js 16 App Router with Turbopack
- React 19
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- Vercel Blob (`@vercel/blob`) for game HTML storage
- PostHog (`posthog-js` on the client; PostHog REST API on the server for play-count stats)
- Deployed on Vercel

## Repo layout

```
app/
  page.tsx              catalog (renders <Arcade>)
  game/[slug]/          game detail page (iframe host)
  game-html/[slug]/[[...path]]/  server route: serves ANY game file blob-first, 307s to static fallback
  games-version/        version endpoint the SW polls (head().uploadedAt.getTime())
  admin/html/           legacy URL — redirects to /dashboard/games (source editing lives there now)
  components/
    Arcade.tsx          catalog UI
    PWA.tsx             SW registration + offline pill + version polling
  lib/
    games.ts            canonical games[] list (slug, title, category, art, ...)
    game-html-blob.ts   blob namespace games/<slug>/**, path allowlist, content types
    games-version-blob.ts  blob path: games/version.txt
    admin-html-auth.ts  cookie session for /admin/html
    stats.ts            PostHog play-count fetcher (server-side)
    tracker/            admin project tracker: config, store, schema (see below)
  manifest.ts           PWA manifest route (/manifest.webmanifest)
  layout.tsx            root layout, fonts, metadata, mounts <PWA />
public/
  games/<slug>/         static fallback per game: index.html + cover.png (+ any bundle files/subfolders)
  sw.js                 service worker (hand-rolled, not Workbox)
  sw-manifest.js        AUTO-GENERATED at postbuild — do not edit
  icon-{192,512,maskable-512}.png
scripts/
  build-sw-manifest.mjs runs as `postbuild`; emits public/sw-manifest.js
  sync-games.mjs        mirrors every games/** blob back into public/games/ (multi-file aware)
AGENTS.md               AI-agent warning about Next 16 breaking changes
```

## Local development

```bash
npm install
npm run dev
```

The service worker is intentionally **not** registered under `next dev` (see the `NODE_ENV !== "production"` guard in `app/components/PWA.tsx`). To exercise offline behavior locally:

```bash
npm run build && npm start
```

Then visit, kill the network in DevTools, and navigate around.

## Adding a new game

Adding a brand-new game requires a redeploy — the `games[]` array in `app/lib/games.ts` is what drives `generateStaticParams` for every game route, and the postbuild SW manifest is generated against that build.

1. Add an entry to `app/lib/games.ts` with `slug`, `title`, `tagline`, `description`, `category`, `tags`, `gradient`, `accent`, `art` (and optionally `isNew`, `isFeatured`, `plays`). There is no "multi-file" flag — a single-file game is just a bundle whose only file is `index.html`.
2. Drop the game under `public/games/<slug>/` — a self-contained `index.html`, or a whole folder tree (`index.html` at the root plus JS/asset subfolders, relative refs only) — and a `public/games/<slug>/cover.png`.
3. Optionally publish the same files to Blob (dashboard → the game → Source code: single HTML, or a `.zip` bundle) so online users get the Blob copy without waiting for the deploy.
4. Commit and deploy. (The `/add-game` Claude skill automates 1–3 from a dropped HTML file or game folder.)

## Updating an existing game's source

**BLOB IS THE LIVE COPY. `public/games/<slug>/` IS A MIRROR OF IT.** Editing a
game in the repo and merging it does **nothing**: the deploy runs
`npm run sync-games` *before* the build, which copies Blob→repo unconditionally,
overwriting the edit and shipping the old blob copy. Nothing fails — the change
is silently discarded, and the game keeps running the old code. A fix can be
merged, green, deployed, and still absent in a private window. `sync-games` now
prints a `WARN: replaced a DIFFERENT local copy` line and an end-of-run summary
naming every file it did this to, so CI logs answer the question on their own.

There are two supported ways to change a game:

1. **The dashboard** — paste or upload the new source. This is the only route
   for a multi-file bundle, because it also deletes the files a new upload
   orphans.
2. **`npm run publish-game -- <slug>`** — publishes the repo's own
   `public/games/<slug>/index.html` to Blob and bumps the version sentinel, so a
   repo-authored edit can actually reach players. Dry-run by default; pass
   `--yes` to write. Single-file games only; it refuses a bundle rather than
   risk orphaning assets. Needs `BLOB_READ_WRITE_TOKEN` (or `.env.local`).

   One caveat: the dashboard revalidates the serving-blob cache tag right after
   writing, and a script cannot reach Next's data cache — so a publish this way
   can take up to the listing TTL (1h) to appear. Redeploy to clear it sooner.

Which copy actually serves is decided by `chooseGameSource`: a blob uploaded
since `MIRROR_SYNCED_AT` is proxied (so a fresh publish is live immediately),
otherwise the free static twin is 307'd to.

## Player features: stealth mode & daily streak

Two device-local, no-backend player features live under `app/lib/{stealth,streak}` and `app/components/{stealth,streak}`. Both are pure client islands that render an empty state on the server and hydrate from `localStorage`, so every page that mounts them stays statically prerenderable (and therefore precached — same rule as the rest of the site).

**Stealth mode** (`app/lib/stealth`) — the boss key and tab cloak.
- *Tab cloak* disguises the tab's title + favicon as Google Docs / Classroom / Drive / Google / New Tab. Presets (`cloaks.ts`) carry inline `data:` SVG favicons — no network, no shipped third-party bitmaps. `boot.ts` emits a `beforeInteractive` inline script (mounted in `layout.tsx`) that applies the saved cloak during head parse, so a disguised tab never flashes "HALLPASS" on a cold load; `StealthController` keeps the title pinned across Next's per-navigation title rewrites via a `MutationObserver`, remembering the real title so turning the cloak off restores it.
- *Panic key* (`StealthController`, default `` ` ``) throws a full-viewport fake screen (`PanicScreen`: original, asset-free Docs/Classroom/Search recreations) over the arcade; press again or Escape to dismiss. Caveat: while a game iframe holds focus the browser routes keys to the iframe, so it fires on the catalogue/store pages, not mid-game.
- Prefs (`store.ts`) persist in `hp:stealth`; the settings modal is reached from the sidebar footer / mobile drawer.

**Daily streak** (`app/lib/streak`) — a consecutive-days-played flame.
- `core.ts` is the pure, clock-free model (local `YYYY-MM-DD` keys, DST-safe day math); `store.ts` persists `hp:streak` and stamps the day from `recordPlay()`, called in `PlayerOverlay` right where recently-played is recorded (idempotent per calendar day).
- `StreakChip` (header) shows the live streak with a 7-day popover + all-time best; `StreakToast` celebrates an advance and milestones.

## Admin project tracker

`/dashboard/tracker` is the internal work board: admins paste in what they want
built, tag it, and read the status back. It is **admin-only** (`requireRole("admin")`),
never public, and nothing about it is exposed through `/api/v1/*`.

One entity — the item — because the pasted brief *is* the tracked thing. Tags do
the grouping; there is no priority, effort, due date or assignee. Six lanes,
worded for the reader: `new → planned → building → shipped`, plus `parked` (not
now, still want it) and `declined` (not doing it), which stay separate so the
board can tell those two apart. `tracker_updates` carries dated progress notes,
`tracker_events` the auto-written activity trail.

**Two things are super-admin-only: moving an item between lanes, and deleting
one for good.** Everything else is collaborative — any admin can paste a brief
in, edit it, retag it, post updates and archive. The status is restricted
because it is a claim about the work ("being built right now", "live on the
site") that only whoever is building it can make truthfully; a plain admin sees
it as a read-only chip and says what they know in an update instead. Deleting is
restricted because it is the one unrecoverable control on the surface: the row
goes and the tags and updates CASCADE with it, leaving only the activity trail.
Archiving is the reversible alternative and stays open to everyone.

Both the action guards and the conditions the page renders those controls under
read `TRACKER_DEV_ROLE` / `canMoveStatus` / `canDeleteItem` from
`app/lib/tracker/config.ts`, so they cannot drift apart. The server actions
re-check regardless — a hidden form is still a reachable endpoint.

Backed by `app/lib/tracker/` and migration `021_tracker.sql`. **That migration
must be applied before the board works** — until then the page renders a
"run the migration" notice rather than an empty board:

```bash
npm run migrate -- --status   # confirm 021 is PENDING, and check the target host
npm run migrate
```

Neon branching means it has to be applied to every branch the app runs against.
See `tracker-design.md` for the full design, what is deliberately excluded, and
the deferred GitHub-issues integration (the `gh_*` columns ship unused).

## Friend challenges

A **challenge** is a score to beat on a board, aimed at a friend. The game
triggers it through the Scoreboard SDK, HallPass draws the picker, and the row
resolves itself the moment the target posts a qualifying score. See
`challenge-design.md` for the full argument and what is deliberately excluded.

**The loop.** In a game, `HallPass.challenge()` opens a small HallPass-styled
picker over the canvas — the site's design system, not the game's, and not a
full-page takeover. The player picks a friend and sends; the score to beat is
their OWN best on that board, resolved server-side, so nobody can dare a friend
to beat a number they never scored. The target sees it in the Challenges tab on
`/play/friends` and as a chip on `/game/<slug>`, presses Play, and beating the
score closes the challenge automatically from the ordinary score-submission
path.

**Same-origin vs external games.** Hosted games are served from
`/game-html/<slug>/` on our own origin, so the picker is an inline frame and the
session cookie flows. An externally-hosted game is cross-origin, where a nested
HallPass frame is a third-party context whose cookie the browser may withhold —
there the SDK opens a popup window instead. The game never has to know which it
got.

**Accepting.** There is no Accept button: pressing Play stamps `accepted_at`.
Only friends can challenge you, so consent is already covered, and gating
resolution on acceptance would mean beating the score after launching from the
catalogue did not count. Dismissing never reports "declined" back to the sender
— the same courtesy `social/config.ts` applies to declined friend requests.

**Built to extend.** One table with a `kind` discriminator models *a goal on a
board*, with participants and time as separate nullable dimensions, so a
site-wide monthly challenge is later a new kind plus a CHECK rather than a
rewrite. Resolution never branches on kind. **Nothing builds the `seasonal`
kind** — it is a seam, not a feature.

**From your own scores, too.** `/play/you` lists every board you have entered,
and each row carries **Challenge** (the same picker, reached from a score you
set last week rather than from inside the game) and **Share** — see below.

Backed by `app/lib/challenges/` and migration `022_challenges.sql`. **That
migration must be applied before challenges work**; until then every read
degrades to empty and the surfaces render nothing.

### Challenge links

A **challenge link** is the same dare aimed at nobody in particular: a URL you
paste into a group chat. Anyone who opens `/c/<code>` sees the score to beat and
one button, and **plays immediately with no account**. The ask to sign in comes
only after they have a score worth keeping. See `challenge-sharing-design.md`
for the argument and `challenge-onboarding-ux.md` for the funnel research.

**Two new kinds on the challenges table.** `link` is the invitation — an owner,
no target, a code, never resolved and never in an inbox. `link_claim` is one
person taking it up, and it is target-shaped on purpose: that is what lets the
ordinary score path resolve it with no new branch.

**One link per (player, board).** Sharing again keeps the same URL and refreshes
the score under it, so a link posted once stays good. Each taker snapshots the
number when they take it up, so an owner improving their score never moves the
target under somebody mid-attempt. Sharing after a **revoke** issues a NEW code
— a killed URL stays dead.

**The page never navigates, and that is load-bearing.** The SDK holds anonymous
claim tokens in memory only (so a shared school computer cannot leak one child's
scores to the next), and they die with the game frame. So the player mounts on
`/c/<code>` itself and sign-in opens a popup pointed at `/play/auth/complete` —
the SDK hears that broadcast and flushes the claim from inside the still-live
frame. A same-tab redirect would silently bin the score being claimed.

**Claiming resolves challenges.** `POST /api/v1/me/claim` now re-runs resolution
over every score it transfers. Without it the whole flow has no ending; it also
fixes the same hole for ordinary friend challenges, where playing anonymously
and signing in later never counted.

**Hosted games only.** A cross-origin game mints no claim token, so nobody
following such a link could keep what they scored — the Share button is hidden
for those rather than offered and refused.

**No avatar, anywhere.** The landing and its preview card carry a handle and a
number. Sign-in is Google-only, so an avatar is frequently a real photograph of
a child, and this is a page designed to be broadcast and cached on strangers'
devices. `/c/` is crawlable and `noindex` (the same argument as `/u/`), never
precached, and revocable from `/play/you`.

**Escaping in-app browsers.** A link's default home is Instagram's or Snapchat's
webview, where Google refuses OAuth. On the "Beat it" tap — the one moment
nothing exists to lose — the page may try `x-safari-https:` / `intent://` to
reopen in the real browser, raced against a 1200ms bail-out. **Off by default**,
behind the PostHog flag `challenge-link-webview-escape`, because the escape
schemes are undocumented and unverified against current app builds.

**A cap worth knowing about.** Google Workspace for Education blocks under-18
accounts from third-party apps a school admin has not approved, and this site
will not be approved. Pupils signed into a school account on a Chromebook cannot
complete sign-in at all. Everything before that step still works, which is
another reason the flow plays first; the account chooser is forced
(`prompt=select_account`) so anyone with a personal account can switch to it.

Backed by `app/lib/challenges/link.ts`, `app/c/[code]/` and migration
`025_challenge_links.sql`. **That migration must be applied before links work**;
until then minting reports the feature unavailable and `/c/<code>` says the
challenge cannot be found.

### Notifications

Two layers, and they fail independently.

**The bell** is the in-app inbox in the site header, plus
`/play/you/notifications` for the full history and every preference. Backed by
`app/lib/notifications/` and migration `024_notifications.sql`. **That migration
must be applied before anything is stored**; until then every read degrades to an
empty bell and the header is unaffected. It needs no VAPID keys and works
offline-last (the endpoint is never precached).

**Push** is optional on top, and **off unless VAPID keys are configured** (see
`.env.example`) — without them everything still lands in the bell, it is just
pulled on a visit rather than pushed. Backed by `app/lib/push/` and migration
`023_push_subscriptions.sql`.

- **Kinds and defaults** live in `app/lib/notifications/config.ts`, never in a
  table: a kind needs a producer and worded copy, so a table would allow one
  nothing can emit. `notification_prefs` stores only **deviations**, which is
  what lets a new kind go live for everybody with no backfill. Channels are
  `off` < `bell` < `push`, and `push` implies `bell`.
- **What is loud by default** is what is about you personally — a challenge, a
  friend request, a playtest assignment. A **game drop is bell-only** by default
  because it fires for the whole site at once; push for drops is one toggle away.
- **Admin kinds** (new review, reported review, bug report) are resolved against
  `dashboard_users` plus `SUPER_ADMIN_EMAILS` **at send time**, so losing the
  role loses the notifications with no cleanup step. An admin who has never
  signed into the arcade has no player row and simply gets nothing.
- **Coverage.** Android Chrome, desktop Chrome, Firefox and Edge. On iOS, Web
  Push works **only for a PWA added to the Home Screen** (16.4+) — in a Safari
  tab there is nothing, so an iPhone user has to install the app first.
- **The permission ask** has two routes now: the **"This device" card** on
  `/play/you/notifications`, which is the one somebody can go and find, and
  `FeaturePromo`, which still only fires once a player has actually **received**
  a challenge. Prompting on arrival would spend the one prompt they ever get on
  a feature they have not seen work, and a denial cannot be re-asked from script.
- **Quiet notifications** are an opt-in toggle in **Stealth settings**. On, a
  challenge reads "HallPass — you have a new challenge" with no sender and no
  game. The default is full detail: a phone is a personal device, and a nameless
  banner wastes the feature for most people. It is **per device**, so the same
  person can have detail on their phone and discretion on a school Chromebook.
- **How that works.** A service worker cannot read `localStorage`, where the
  stealth preferences live, and a push arrives with no tab open to ask. So the
  server sends BOTH renderings and `sw.js` picks one by a flag mirrored into
  IndexedDB. The worker never reconstructs the wording — if it did, the discreet
  version would exist twice and could drift in the direction that leaks.
- **No cron is involved anywhere.** Sends happen inline on the event, a dead
  subscription is deleted the moment a push service answers `410 Gone`, and
  notification retention is a cap applied in the same statement as each insert.
  This is also why **admin alerts for traffic spikes are deliberately not built**
  — detecting one needs a scheduler. See `notifications-design.md` §7.

## Friends on the leaderboard

`/game/<slug>` shows a signed-in player **where they and their friends stand on
that game's board** — the friend set only, the viewer included, ordered by who is
winning and annotated with each score's rank on the whole board. See
`friends-leaderboard-design.md` for the argument and what is deliberately
excluded.

**No migration.** It reads `friendships`, `boards`, `scores` and `players`, all of
which have existed since `001`/`007`; the feature is the `JOIN` those four tables
had never been read through together.

- **One query.** `store.getFriendStandingsForGame()` builds the friend set
  (including the viewer), collapses each member to their personal best per board,
  and caps rows-per-board and boards-per-game **in SQL** with window functions —
  so a player with hundreds of friends cannot make the query expensive, and a
  busy first board cannot starve the second. The asc/desc branch lives in `CASE`
  expressions over the stored `boards.sort`; no fragment is ever spliced.
- **The rank is the global one**, computed as `1 + strictly-better rows` — the
  same semantics as `rankForScore` and `getPlayerStandings`, imprecision
  included, so this panel and `/play/you` can never print different ranks for the
  same person on the same board. Changing it means changing both.
- **Anonymous scores cannot appear**, by construction: the join keys on
  `scores.player_id`, which is NULL for a guest submission.
- **A client island** (`components/friends/FriendsBoard.tsx`) fed by
  `GET /api/v1/me/friends/scores?slug=<game>` — never a server read, because one
  `auth()` on `/game/[slug]` would make the route dynamic and drop every game
  page from the service-worker precache. It renders nothing when it has nothing
  to say (signed out, no friends, no scores, no board, offline).
- **Ties share a position** (`=1`, competition numbering) rather than being
  ordered by a coin flip, and the panel's grouping/numbering/prompt rules live in
  the pure `lib/scoreboard/friend-board.ts` — the island is a fetch and markup,
  so everything worth being wrong about is under test.
- **A player alone on their own board** gets one line: "add a friend" when they
  have none, "challenge one of them" when their friends simply have not played
  this. Telling those apart costs a friend count, so the endpoint reads one
  **only** when no friend row came back.
- **Challenge from the board.** `ChallengeButton` (moved to
  `components/challenges/`, now shared with `/play/you`) appears per board the
  viewer has scored on, so the route's `no-score` refusal is unreachable from it.
- **One event**, `friends_board_shown`, with `state` / `boards` /
  `friends_on_board`.
- **Not** a `?scope=friends` on `/api/v1/leaderboard/<board>`: that route is
  wildcard-CORS and credential-less because games call it cross-origin, and a
  per-viewer scope there would mean credentialed CORS for arbitrary game origins.

## Offline / PWA architecture

On the first visit the SW (`public/sw.js`) opens `hp-static-<BUILD_ID>` and precaches every URL in `self.__SW_PRECACHE` (generated at build time): the site shell, every prerendered route, every hashed `_next/static/{chunks,css,media}` asset, every `/game-html/<slug>/` game document (slash form — it must byte-match the iframe URL), and every file under `public/games/<slug>/` (the static twins of the Blob files, covers included). On a typical build this is ~150 URLs.

Three caches:
- `hp-static-<BUILD_ID>` — per-deploy precache; old generations are swept on `activate`.
- `hp-runtime` — stable across deploys; populated by network-first/cache-first runtime strategies.
- `hp-meta` — stable; holds the `games-version` sentinel (key: `https://hallpass.local/__sw__/games-version`).

Fetch strategies (same-origin only — PostHog, ads, etc. pass through):
- `/admin`, `/dashboard`, `/api/`, `/games-version` — never intercepted.
- `/game-html/<slug>/…` (game documents AND bundle assets) — network-first with `redirect: "manual"` (so a 307 to the static fallback isn't redirect-poisoned into the cache). A 307 is treated as the authoritative "no Blob copy" signal: the stale runtime entry is evicted and the static twin (`/games/<slug>/<file>`) is served. Offline or on transient errors: runtime cache → static twin cache → network → synthesized 503.
- HTML navigations — network-first. Offline it serves **the fresher of the two cached copies**, comparing the `Date` header of the `hp-static-<BUILD_ID>` entry against the `hp-runtime` one, then a loose (query-ignoring) match, then `/offline`, then a synthesized page. The comparison matters in both directions: `hp-runtime` is never swept so it can hold a PREVIOUS deploy's HTML, while the precache is written once at install and never refreshed, so it goes stale against anything that changes WITHIN a deploy (an ISR revalidation, a dashboard edit). Because the precache is rebuilt per deploy and fetched with `cache: "reload"`, "the runtime entry is newer" is exactly "it was written during this deploy". A missing or unparseable date falls back to the precache.
- Hashed assets — cache-first, populating `hp-runtime` on miss.

Update flow for game sources: dashboard publish → `bumpGamesVersion()` writes `games/version.txt` in Blob → `/games-version` returns `head().uploadedAt.getTime()` → client polls (debounced, also fires on `visibilitychange`) → posts `CHECK_GAMES_VERSION` to the SW → SW compares against the value stored in `hp-meta` and runs `refreshAllGameHtml()` on mismatch. That refresh covers every precached game document PLUS every `/game-html/` entry the runtime cache accumulated during play (i.e. bundle assets), and evicts entries whose Blob copy was deleted — so offline clients converge instead of keeping a torn new-index/old-assets mix.

SW upgrade flow on a new deploy: the new `sw.js` (with a new `BUILD_ID` baked into its imported manifest) installs → `updatefound` fires on the page → client posts `SKIP_WAITING` → `controllerchange` fires → the page reloads exactly once (guarded by a module-scope `reloaded` flag).

## Environment variables

Derived from `process.env.*` references in the codebase. Configure these in Vercel project settings (and `.env.local` for development). See `.env.example` for a copy-paste starting point.

| Var | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | `instrumentation-client.ts` | **Required for any analytics data.** Client-side PostHog capture token (browser → PostHog). `NEXT_PUBLIC_` vars are inlined at **build time**, so it must be set in Vercel *before* the build runs; if it is missing, `posthog.init` no-ops and **zero events** are captured (not even autocapture / pageviews). Find it in PostHog → Project settings. |
| `BLOB_READ_WRITE_TOKEN` | `@vercel/blob` (`put`, `head`, `del`) | Auto-provisioned by Vercel when a Blob store is linked. |
| `ADMIN_HTML_PASSWORD` | `app/lib/admin-html-auth.ts` | Plain string; gates `/admin/html`. Required for uploads. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `app/lib/push/config.ts` | Optional. Web Push signing pair for notifications; generate with `npx web-push generate-vapid-keys`. Unset means the push path reports itself unavailable and stays silent — the bell still works, and notifications are pulled rather than pushed. Deliberately NOT `NEXT_PUBLIC_`: the public key is served at request time from `GET /api/v1/me/push`, so adding it takes effect on the next request rather than the next build. |
| `VAPID_SUBJECT` | `app/lib/push/config.ts` | A `mailto:` the push service can contact about a misbehaving sender. Required by the VAPID spec. |
| `POSTHOG_API_HOST` | `app/lib/stats.ts` | Defaults to `https://eu.posthog.com`. |
| `POSTHOG_PROJECT_ID` | `app/lib/stats.ts` | PostHog project numeric id. |
| `POSTHOG_PERSONAL_API_KEY` | `app/lib/stats.ts` | Personal API key with read access for play-count queries (server-side read; separate from the client capture token above). |

## Scripts

- `npm run dev` — Next dev server (no SW).
- `npm run build` — production build with Turbopack.
- `npm run postbuild` — runs `node scripts/build-sw-manifest.mjs`; reads `.next/BUILD_ID`, the build/app-build/prerender manifests, and sweeps `.next/static/{chunks,css,media}`; writes `public/sw-manifest.js` with `__SW_BUILD_ID` and `__SW_PRECACHE`.
- `npm start` — serve the production build.
- `npm run lint` — ESLint with `eslint-config-next`.
- `npm run sync-games` — runs `scripts/sync-games.mjs`; mirrors every `games/**` blob into `public/games/` (needs `BLOB_READ_WRITE_TOKEN`).

## Deploying

Vercel auto-deploys from the `main` branch. After a merge: Vercel runs `next build`, the `postbuild` hook regenerates `public/sw-manifest.js` with the new `BUILD_ID`, and once the deploy is live every existing PWA client picks up the new SW on next visit, posts `SKIP_WAITING`, and reloads once.

The `Deploy to Vercel` GitHub Action (`.github/workflows/deploy.yml`) pulls the production env, then runs `scripts/check-build-env.mjs` **before** building. This fails the deploy if `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is missing — because that var is inlined at build time, a missing token would otherwise ship a build that silently captures zero analytics. Missing server-side PostHog vars only warn. Set `POSTHOG_ENV_CHECK=warn` to make the client-token check non-blocking too. Super admins can also confirm the same at runtime on `/dashboard/logs`.

## Known caveats

- The service worker only registers in production builds. `next dev` will look like a non-PWA.
- Adding a new game requires a redeploy; updating an existing game's HTML does not.
- A user who installs the PWA, goes offline before ever opening game X online, and then opens game X will see the static fallback baseline — which lags Blob until you run `npm run sync-games` and redeploy.
- `public/sw-manifest.js` is auto-generated. Do not hand-edit it; regenerate via `npm run build`.

## License

Copyright © Ozan Kaygusuz and Ateş Demir. All rights reserved.

This repository is published for reference and transparency only. **No license is granted**, express or implied, to copy, redistribute, modify, mirror, deploy, or otherwise use any part of this project, including but not limited to:

- the game HTML bundles under `public/games/` and any HTML uploaded to the project's Vercel Blob store,
- the HALLPASS name, branding, icons, copy, and visual design,
- the catalog data in `app/lib/games.ts`,
- the application source code in `app/`, `scripts/`, and `public/`.

You may not host a copy of this site, re-skin it, fork it for your own arcade, or re-publish individual games elsewhere. Hotlinking the games or scraping the Blob store is also not permitted.

Reading the source to learn how something works is fine. If you want to use any part of it for anything else, ask first: **smartlizardpy@duck.com**.

---

See `AGENTS.md` for AI-agent guidance — Next 16 has breaking changes from training data.
