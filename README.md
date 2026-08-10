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

Two paths, depending on whether you want to redeploy.

**Dashboard upload (no redeploy).** Open `/dashboard/games/<slug>` (admin role) → Source code. Upload/paste a single HTML file, or upload a whole `.zip` bundle (`index.html` at the zip root; ≤300 files, ≤10MB per file, ≤50MB unzipped; "zipped the folder" archives are unwrapped automatically). Publishing **converges** the Blob set to exactly what you upload: a bundle upload deletes blobs missing from the new zip, a single-file upload deletes leftover bundle assets, and "Reset to default" deletes every published blob so the committed copy serves again. Every publish bumps `games/version.txt`; online visitors get the new source on their next play, and PWA clients refresh their cached game files on the next version poll.

**Local sync + commit (refreshes the static baseline).** Run:

```bash
npm run sync-games
```

This runs `scripts/sync-games.mjs`: it reads `BLOB_READ_WRITE_TOKEN` (env or `.env.local`), lists every `games/**` blob (skipping the `games/version.txt` sentinel), validates each path, and mirrors each file into `public/games/<slug>/…`. It never deletes local files (`cover.png` lives only in the repo) and exits non-zero if any file fails. Commit the diff and deploy — now the static fallback shipped in the build matches what's in Blob.

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

Backed by `app/lib/challenges/` and migration `022_challenges.sql`. **That
migration must be applied before challenges work**; until then every read
degrades to empty and the surfaces render nothing.

### Notifications

Optional, and **off unless VAPID keys are configured** (see `.env.example`) —
without them challenges still work, they are just pulled on a visit rather than
pushed. Backed by `app/lib/push/` and migration `023_push_subscriptions.sql`.

- **Coverage.** Android Chrome, desktop Chrome, Firefox and Edge. On iOS, Web
  Push works **only for a PWA added to the Home Screen** (16.4+) — in a Safari
  tab there is nothing, so an iPhone user has to install the app first.
- **The permission ask** comes through `FeaturePromo`, and only once the player
  has actually **received** a challenge. Prompting on arrival would spend the
  one prompt they ever get on a feature they have not seen work, and a denial
  cannot be re-asked from script.
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
- **No cron is involved anywhere.** Sends happen at challenge-creation, and a
  dead subscription is deleted the moment a push service answers `410 Gone`.

## Offline / PWA architecture

On the first visit the SW (`public/sw.js`) opens `hp-static-<BUILD_ID>` and precaches every URL in `self.__SW_PRECACHE` (generated at build time): the site shell, every prerendered route, every hashed `_next/static/{chunks,css,media}` asset, every `/game-html/<slug>/` game document (slash form — it must byte-match the iframe URL), and every file under `public/games/<slug>/` (the static twins of the Blob files, covers included). On a typical build this is ~150 URLs.

Three caches:
- `hp-static-<BUILD_ID>` — per-deploy precache; old generations are swept on `activate`.
- `hp-runtime` — stable across deploys; populated by network-first/cache-first runtime strategies.
- `hp-meta` — stable; holds the `games-version` sentinel (key: `https://hallpass.local/__sw__/games-version`).

Fetch strategies (same-origin only — PostHog, ads, etc. pass through):
- `/admin`, `/dashboard`, `/api/`, `/games-version` — never intercepted.
- `/game-html/<slug>/…` (game documents AND bundle assets) — network-first with `redirect: "manual"` (so a 307 to the static fallback isn't redirect-poisoned into the cache). A 307 is treated as the authoritative "no Blob copy" signal: the stale runtime entry is evicted and the static twin (`/games/<slug>/<file>`) is served. Offline or on transient errors: runtime cache → static twin cache → network → synthesized 503.
- HTML navigations — network-first, falling back to cache, then `/`, then a synthesized offline page.
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
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `app/lib/push/config.ts` | Optional. Web Push signing pair for challenge notifications; generate with `npx web-push generate-vapid-keys`. Unset means the notification path reports itself unavailable and stays silent — challenges still work, pulled rather than pushed. Deliberately NOT `NEXT_PUBLIC_`: the public key is served at request time from `GET /api/v1/me/push`, so adding it takes effect on the next request rather than the next build. |
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
