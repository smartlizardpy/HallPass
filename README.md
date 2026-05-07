# HALLPASS

## What this is

HALLPASS is a Next.js 16 site hosting 25 unblocked browser games. Each game runs inside an iframe pointed at `/game-html/[slug]`, which streams the latest HTML bundle from Vercel Blob and falls back to a baked-in static copy under `public/games/<slug>/index.html`. Once a visitor loads the site, a hand-rolled service worker precaches the shell, every hashed JS/CSS chunk, every game route, and every cover image — so the entire arcade keeps working with no network.

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
  game-html/[slug]/     server route: streams Blob HTML, 307s to static fallback
  games-version/        version endpoint the SW polls (head().uploadedAt.getTime())
  admin/html/           password-gated admin: upload / paste / clear game HTML in Blob
  components/
    Arcade.tsx          catalog UI
    PWA.tsx             SW registration + offline pill + version polling
  lib/
    games.ts            canonical games[] list (slug, title, category, art, ...)
    game-html-blob.ts   blob path: games/<slug>/index.html
    games-version-blob.ts  blob path: games/version.txt
    admin-html-auth.ts  cookie session for /admin/html
    stats.ts            PostHog play-count fetcher (server-side)
  manifest.ts           PWA manifest route (/manifest.webmanifest)
  layout.tsx            root layout, fonts, metadata, mounts <PWA />
public/
  games/<slug>/         static fallback index.html + cover.png per game
  sw.js                 service worker (hand-rolled, not Workbox)
  sw-manifest.js        AUTO-GENERATED at postbuild — do not edit
  icon-{192,512,maskable-512}.png
scripts/
  build-sw-manifest.mjs runs as `postbuild`; emits public/sw-manifest.js
  sync-games.sh         pulls live /game-html/<slug> back into public/games/<slug>/
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

1. Add an entry to `app/lib/games.ts` with `slug`, `title`, `tagline`, `description`, `category`, `tags`, `gradient`, `accent`, `art` (and optionally `isNew`, `isFeatured`, `plays`).
2. Drop a fallback `public/games/<slug>/index.html` (a self-contained playable build) and a `public/games/<slug>/cover.png`.
3. Optionally upload the latest HTML to Blob via `/admin/html` so online users get the fresh bundle from Blob instead of the committed fallback.
4. Commit and deploy.

## Updating an existing game's HTML

Two paths, depending on whether you want to redeploy.

**Admin upload (no redeploy).** Sign in at `/admin/html` with `ADMIN_HTML_PASSWORD`, then upload or paste the new HTML for the chosen slug. The handler in `app/admin/html/page.tsx` writes `games/<slug>/index.html` to Blob (`allowOverwrite: true`) and bumps `games/version.txt` in the same Blob store. Online visitors get the new bundle on their next play. Existing PWA installs poll `/games-version` (debounced to 30s in `PWA.tsx`); on a version change the SW re-precaches every `/game-html/<slug>` in the background. Note: a user who installs the PWA, goes offline, and *then* opens a game they never played online will fall through to the static fallback baked into the deploy.

**Local sync + commit (refreshes the static baseline).** Run:

```bash
./scripts/sync-games.sh https://your-site.vercel.app
```

This iterates every directory under `public/games/`, curls `/game-html/<slug>` from the supplied origin, and writes the response to `public/games/<slug>/index.html`. Commit the diff and deploy — now the static fallback shipped in the bundle matches what's in Blob.

## Offline / PWA architecture

On the first visit the SW (`public/sw.js`) opens `hp-static-<BUILD_ID>` and precaches every URL in `self.__SW_PRECACHE` (generated at build time): the site shell, every prerendered route, every hashed `_next/static/{chunks,css,media}` asset, every `/game-html/<slug>`, every `/games/<slug>/index.html` static fallback, and every cover image. On a typical build this is ~134 URLs.

Three caches:
- `hp-static-<BUILD_ID>` — per-deploy precache; old generations are swept on `activate`.
- `hp-runtime` — stable across deploys; populated by network-first/cache-first runtime strategies.
- `hp-meta` — stable; holds the `games-version` sentinel (key: `https://hallpass.local/__sw__/games-version`).

Fetch strategies (same-origin only — PostHog, ads, etc. pass through):
- `/admin`, `/dashboard`, `/api/`, `/games-version` — never intercepted.
- `/game-html/<slug>` — network-first with `redirect: "manual"` (so a 307 to the static fallback isn't redirect-poisoned into the cache); on failure: runtime cache → static cache → fetch `/games/<slug>/index.html` → synthesized 503.
- HTML navigations — network-first, falling back to cache, then `/`, then a synthesized offline page.
- Hashed assets — cache-first, populating `hp-runtime` on miss.

Update flow for game HTML: admin upload → `bumpGamesVersion()` writes `games/version.txt` in Blob → `/games-version` returns `head().uploadedAt.getTime()` → client polls (debounced, also fires on `visibilitychange`) → posts `CHECK_GAMES_VERSION` to the SW → SW compares against the value stored in `hp-meta` and runs `refreshAllGameHtml()` on mismatch.

SW upgrade flow on a new deploy: the new `sw.js` (with a new `BUILD_ID` baked into its imported manifest) installs → `updatefound` fires on the page → client posts `SKIP_WAITING` → `controllerchange` fires → the page reloads exactly once (guarded by a module-scope `reloaded` flag).

## Environment variables

Derived from `process.env.*` references in the codebase. Configure these in Vercel project settings (and `.env.local` for development).

| Var | Where used | Notes |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | `@vercel/blob` (`put`, `head`, `del`) | Auto-provisioned by Vercel when a Blob store is linked. |
| `ADMIN_HTML_PASSWORD` | `app/lib/admin-html-auth.ts` | Plain string; gates `/admin/html`. Required for uploads. |
| `POSTHOG_API_HOST` | `app/lib/stats.ts` | Defaults to `https://eu.posthog.com`. |
| `POSTHOG_PROJECT_ID` | `app/lib/stats.ts` | PostHog project numeric id. |
| `POSTHOG_PERSONAL_API_KEY` | `app/lib/stats.ts` | Personal API key with read access for play-count queries. |

## Scripts

- `npm run dev` — Next dev server (no SW).
- `npm run build` — production build with Turbopack.
- `npm run postbuild` — runs `node scripts/build-sw-manifest.mjs`; reads `.next/BUILD_ID`, the build/app-build/prerender manifests, and sweeps `.next/static/{chunks,css,media}`; writes `public/sw-manifest.js` with `__SW_BUILD_ID` and `__SW_PRECACHE`.
- `npm start` — serve the production build.
- `npm run lint` — ESLint with `eslint-config-next`.
- `npm run sync-games` — wraps `scripts/sync-games.sh`; pulls live `/game-html/*` into `public/games/*`.

## Deploying

Vercel auto-deploys from the `main` branch. After a merge: Vercel runs `next build`, the `postbuild` hook regenerates `public/sw-manifest.js` with the new `BUILD_ID`, and once the deploy is live every existing PWA client picks up the new SW on next visit, posts `SKIP_WAITING`, and reloads once.

## Known caveats

- The service worker only registers in production builds. `next dev` will look like a non-PWA.
- Adding a new game requires a redeploy; updating an existing game's HTML does not.
- A user who installs the PWA, goes offline before ever opening game X online, and then opens game X will see the static fallback baseline — which lags Blob until you run `sync-games.sh` and redeploy.
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
