# Handoff — video on external games (remaining local steps)

**Branch:** `claude/youtube-upload-external-games-6lldi6`

This branch adds the ability to attach a YouTube gameplay/intro video to
**external** games and fixes the "Could not save the video" error. The code is
done; the only remaining work needs local access to the database and is
described below.

## What's in this branch

1. **Add a Video form to the external-game control page**
   (`app/dashboard/(app)/games/[slug]/page.tsx`). The per-game control page
   early-returns a focused editor for external games and returned *before* the
   Video section existed, so an external game had no way to attach a video. The
   backend already supported it: `setGameVideoAction` gates on `isResolvedSlug`
   (which includes external games), the `game_videos.slug` CHECK accepts their
   slugs, and the store page renders `GameTrailer` for any resolved game. This
   was purely a missing UI in the external branch.
2. **Prefill that form** from `getGameVideo(slug)`, so an already-attached video
   is shown and editable in one place — matching the native branch.
3. **Log the real error** when saving/clearing a video fails
   (`video-actions.ts`). The catch previously swallowed the cause behind the
   generic "Could not save the video. Try again." It now `console.error`s the
   underlying error (matching the moderation/favorites convention).

## The bug that needs a local fix — apply migration 013

"Save video" fails on **normal games too**, because the `game_videos` table
doesn't exist in the database the app runs against: **migration
`013_game_videos.sql` was never applied.** The write is not fail-soft, so it
surfaces as the generic error. With change (3) above, the server log now shows
the real cause:

```
[video] setGameVideo(<slug>) failed … relation "game_videos" does not exist
```

### Neon branching caveat

We use **Neon database branching**, so there are multiple `DATABASE_URL`s (e.g.
a production branch plus dev/preview branches). Migration 013 must be applied to
**every branch the app runs against**, not only local dev. The prod app failing
means the **prod** branch is the one that must get it.

```bash
# Confirm what's pending + WHICH db you're pointed at (prints target host; changes nothing)
npm run migrate -- --status        # expect: · 013_game_videos.sql  PENDING

# Apply to the current DATABASE_URL (.env.local)
npm run migrate

# For each OTHER Neon branch (prod, preview), point DATABASE_URL at it and repeat:
DATABASE_URL='<other-branch-connection-string>' npm run migrate -- --status
DATABASE_URL='<other-branch-connection-string>' npm run migrate
```

- The runner prints `[migrate] target: <host>` — **verify it matches the
  intended Neon branch each time.**
- `013` is already on `main`, so any up-to-date checkout can run it.
- Do **not** use `--baseline-through=013` — that records it as applied *without
  creating the table*. Use plain `npm run migrate`.

## Verify

- `npm run migrate -- --status` shows `✓ 013_game_videos.sql` on each branch.
- In the dashboard, "Save video" succeeds on a normal game **and** an external
  game; the video shows on `/game/<slug>`.
- Run `npm run build` and `npm run lint` locally — the remote container that
  produced these commits had no `node_modules`, so the UI change has not been
  build-checked yet.

## Notes

- Commit author must be `Smartlizardpy <Smartlizardpy@duck.com>` with **no**
  attribution trailers (AGENTS.md).
- This file is coordination-only; delete it before merge if you'd rather it not
  land on `main`.
