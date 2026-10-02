# Cover art — how a changed cover reaches every surface

A game's cover is **data, not a file**. Changing it needs no code change and
**commits nothing to GitHub**.

## Source of truth

`game_overrides.cover_url` (native games) or `external_games.cover_url`
(off-site games) holds a `/game-media/<slug>/<id>.<ext>` path. The image is a
`game_media` row (Vercel Blob under `game-media/<slug>/`) with `kind = 'hero'`,
which keeps it out of the gallery and its 8-image cap. With no override a native
game falls back to the static `coverUrl`, then the committed
`public/games/<slug>/cover.png` (the "original cover").

## Changing it — Dashboard → Games → *game* → Cover

Available for staged and live games (`changeCoverAction`, admin only). Pick from:

1. accepted tester cover shots (beta programme),
2. previous covers (earlier hero rows — replacing a cover deletes nothing),
3. gallery screenshots (the chosen one leaves the gallery),
4. *Restore the original cover* (native games; clears the override).

Shared code: `app/lib/game-cover.ts` (also used by Publish). Order: promote →
hero → pointer **last** → invalidate caches. Free upload is intentionally not
offered; use a beta cover shot or `npm run publish-game -- <slug> --staged --cover`.

## What updates when

| Surface | Updates |
| --- | --- |
| arcade cards, featured banner, `/game/<slug>`, dashboard grids, page OG fallback, service worker (new media URL = new cache entry) | immediately (tag + path invalidation) |
| link-preview / share cards (`app/lib/og/brand.tsx` `coverDataUri`) | at the **next deploy** |

Share cards read `public/games/<slug>/cover.png` from disk. At deploy time
`scripts/sync-games.mjs` (CI, before the build) downloads each non-staged native
game's chosen **PNG** cover over that file (`scripts/lib/cover-mirror.mjs`).
Staged games are never mirrored, JPEG/WebP covers are skipped (the app still
shows them; only share cards keep the repo art), and any failed read leaves the
repo's cover in place. To refresh share cards after a change, run the *Deploy to
Vercel* workflow (`workflow_dispatch`).

The CI checkout is discarded after the build, so the repo's `cover.png` stays the
original. Running `npm run sync-games` locally will overwrite tracked
`cover.png` files — do not commit them.
