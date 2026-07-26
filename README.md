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
