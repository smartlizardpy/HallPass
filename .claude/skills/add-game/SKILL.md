---
name: add-game
description: Add a new game to the unblockedgames project from a single HTML file or a multi-file game folder. Use when the user has @-mentioned a game's HTML in chat or dropped a game folder in the repo and asks to add it, ship it, or onboard it. Triggers on phrases like "add this game", "add new game", "ship this game", or running /add-game with HTML or a game folder in context.
---

# Add a new game to unblockedgames

The user has provided a game — either a single self-contained HTML file (usually via `@new-game.html`) or a folder containing `index.html` plus its own JS/CSS/asset files. Your job is to fully onboard it: place files, generate a cover screenshot, and register metadata. Work autonomously — do not ask the user to confirm each step. The only two questions are who made the game and whether to stage it (both in Step 3b).

## Project assumptions

- Repo root: the git checkout you are running in (`git rev-parse --show-toplevel`). Every path below is relative to it — never hard-code an absolute path, the skill runs on more than one machine.
- A **live** game lives under `public/games/<slug>/` — always `index.html` and `cover.png`, plus (for multi-file games) the game's own JS/CSS/asset files with subdirectories preserved
- A **staged** game (beta testers only until an admin presses Publish in the dashboard) lives under `.staging/<slug>/` and **never** under `public/` — `public/` is served as static files at guessable URLs, so a staged game there would be public. `.staging/` is gitignored.
- Metadata is appended to the `games` array in `app/lib/games.ts`
- The route at `app/game-html/[slug]/[[...path]]/route.ts` serves every game file blob-first (from `games/<slug>/<relPath>` in Vercel Blob) and falls back with a 307 to the static copy at `/games/<slug>/<relPath>` if the blob is missing. Upload to blob as part of this flow with `npm run publish-game` (see Step 5 / Folder Step 7) — this is the default, not optional. Never write your own `put()` loop: the script applies the same content types, path rules and `game_blobs` bookkeeping as the dashboard, and a hand-rolled upload that skips the `game_blobs` row is invisible to the serving route.
- The player iframe loads games at `/game-html/<slug>/` (trailing slash — load-bearing: the game's relative asset URLs resolve against it)

## Step 0: Detect the intake type

Before anything else, look at what the user actually provided:

- **A single `.html` file** (attached in chat or dropped in the repo) → run the **Single-file flow** (Steps 1–8 below).
- **A directory**, or **multiple game files** (an HTML file plus separate `.js`/`.css`/asset files that belong together) → run the **Folder flow** (see the "Folder flow (multi-file games)" section after Step 8).

If it's ambiguous (e.g. one HTML file plus files that look unrelated to it), ask the user which files belong to the game before proceeding.

Both flows branch on the stage answer from Step 3b. **Live** means the steps as written. **Staged** means the same steps with three substitutions, which the steps call out again where they apply:

1. The game's files go to `.staging/<slug>/`, not `public/games/<slug>/` (Step 2, Folder Step 4).
2. The cover is generated from that folder, served from `.staging/` (Step 3).
3. The upload is `npm run publish-game -- <slug> --staged --from .staging/<slug> --cover .staging/<slug>/cover.png`, which also records the cover as a tester-visible hero image, and the `games.ts` entry gets `staged: true` plus the `coverUrl` the script prints (Step 4, Step 5).

Because the order matters for a staged game (the cover URL comes out of the upload, and the entry needs it), the staged flow does the upload **before** writing the `games.ts` entry. The live flow keeps the order as written.

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
" <game-dir>/<slug>/index.html
```

Then create `public/games/<slug>/index.html` with the cleaned content — or `.staging/<slug>/index.html` if the game is staged. If you made any replacements, mention the count in the final summary so the user knows.

### 3. Generate the cover (Playwright MCP)
Cover spec: **659×613 PNG**.

Playwright MCP **blocks `file://` URLs**, so serve the file over HTTP first:

```bash
cd <public-or-.staging> && python3 -m http.server 9876 >/dev/null 2>&1 &
echo $! > /tmp/addgame-httpsrv.pid
sleep 1
```

Serve `public/` for a live game and `.staging/` for a staged one (the URL path differs accordingly, below). Use port `9876` or anything else free — some machines already run something on `8765`. Verify with `curl -sI http://localhost:9876/games/<slug>/index.html | head -1` (live) or `.../<slug>/index.html` (staged).

- `mcp__playwright__browser_resize` to **1318×1226** (2× cover, same aspect).
- `mcp__playwright__browser_navigate` → `http://localhost:9876/games/<slug>/index.html` (live) or `http://localhost:9876/<slug>/index.html` (staged).
- `mcp__playwright__browser_wait_for` with `time: 2`.
- Goal is to capture the **start/title screen** — that's what looks good as a card. Don't try to click into gameplay; if the snapshot is empty (canvas-only game), that's fine, screenshot anyway.
- `mcp__playwright__browser_take_screenshot` — Playwright MCP only writes inside the project, so use `filename: ".playwright-mcp/<slug>-cover.png"` (NOT `/tmp/...`, which is rejected as outside allowed roots). `fullPage: false`.
- Resize to exact dimensions: `magick .playwright-mcp/<slug>-cover.png -resize 659x613! <game-dir>/<slug>/cover.png` where `<game-dir>` is `public/games` (live) or `.staging` (staged). The `!` forces exact size.
- **Now do the platform check below, while the server and the browser are still up.**
- `mcp__playwright__browser_close`.
- Kill the temp server: `kill $(cat /tmp/addgame-httpsrv.pid) 2>/dev/null`.

#### 3a-ii. Platform check — does it work on a phone?

This decides the `platform` field in step 4. **Actually test it. Do not infer it
from the source.** Grepping for `touchstart` versus `keydown` gives the wrong
answer often enough to be worse than no answer: plenty of games register both
listeners and are still unplayable on a phone — hit targets built for a mouse, a
pause menu bound to `Esc`, a canvas that assumes landscape.

Still with the temp server running:

- `mcp__playwright__browser_resize` to **390×844** (iPhone-ish portrait).
- `mcp__playwright__browser_navigate` to the same URL again (a resize alone will
  not re-run layout code that read the viewport at startup).
- `mcp__playwright__browser_wait_for` with `time: 2`, then
  `mcp__playwright__browser_take_screenshot`.
- Tap the middle of the play area with `mcp__playwright__browser_click`, wait ~1s,
  and screenshot again.

Then judge from the two screenshots plus a read of the controls code:

| What you see | `platform` |
|---|---|
| Responds to the tap; UI fits the portrait viewport | `"both"` (or `"mobile"` if it *only* makes sense on touch — gyro, swipe, portrait-locked) |
| Nothing responds, or the playfield is cut off / needs keys | `"desktop"` |
| Cannot tell, the check did not run, or Playwright is unavailable | **omit the field** |

Omitting is a real, correct outcome — it means "unknown", which renders exactly
like the site did before the field existed. A wrong guess is worse than no guess:
it badges the game and re-sorts it on every visitor's phone.

If Playwright MCP isn't available, fall back to a solid-color placeholder using the chosen accent color: `magick -size 659x613 xc:'<accent-hex>' <game-dir>/<slug>/cover.png`, and warn the user in the final summary.

### 3b. Ask who made the game, and whether to stage it

**These are the ONLY two questions to ask the user** — ask them together in one
`AskUserQuestion` call. Everything else in this skill is inferred; attribution
and release timing cannot be, and guessing either is worse than asking.

**Stage this game for beta testers first?** Options: *No — publish it now*
(default) and *Yes — stage it*. A staged game is visible and playable only to
beta testers and dashboard roles; for everyone else every public surface (home
page, `/game/<slug>`, sitemap, llms, OG images, offline cache) acts as if it does
not exist. Testers' screenshots, cover shot, credits and reviews pile up while it
is staged, and an admin presses **Publish** in the dashboard to take it live with
no code change. If the user's message already says "stage it" / "beta first" (or
"just ship it"), take that as the answer and do not ask again.

The rest of this step is the authorship question.

**Authorship.**

One name — the person who MADE the game. It renders on the store page as
"By <name>".

Get the admin list to offer as suggestions:

```bash
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
  author?, platform?, staged?, coverUrl?
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

- **platform**: `"desktop" | "mobile" | "both"`, from the check in step 3a-ii —
  or **omit it entirely** if that check did not give a clear answer. Omitted means
  UNKNOWN, and unknown is silent: no badge, no re-sorting, no warning, exactly as
  the site behaves for a game with no tag at all.

  Whatever you write here is a PROPOSAL. Say so in the final summary, naming what
  you saw — "tagged `desktop`: tapping the canvas at 390×844 did nothing and the
  controls are `keydown`-only; fix it in the dashboard if that's wrong." The
  dashboard has a "Plays on" control on every game's page, so a correction costs
  one click, but only if the user knows a guess was made.

- **staged**: `true` if (and only if) the user chose to stage the game; otherwise
  omit it. Never write `staged: false`. This is the floor the deploy reads: the
  dashboard's Publish button overrides it in the database, so the flag can stay
  `true` in this file after the game is live. If the `Game` type in `app/lib/games.ts`
  has no `staged` field, the staging support is not on this branch — stop and say so
  rather than adding the field yourself.
- **coverUrl**: staged games only — the `/game-media/<slug>/hero-<hash>.png` path
  that `publish-game` prints (Step 5). A staged game has no `public/games/<slug>/cover.png`
  for the `/games/<slug>/cover.png` convention to find, so it needs this. Omit it
  for live games.

Insert the new entry as the **last** element of the `games` array (just before the closing `];`). Match the formatting style of nearby entries exactly (2-space indent, trailing commas, multi-line description if it would exceed line length).

### 5. Upload the HTML to Vercel Blob

The runtime route at `app/game-html/[slug]/[[...path]]/route.ts` reads from blob first. Publish through the repo's script so the game loads identically in production and a later dashboard upload overwrites it cleanly. It writes the blob with the same options as the dashboard (`addRandomSuffix: false`, `allowOverwrite: true`) **and** records it in `game_blobs`, which the serving route needs in order to see it.

It needs `BLOB_READ_WRITE_TOKEN` and `DATABASE_URL` (both from `.env.local`). Always dry-run first, read what it says it will do, then run it with `--yes`.

**Live game:**

```bash
npm run publish-game -- <slug>          # dry run
npm run publish-game -- <slug> --yes    # writes; also bumps games_version
```

**Staged game** — do this step BEFORE Step 4's `games.ts` entry is written, because it prints the cover URL the entry needs:

```bash
npm run publish-game -- <slug> --staged --from .staging/<slug> --cover .staging/<slug>/cover.png
npm run publish-game -- <slug> --staged --from .staging/<slug> --cover .staging/<slug>/cover.png --yes
```

The script refuses a staged source under `public/` and a `public/games/<slug>/` that already exists, and it skips the `games_version` bump (nothing installed should refresh for a game it cannot see). Copy the `coverUrl: "/game-media/..."` line it prints into the entry, together with `staged: true`.

If `BLOB_READ_WRITE_TOKEN` or `DATABASE_URL` is missing the script stops with an error. Skip the upload and tell the user — and for a staged game, also tell them the `games.ts` entry must NOT be committed without the upload, since a staged game that exists only in the repo is unplayable.

### 6. Remove the source file

The HTML now lives at `public/games/<slug>/index.html` — or `.staging/<slug>/index.html` for a staged game — and in blob. Delete the original drop file so the repo root stays clean:

```bash
rm new-game.html
```

If the user attached it under a different name, use that path instead.

### 7. Verify

- Run `npx tsc --noEmit` (or whatever the project uses) only if you suspect a type issue. Otherwise skip — TypeScript will catch it on the next build.
- Confirm the artifacts:
  - live: `public/games/<slug>/index.html` and `public/games/<slug>/cover.png` (659×613); staged: `.staging/<slug>/index.html` and `cover.png`, and **no** `public/games/<slug>/` directory
  - new entry in `app/lib/games.ts` (staged: with `staged: true` and `coverUrl`)
  - `publish-game --yes` reported `published games/<slug>/index.html` and `recorded in game_blobs`
- If the dev server is already running, `curl -sI http://localhost:3000/game-html/<slug>/ | head -1` should return 200 for a live game, and **404 for a staged one** when signed out (that 404 is the proof the staging gate works; testers see it signed in). Note the trailing slash — `/game-html/<slug>/` is the exact URL the player iframe loads. Don't start a dev server just for this; skip and move on if it isn't up.

### 8. Report

Single short summary to the user:
- slug used
- category and art style chosen
- gradient/accent picked
- whether the cover is a real screenshot or a placeholder
- whether the `publish-game` upload succeeded
- live or staged. If staged: that it is invisible to the public, where testers find it (`/beta`), the `coverUrl` written, and that an admin takes it live with **Publish** in the dashboard — no code change, but the next deploy mirrors the files into `public/games/`
- the `platform` tag, WHAT YOU SAW that justified it, and that it can be changed
  on the game's dashboard page — or that you left it unknown, and why
- the dev URL: `http://localhost:3000/game/<slug>`

Do NOT commit. The user reviews and commits themselves. (`.staging/` is gitignored, so a staged game's files never appear in the diff — only the `games.ts` entry does.)

## Folder flow (multi-file games)

Run this flow when the intake is a directory (or a set of files that form one game). It mirrors the single-file flow — same slug rules, same cover, same `games.ts` entry, same live/staged choice — but validates the file tree first and uploads *every* file to blob, not just `index.html`.

### Folder Step 1: Validate the folder — before touching the repo

Do all of this against the drop folder, before copying anything into `public/` or `.staging/`:

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

Copy the entire game tree — subdirectories preserved — to `public/games/<slug>/` (live) or `.staging/<slug>/` (staged):

```bash
mkdir -p <game-dir>/<slug>
cp -r <game-root>/. <game-dir>/<slug>/
```

### Folder Step 5: Generate the cover

Unchanged from single-file Step 3 — including the **platform check in 3a-ii**,
which reuses the same server and browser session. The `python3 -m http.server` flow already serves folders with their assets, so the game's relative JS/images/audio load fine at `http://localhost:9876/games/<slug>/index.html`.

### Folder Step 6: Append metadata to `app/lib/games.ts`

Unchanged from single-file Step 4, including **Step 3b** — a folder game needs its
`author` credit exactly as much as a single-file one, and both questions (author,
stage) must still be asked rather than guessed. For a staged game, do Folder Step 7
first: the `coverUrl` comes out of it.

### Folder Step 7: Upload EVERY file to Vercel Blob

Use the same script as single-file Step 5. It walks the folder, uploads each file to `games/<slug>/<relPath>` with the content type the serving route expects, records each in `game_blobs`, and skips `cover.png` (site metadata, not a game asset). It re-checks the rules from Folder Step 1 (safe segments, ≤10 deep, ≤300 files, `index.html` at the root) and stops before uploading anything if one fails.

```bash
# live
npm run publish-game -- <slug>
npm run publish-game -- <slug> --yes

# staged
npm run publish-game -- <slug> --staged --from .staging/<slug> --cover .staging/<slug>/cover.png
npm run publish-game -- <slug> --staged --from .staging/<slug> --cover .staging/<slug>/cover.png --yes
```

A multi-file game is accepted only as a **first** upload. The slug was just deduped against `games.ts` in Folder Step 2, so that is what this always is; if the script refuses with "already has published file(s)", the slug is in use — stop and pick another rather than working around it, because a bundle republish has to delete the files it orphans and only the dashboard does that safely.

Confirm the dry run listed every file and the `--yes` run printed `published games/<slug>/<file>` for each, including `games/<slug>/index.html`.

### Folder Step 8: Cleanup, verify, report

- Remove the drop folder: `rm -rf <drop-folder>` (use the actual path the user dropped it at).
- Verify:
  - The game's folder (`public/games/<slug>/` live, `.staging/<slug>/` staged — and for a staged game, no `public/games/<slug>/` at all) has `index.html`, AND `games/<slug>/index.html` appeared as a `published` line in Folder Step 7's output (present in blob).
  - Live games: pick at least one sub-asset (a `.js` file or an image) and confirm it returns 200 at BOTH `http://localhost:3000/game-html/<slug>/<file>` (blob-first route the player uses) and `http://localhost:3000/games/<slug>/<file>` (static fallback target) via `curl -sI ... | head -1`. Staged games have no static twin and answer 404 to a signed-out request — check only that. Remember the player iframe itself loads `/game-html/<slug>/` — WITH the trailing slash; that slash is what makes the game's relative asset URLs resolve. If the dev server isn't running, skip these curls and say so in the report — do not start one.
  - `cover.png` in the game's folder is 659×613.
  - The new entry is appended to `app/lib/games.ts`.
- Report as in single-file Step 8, plus: number of files published to blob, any renames made in validation, and any size or unverifiable-reference warnings.

## Notes

- Don't run the dev server. The user already has it running or will start it.
- Don't open a PR or push.
- Don't touch `app/admin/` or `app/api/` — those are separate. `npm run publish-game` (Step 5, or Folder Step 7) is the *only* blob action that belongs in this flow; do not call `put()` yourself, and never run `sync-games`.
- Never place a staged game's files anywhere under `public/`.
- Games are no longer required to be single-file — multi-file games (index.html + JS + assets) are fully supported via the Folder flow.
- Single-file intake: if the @-mentioned HTML isn't actually a complete game (no `<canvas>`, no `<script>`, just a snippet), stop and ask the user. But an HTML that references sibling `.js`/asset files is not a reason to bail — it means you should be running the Folder flow instead.
- Folder intake: if there's no `index.html` at the game root, or it's clearly not a playable game, stop and ask the user.
