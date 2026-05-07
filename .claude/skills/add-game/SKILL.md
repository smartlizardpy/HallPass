---
name: add-game
description: Add a new game to the unblockedgames project from an HTML file. Use when the user has @-mentioned a game's HTML in chat and asks to add it, ship it, or onboard it. Triggers on phrases like "add this game", "add new game", "ship this game", or running /add-game with HTML in context.
---

# Add a new game to unblockedgames

The user has attached a single-file game HTML to the conversation (usually via `@new-game.html`). Your job is to fully onboard it: place files, generate a cover screenshot, and register metadata. Work autonomously — do not ask the user to confirm each step.

## Project assumptions

- Repo root: `/home/ozi/Projects/unblockedgames`
- Games live at `public/games/<slug>/index.html` and `public/games/<slug>/cover.png`
- Metadata is appended to the `games` array in `app/lib/games.ts`
- The `[slug]/route.ts` reads from Vercel Blob first and falls back to the static file in `public/` if the blob is missing. Upload the HTML to blob as part of this flow (see Step 5) — this is the default, not optional.

## Steps

### 1. Derive the slug
- Read the `<title>` from the HTML in context.
- Slug = lowercase, kebab-case, alphanumeric + hyphens only. Strip filler ("the", "a") only if title is long.
- Verify the slug is not already in `app/lib/games.ts`. If it is, append `-2`, `-3`, etc.

### 2. Clean and write the HTML file

Before writing, fix common copy-paste unicode corruption that breaks JS parsing or rendering. Replace:

- Smart quotes → ASCII: `“ ” „ ‟` → `"`, `‘ ’ ‚ ‛` → `'`
- Dashes → ASCII: `– — −` → `-`
- Ellipsis: `…` → `...`
- Non-breaking space (U+00A0) → regular space
- Zero-width chars (U+200B, U+200C, U+200D, U+FEFF) → remove
- Stray BOM at file start → remove

Be conservative: only replace these specific characters. Do **not** strip emojis, Unicode game text, or characters inside `<style>` content fonts. The replacements above are safe inside `<script>` blocks (where smart quotes silently break code) and inside HTML attributes.

A simple `sed`/Python pass works:
```bash
python3 -c "
import sys, re
s = open(sys.argv[1]).read()
repl = {'“':'\"','”':'\"','„':'\"','‟':'\"',
        '‘':\"'\",'’':\"'\",'‚':\"'\",'‛':\"'\",
        '–':'-','—':'-','−':'-','…':'...',
        ' ':' ','​':'','‌':'','‍':'','﻿':''}
for k,v in repl.items(): s = s.replace(k,v)
open(sys.argv[1],'w').write(s)
" public/games/<slug>/index.html
```

Then create `public/games/<slug>/index.html` with the cleaned content. If you made any replacements, mention the count in the final summary so the user knows.

### 3. Generate the cover (Playwright MCP)
Cover spec: **659×613 PNG**.

Playwright MCP **blocks `file://` URLs**, so serve the file over HTTP first:

```bash
cd /home/ozi/Projects/unblockedgames/public && python3 -m http.server 9876 >/dev/null 2>&1 &
echo $! > /tmp/addgame-httpsrv.pid
sleep 1
```

Port `8765` is taken by motionEye on this machine — use `9876` (or anything else free). Verify with `curl -sI http://localhost:9876/games/<slug>/index.html | head -1`.

- `mcp__playwright__browser_resize` to **1318×1226** (2× cover, same aspect).
- `mcp__playwright__browser_navigate` → `http://localhost:9876/games/<slug>/index.html`.
- `mcp__playwright__browser_wait_for` with `time: 2`.
- Goal is to capture the **start/title screen** — that's what looks good as a card. Don't try to click into gameplay; if the snapshot is empty (canvas-only game), that's fine, screenshot anyway.
- `mcp__playwright__browser_take_screenshot` — Playwright MCP only writes inside the project, so use `filename: ".playwright-mcp/<slug>-cover.png"` (NOT `/tmp/...`, which is rejected as outside allowed roots). `fullPage: false`.
- Resize to exact dimensions: `magick .playwright-mcp/<slug>-cover.png -resize 659x613! public/games/<slug>/cover.png`. The `!` forces exact size.
- `mcp__playwright__browser_close`.
- Kill the temp server: `kill $(cat /tmp/addgame-httpsrv.pid) 2>/dev/null`.

If Playwright MCP isn't available, fall back to a solid-color placeholder using the chosen accent color: `magick -size 659x613 xc:'<accent-hex>' public/games/<slug>/cover.png`, and warn the user in the final summary.

### 4. Append metadata to `app/lib/games.ts`

The `Game` type requires:
```ts
{
  slug, title, tagline, description, category,
  tags: string[], gradient: [string, string], accent, art,
  isNew?, isFeatured?, plays?
}
```

Fill every field by inferring from the HTML and screenshot:

- **title**: from `<title>`, cleaned up (proper case, drop "Game" suffix if redundant).
- **tagline**: short, punchy, ≤8 words. Vibes-driven. Not a sentence.
- **description**: 1–2 sentences, present tense, second person or imperative ("Outlast the red tide…"). Mention core mechanic.
- **category**: pick the best fit by looking at existing categories already in `games.ts` (Arcade, Shooter, Survivor, Puzzle, Platformer, etc.). Reuse an existing one whenever reasonable; only invent a new one if nothing fits.
- **tags**: 2–4 tags. First tag should usually equal `category`. Mix in a vibe tag ("Neon", "Pixel", "Cyber", "Retro") if it fits.
- **gradient**: two hex colors that match the game's visual style — sample from the screenshot or pick from CSS in the HTML. Dark + accent is the common pattern.
- **accent**: one bright hex color, usually the lighter of the two gradient colors or the game's primary highlight color.
- **art**: pick ONE from the existing union in `app/lib/games.ts` (currently: `speed | swarm | wave | void | rune | orbit | eye | serpent | glitch | splatter | terrain | tether | rink | slash`). If none fit well, add a new variant to the `ArtStyle` union AND use it. Match the gameplay vibe, not the literal art.
- **isNew**: `true` (always, for newly added games).
- **plays**: omit.
- **isFeatured**: omit unless the user said to feature it.

Insert the new entry as the **last** element of the `games` array (just before the closing `];`). Match the formatting style of nearby entries exactly (2-space indent, trailing commas, multi-line description if it would exceed line length).

### 5. Upload the HTML to Vercel Blob

The runtime route at `app/game-html/[slug]/route.ts` reads from blob first. Upload the same HTML there so the game loads identically in production (and so the admin page can later overwrite it).

The token lives in `.env.local` as `BLOB_READ_WRITE_TOKEN`. Run from the project root:

```bash
set -a && . .env.local && set +a && node -e "
const { put } = require('@vercel/blob');
const fs = require('fs');
const slug = '<slug>';
const html = fs.readFileSync('public/games/'+slug+'/index.html','utf8');
put('games/'+slug+'/index.html', html, {
  access: 'public',
  contentType: 'text/html; charset=utf-8',
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 60,
}).then(r => console.log('OK', r.url)).catch(e => { console.error(e); process.exit(1); });
"
```

Mirror the exact options used by `app/admin/html/page.tsx` (`addRandomSuffix: false`, `allowOverwrite: true`) so a later admin upload cleanly overwrites this one. If `BLOB_READ_WRITE_TOKEN` is missing, skip this step and tell the user.

### 6. Remove the source file

The HTML now lives at `public/games/<slug>/index.html` (and in blob). Delete the original drop file so the repo root stays clean:

```bash
rm /home/ozi/Projects/unblockedgames/new-game.html
```

If the user attached it under a different name, use that path instead.

### 7. Verify

- Run `npx tsc --noEmit` (or whatever the project uses) only if you suspect a type issue. Otherwise skip — TypeScript will catch it on the next build.
- Confirm the artifacts:
  - `public/games/<slug>/index.html`
  - `public/games/<slug>/cover.png` (659×613)
  - new entry in `app/lib/games.ts`
  - blob upload returned a `https://*.public.blob.vercel-storage.com/games/<slug>/index.html` URL

### 8. Report

Single short summary to the user:
- slug used
- category and art style chosen
- gradient/accent picked
- whether the cover is a real screenshot or a placeholder
- whether the blob upload succeeded (and the URL)
- the dev URL: `http://localhost:3000/game/<slug>`

Do NOT commit. The user reviews and commits themselves.

## Notes

- Don't run the dev server. The user already has it running or will start it.
- Don't open a PR or push.
- Don't touch `app/admin/` or `app/api/` — those are separate. The blob upload in Step 5 is the *only* blob action that belongs in this flow.
- If the @-mentioned HTML isn't actually a complete standalone game (no `<canvas>`, no `<script>`, just a snippet), stop and ask the user.
