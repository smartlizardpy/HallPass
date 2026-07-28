---
name: add-game
description: Add a new game to the unblockedgames project from a single HTML file or a multi-file game folder. Use when the user has @-mentioned a game's HTML in chat or dropped a game folder in the repo and asks to add it, ship it, or onboard it. Triggers on phrases like "add this game", "add new game", "ship this game", or running /add-game with HTML or a game folder in context.
---

# Add a new game to unblockedgames

The user has provided a game — either a single self-contained HTML file (usually via `@new-game.html`) or a folder containing `index.html` plus its own JS/CSS/asset files. Your job is to fully onboard it: place files, generate a cover screenshot, and register metadata. Work autonomously — do not ask the user to confirm each step.

## Project assumptions

- Repo root: `/home/ozi/Projects/unblockedgames`
- Games live under `public/games/<slug>/` — always `index.html` and `cover.png`, plus (for multi-file games) the game's own JS/CSS/asset files with subdirectories preserved
- Metadata is appended to the `games` array in `app/lib/games.ts`
- The route at `app/game-html/[slug]/[[...path]]/route.ts` serves every game file blob-first (from `games/<slug>/<relPath>` in Vercel Blob) and falls back with a 307 to the static copy at `/games/<slug>/<relPath>` if the blob is missing. Upload to blob as part of this flow (see Step 5 / Folder Step 7) — this is the default, not optional.
- The player iframe loads games at `/game-html/<slug>/` (trailing slash — load-bearing: the game's relative asset URLs resolve against it)

## Step 0: Detect the intake type

Before anything else, look at what the user actually provided:

- **A single `.html` file** (attached in chat or dropped in the repo) → run the **Single-file flow** (Steps 1–8 below), exactly as written.
- **A directory**, or **multiple game files** (an HTML file plus separate `.js`/`.css`/asset files that belong together) → run the **Folder flow** (see the "Folder flow (multi-file games)" section after Step 8).

If it's ambiguous (e.g. one HTML file plus files that look unrelated to it), ask the user which files belong to the game before proceeding.

## Single-file flow

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

### 3b. Ask who made the game

**This is the ONE question to ask the user.** Everything else in this skill is
inferred; attribution cannot be, and guessing publishes a false claim about a
named person.

One name — the person who MADE the game. It renders on the store page as
"By <name>".

Get the admin list to offer as suggestions:

```bash
cd /home/ozi/Projects/unblockedgames
node --input-type=module -e '
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
const url = readFileSync(".env.local","utf8").match(/^DATABASE_URL=(.*)$/m)[1].replace(/^["\x27]|["\x27]$/g,"");
const sql = neon(url);
const rows = await sql`SELECT name, email, role FROM dashboard_users ORDER BY name`;
for (const r of rows) console.log(`${r.name ?? "(no name)"}  <${r.email}>  ${r.role}`);
'
```

Then ask with `AskUserQuestion`, offering each admin name as an option. The user
must also be able to type someone who is not an admin — plenty of games come from
people with no account here.

**Do not skip this and do not guess.** A wrong credit is worse than no credit, and
this is the only moment the information is available.

### 4. Append metadata to `app/lib/games.ts`

The `Game` type requires:
```ts
{
  slug, title, tagline, description, category,
  tags: string[], gradient: [string, string], accent, art,
  isNew?, isFeatured?, plays?,
  author?
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
- **author**: the name from Step 3b, exactly as the user gave it. Never invent it.
  Omit only if the user genuinely does not know — the game page then renders no
  byline rather than a guess.

  It lives in `games.ts` rather than in the `game_credits` table on purpose: this
  skill runs on a local machine with no production database access, so a credit
  written only to a database would never reach the live site. The table exists for
  dashboard-uploaded and external games, and overrides this when set.

Insert the new entry as the **last** element of the `games` array (just before the closing `];`). Match the formatting style of nearby entries exactly (2-space indent, trailing commas, multi-line description if it would exceed line length).

### 5. Upload the HTML to Vercel Blob

The runtime route at `app/game-html/[slug]/[[...path]]/route.ts` reads from blob first. Upload the same HTML there so the game loads identically in production (and so the admin page can later overwrite it).

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
- If the dev server is already running, `curl -sI http://localhost:3000/game-html/<slug>/ | head -1` should return 200. Note the trailing slash — `/game-html/<slug>/` is the exact URL the player iframe loads. Don't start a dev server just for this; skip and move on if it isn't up.

### 8. Report

Single short summary to the user:
- slug used
- category and art style chosen
- gradient/accent picked
- whether the cover is a real screenshot or a placeholder
- whether the blob upload succeeded (and the URL)
- the dev URL: `http://localhost:3000/game/<slug>`

Do NOT commit. The user reviews and commits themselves.

## Folder flow (multi-file games)

Run this flow when the intake is a directory (or a set of files that form one game). It mirrors the single-file flow — same slug rules, same cover, same `games.ts` entry — but validates the file tree first and uploads *every* file to blob, not just `index.html`.

### Folder Step 1: Validate the folder — before touching the repo

Do all of this against the drop folder, before copying anything into `public/`:

1. **`index.html` must exist at the folder root** — not nested. If the drop folder wraps everything in a single inner directory (e.g. `my-game/dist/index.html`), treat that inner directory as the game root for every step below.
2. **Every relative asset reference must resolve to a real file inside the folder.** Scan `index.html` and all `.js`/`.css` files for references:
   - `src="..."` / `href="..."` attributes
   - CSS `url(...)`
   - `new Image(...)` / `new Audio(...)` / `Audio(...)` source assignments
   - `fetch('...')` of local paths

   Strip any query string or hash (`sprite.png?v=2` → `sprite.png`); ignore `data:`, `blob:`, `#`, `mailto:`, and external `http(s)://` URLs. Resolve what remains: refs in `.html` files against that file's directory, CSS `url(...)` against the CSS file's directory, and JS string paths against the folder root (the browser resolves them against `index.html`, which sits at the root). Every one must point at an existing file — a missing `assets/boom.mp3` gets caught here, not in production. Dynamically built paths (string concatenation, template literals with variables) can't be statically verified; spot-check what you can and flag the rest in the final report instead of failing.
3. **Reject absolute local refs** like `/foo.js` or `/images/x.png` — they escape the game directory and 404 in the player. Sole exception: `/sdk/...` (the scoreboard SDK is intentionally site-absolute). Rewrite absolute refs to relative ones (and re-verify they resolve), or stop and ask the user. External `https://` CDN refs follow the same rules as the single-file flow — leave them alone.
4. **Every path segment must be blob-route safe.** Each directory and file name must match `/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/` and be ≤128 chars (mirrors `isSafeSegment` in `app/lib/game-html-blob.ts` — that file is the source of truth, re-check it if in doubt). No file may sit more than 10 path segments deep relative to the game root (the serving route rejects deeper paths). This bars `..`, dotfiles, and names starting with `.` or space. For offending files: rename them AND patch every reference — prefer renaming spaces out of filenames (`my sprite.png` → `my-sprite.png`) — or stop and ask the user.
5. **Sanity caps**: ≤300 files total. If the folder exceeds ~25 MB total, warn the user in the final summary (the dashboard upload path caps at 25 MB).

### Folder Step 2: Derive the slug

Exactly as single-file Step 1: read the `<title>` from `index.html`, kebab-case it, and dedupe against `app/lib/games.ts`.

### Folder Step 3: Clean HTML files only

Apply the unicode-corruption Python pass from single-file Step 2 to every `.html` file in the folder — and to `.html` files ONLY. All other files (`.js`, `.css`, images, audio, fonts, …) must reach `public/` byte-identical: no re-encoding, no newline normalization, nothing. Running the pass in the drop folder is fine — it gets deleted in Folder Step 8 anyway.

### Folder Step 4: Copy the whole tree

Copy the entire game tree — subdirectories preserved — to `public/games/<slug>/`:

```bash
mkdir -p public/games/<slug>
cp -r <game-root>/. public/games/<slug>/
```

### Folder Step 5: Generate the cover

Unchanged from single-file Step 3. The `python3 -m http.server` flow already serves folders with their assets, so the game's relative JS/images/audio load fine at `http://localhost:9876/games/<slug>/index.html`.

### Folder Step 6: Append metadata to `app/lib/games.ts`

Unchanged from single-file Step 4, including **Step 3b** — a folder game needs its
`author` credit exactly as much as a single-file one, and the question must still
be asked rather than guessed.

### Folder Step 7: Upload EVERY file to Vercel Blob

Instead of one `put`, loop over every file under `public/games/<slug>/` (the cleaned copies; skip the generated `cover.png` — it's site metadata, not a game asset) and upload each to `games/<slug>/<relPath>`. Content type is picked by extension — the mapping must mirror `contentTypeForPath` in `app/lib/game-html-blob.ts` (source of truth; the map below is a copy, re-check that file if it may have changed). Token from `.env.local` (`BLOB_READ_WRITE_TOKEN`) exactly as single-file Step 5 documents; if it's missing, skip this step and tell the user.

```bash
set -a && . .env.local && set +a && node -e "
const { put } = require('@vercel/blob');
const fs = require('fs');
const path = require('path');
const slug = '<slug>';
const root = path.join('public/games', slug);
// Mirror of CONTENT_TYPES in app/lib/game-html-blob.ts
const types = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2',
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
(async () => {
  for (const file of walk(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel === 'cover.png') continue;
    const ext = path.extname(file).slice(1).toLowerCase();
    const r = await put('games/' + slug + '/' + rel, fs.readFileSync(file), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: types[ext] || 'application/octet-stream',
    });
    console.log('OK', r.pathname);
  }
})().catch((e) => { console.error(e); process.exit(1); });
"
```

Confirm the loop printed one `OK` line per file, including `games/<slug>/index.html`.

### Folder Step 8: Cleanup, verify, report

- Remove the drop folder: `rm -rf /home/ozi/Projects/unblockedgames/<drop-folder>` (use the actual path the user dropped it at).
- Verify:
  - `public/games/<slug>/index.html` exists locally AND `games/<slug>/index.html` appeared as an `OK` line in Folder Step 7's output (present in blob).
  - Pick at least one sub-asset (a `.js` file or an image) and confirm it returns 200 at BOTH `http://localhost:3000/game-html/<slug>/<file>` (blob-first route the player uses) and `http://localhost:3000/games/<slug>/<file>` (static fallback target) via `curl -sI ... | head -1`. Remember the player iframe itself loads `/game-html/<slug>/` — WITH the trailing slash; that slash is what makes the game's relative asset URLs resolve. If the dev server isn't running, skip these curls and say so in the report — do not start one.
  - `public/games/<slug>/cover.png` is 659×613.
  - The new entry is appended to `app/lib/games.ts`.
- Report as in single-file Step 8, plus: number of files uploaded to blob, any renames made in validation, and any size or unverifiable-reference warnings.

## Notes

- Don't run the dev server. The user already has it running or will start it.
- Don't open a PR or push.
- Don't touch `app/admin/` or `app/api/` — those are separate. The blob upload (Step 5, or Folder Step 7) is the *only* blob action that belongs in this flow.
- Games are no longer required to be single-file — multi-file games (index.html + JS + assets) are fully supported via the Folder flow.
- Single-file intake: if the @-mentioned HTML isn't actually a complete game (no `<canvas>`, no `<script>`, just a snippet), stop and ask the user. But an HTML that references sibling `.js`/asset files is not a reason to bail — it means you should be running the Folder flow instead.
- Folder intake: if there's no `index.html` at the game root, or it's clearly not a playable game, stop and ask the user.
