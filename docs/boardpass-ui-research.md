# BoardPass UI — research and direction

Scope: a redesign of the `/board` lobby for shared classroom smartboards
(1920×1080 and 1366×768, touch first, no physical keyboard). This document records
what was inspected, what was learned, what we chose and why. The build contract is
in `boardpass-ui-spec.md`. Backend, API and session rules are **not** in scope and
stay as described in `boardpass-design.md`.

## 1. How the research was done (and its limits)

Reference pages were opened in a real Chrome (Playwright, 1920×1080) and looked at,
and the primary specifications were read as text. Honest accounting:

| Reference | How inspected | Notes |
|---|---|---|
| Poki (poki.com) | Screenshot, 1920×1080 | Cookie dialog covered the page, but the tile mosaic behind it was fully visible. |
| Xbox Cloud Gaming (xbox.com/play) | Screenshot | Real hero + carousel dots. |
| itch.io browse (itch.io/games) | Screenshot | Real grid, sort tabs, tag row, filter rail. |
| Steam store (store.steampowered.com) | Screenshot | The **store**, not Big Picture. Used for hero/side-panel composition only. |
| Steam Big Picture | Text only | The help page body is empty; coverage describes the Deck-style UI (recent games first, one universal search, tabs). No layout numbers. |
| PS5 / Switch | Marketing pages only | The PS5 page loaded as a marketing page, not the OS. Switch/PS5 notes (single row of large tiles, per-tile detail, round system-icon dock, overlay "Control Center") come from reviews and support pages, not from seeing the OS. |
| Netflix | **Not inspected** | The page returned "Update required" to automation. Row/focus ideas below come from design write-ups, not from the product. |
| Fluent 2 layout; Windows touch targeting | Read (primary) | Exact figures quoted below. |
| WCAG 2.2 SC 2.5.8 / 2.5.5 | Read (primary) | Exact figures quoted below. |
| Android TV layout/focus guidance | Read (primary) | Overscan, grid, focus scale. |
| Apple tvOS HIG | Page did not render | tvOS numbers are secondhand and treated as unverified. |

No console OS was seen running. The consoles are **interaction references, not
visual templates**; where this document says "adopt", the idea is supported by a
screenshot we looked at or a primary spec, and is marked otherwise if not.

Screenshots captured during research are kept outside the repo (session scratch);
the notes below describe what they showed.

## 2. What the references showed

**Poki** (seen). A dense mosaic of square art tiles in *three sizes*; the few large
tiles act as featured items inside the grid, so hierarchy comes from size, not from
a separate hero banner. Art fills the whole tile; the title is secondary. A row of
category chips sits above. Adopt: art-led tiles, size = emphasis, category chips.
Reject: the 94 px small tiles (far below a comfortable touch target on a board).

**Xbox Cloud Gaming** (seen). A hero carousel ~490 px tall with a 80 px margin —
about 45 % of the viewport — pushes the library below the fold. Adopt: a bold
title over full-bleed art, one obvious primary action. Reject: the height. This is
exactly the "hero dominates the screen" failure mode the brief warns about; ours is
capped well under half of Xbox's.

**itch.io** (seen). Strong, scannable cards (art on top, title, one-line tagline,
genre), tag row + sort tabs above. Adopt: art-above-text card anatomy; a tag row.
Reject: the left filter rail (hover/precision UI, wastes width on a board) and the
dense metadata lines (13 px text is unreadable from a classroom distance).

**Steam store** (seen; not Big Picture). A featured panel with art on the left and
a title + secondary info on the right. Adopt: the art + details split for the
featured item. Reject: commerce badges, reviews, upsell.

**Steam Big Picture / PS5 / Switch** (read about, not seen). Shared ideas: recently
played first; one selected item gets the details; system actions live in a small
dock of large round icons; panels (not page changes) for account/system. Reject:
controller-focus navigation as the only model (touch needs direct tap and scroll),
sleep/power items, friends data.

**Fluent 2** (read). 4 px base unit; spacing ramp 2, 4, 6, 8, 10, 12, 16, 20, 24,
28, 32, 36, 40, 48, 52, 56. Breakpoints: x-large 1024–1365, xx-large 1366–1919,
xxx-large 1920+. Minimum touch target 44×44 (Web).

**Windows touch targeting** (read). Target size "7.5 mm square (40×40 px on a 135
PPI display)". Frequent and destructive targets need more size and padding.
A smartboard has far fewer pixels per inch than 135, so 7.5 mm is much more than
40 CSS px; 44 px is therefore a floor, not a goal.

**WCAG 2.2** (read). 2.5.8 (AA): at least 24×24 CSS px, or spacing such that a 24 px
circle centred on each target does not hit another. 2.5.5 (AAA): at least 44×44.
We meet 2.5.5 for everything interactive and exceed it for primary targets.

**Android TV** (read). 5 % overscan-style safe margins (conflicting 48 vs 58 dp in
the source; we use ~5 %), focus scale 1.025–1.1× plus an outline, "browse" row
template and "center overlay" modal template.

**inputmode / on-screen keyboard** (read). `inputmode="none"` means "no virtual
keyboard — for when the page implements its own keyboard input control" (MDN).
Whether Windows Chrome/Edge honours it for the Windows touch keyboard in
kiosk-style accounts is **unverified**; it must be tried on a real school PC. The
design therefore does not depend on the OS keyboard at all.

## 3. Answers to the ten research questions

1. **Dozens of games on 1080p?** An art-led responsive grid (31 public games
   today) under a compact featured strip, with category chips and search. No
   nested menus. Everything reachable by scrolling one page.
2. **How many without scrolling?** At 1920×1080 the first grid row (5 cards) is
   fully visible and the second row is visible too (≈10 cards). At 1366×768 the
   first row (4 cards) is visible with the second peeking. Layout arithmetic is in
   the spec §4; it is checked against real screenshots in the verification step.
3. **Differentiating game types?** Real cover art first; a labelled category chip
   on every card; and a per-category accent (an icon and tint on the chip), never
   colour alone. Only real attributes become badges: New, Multiplayer (the 3 games
   with a `multiplayer` block), and platform mismatch.
4. **Quick account switching?** A persistent player dock of large avatars in the
   header. Selecting a game with several players opens "Who's playing?" with large
   avatars; with one player it launches directly (existing behaviour, kept).
5. **Several players on one display?** The dock holds up to 8 players (the server
   cap). Credit still goes to the one chosen player (a documented V1 limit); the
   interface says so rather than implying shared credit.
6. **Floating login windows?** Compact, draggable by a large title bar, clamped so
   the bar can never leave the screen, a visible reset control, keyboard nudging,
   independent state per window, at most 4 open. The username keyboard is a
   **separate** panel (see below) so the login window stays small.
7. **Premium without distraction?** Dark scoped surface, large art, one accent
   (HallPass purple), 1.03–1.05× press/focus scale and 150–200 ms transitions on
   transform/opacity only, `prefers-reduced-motion` respected, no looping or
   background motion, no video.
8. **Fully keyboard-free?** Yes: a digit PIN pad (existing) and a new on-screen
   keyboard panel covering every character a username can contain. Username
   charset is `[a-z0-9_]`, 3–20 characters (`app/lib/username.ts`); input is
   case-folded server-side, so the keyboard needs no shift key. The physical
   keyboard keeps working.
9. **Games without art?** Today every public game has a committed `cover.png`;
   the existing `CoverImage` already falls back to a gradient with the title
   initial for external games without art, and `GameArt` can render each game's
   own procedural art style. We reuse those; we do not invent images.
10. **Fast on weak school PCs?** Lazy-loaded covers in fixed-aspect boxes (no
    layout shift); transform/opacity-only animation; no animation library; no
    blur-heavy effects; no polling (the existing page does none); dragging uses
    pointer capture and moves a single element.

## 4. Audit of the current `/board`

Observed in a 1920×1080 screenshot of the current build (signed out):

- **A. Screen use.** Content sits in a `max-w-6xl` column; about 410 px on each
  side (≈43 % of the width in total) is unused at 1920.
- **B. Text-only games.** Every game is a ≈285×80 px bordered rectangle with a
  title and category; 31 real covers exist and are unused.
- **C. Hierarchy.** Title, player chips, search and grid have equal weight; no
  primary action.
- **D. Touch ergonomics.** 14 px text, 32 px avatar chips with a 32 px "✕" glued
  to each (an accidental-removal hazard), 36–40 px header buttons.
- **E. Personality.** None; it reads as an admin form.
- **F. Stray global UI (new finding).** The root layout's promo and onboarding
  surfaces render on `/board` too: a "Hide the arcade in a blink / Set up
  stealth" modal covered the lobby in our capture. A shared school board should
  not show marketing modals. Whether to suppress them on `/board` is a decision for
  the implementation (it touches shared layout components); it is recorded in the
  spec as an explicit item rather than done silently.

Repository audit (what exists and is reused): `BoardMode.tsx` state machine,
queued login, launch flow and sheets; `LoginWindow.tsx` + `drag-math.ts` (drag,
clamp, nudge — already unit-tested); `PinPad.tsx` (also used by the account
settings page, so any change must stay compatible); `PlayerOverlay` with the
`board` prop and "Playing as" chip; `copy.ts` for strings; `Game` metadata
(`title`, `category`, `tagline`, `isFeatured`, `isNew`, `platform`,
`multiplayer`, covers). All 31 public games have `cover.png`. Only Duskfall is
`isFeatured`. Play counts are below the site's own display threshold, so the
board makes **no** popularity or "trending" claims.

## 5. Design directions considered

**A — Console shelf.** Horizontal rows of large tiles with a focus-driven selected
item and a details panel, PS5/Switch style. Great with a controller. On a touch
board it needs horizontal swipes for a 31-game library, hides most of the catalogue
off-screen, and the brief rules out horizontal scrolling as the only access.

**B — Arcade Wall (chosen).** A compact featured strip, a chips-and-search row,
then a responsive art-led grid, under a console-style top bar with a player dock.
Everything is one vertical scroll, direct-tap, and the whole catalogue is
discoverable. Borrows Poki's art-first emphasis, itch.io's card anatomy and
Switch/Steam's dock-and-panel account handling.

**C — Mosaic.** Poki-style mixed tile sizes. Strong energy, but uneven tile sizes
make a 31-game list feel random and the largest tiles would repeat the Xbox
hero-dominance problem.

## 6. Selected direction and why

**Direction B, "Arcade Wall".** It is the only option where (a) the entire
library is reachable with one gesture, (b) the first row of real artwork is visible
beside a hero at 1080p, (c) every target can be large without hiding content, and
(d) it needs no assumptions about gamepad focus. HallPass identity is preserved by
scoping a dark palette to `/board` using the existing brand purple (`#7c2eef`),
yellow and pink accents, the Nunito face and the `Wordmark` component; it does not
alter the global theme. Card anatomy, sizes and states are specified in
`boardpass-ui-spec.md`.

## 7. Security observations carried into the spec

Documented, not changed (the brief says not to modify unrelated auth):

- Games run same-origin and un-sandboxed (`boardpass-design.md`): a hostile game
  could forge a referrer and rebind or end the session; it cannot read a PIN.
- Cross-origin external games never receive the board cookie; their scores are
  anonymous. The existing `externalNote` is shown when launching one.
- Per-seat credit for local multiplayer is deferred: one chosen player and one slug
  receive credit.
- No heartbeat: only Keep Playing or a real score extends a lobby session. The
  redesign adds no polling.
- The PIN is held only in component state (never in an input element); the
  keyboard panel must hold only the **username**, never the PIN.
