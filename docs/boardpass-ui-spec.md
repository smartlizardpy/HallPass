# BoardPass UI — design specification ("Arcade Wall")

Direction and rationale: `boardpass-ui-research.md`. Backend contract:
`boardpass-design.md`. This file is the build contract for the `/board` UI. Nothing
here changes an API route, the session schema, cookies or auth rules.

## 1. Principles

1. Looks like a console launcher, not an admin form: dark, art-led, one accent.
2. Every interactive target ≥ 56 px tall on the board (44 px is the absolute floor,
   WCAG 2.5.5); primary actions 64 px; ≥ 12 px between adjacent targets.
3. Only real data is shown. No invented thumbnails, ranks, play counts or
   "trending". Badges are New, Multiplayer and a platform note, each from catalogue
   metadata.
4. No hover-only behaviour; every action works by tap and by keyboard.
5. Motion is transform/opacity only, 150–200 ms, off under `prefers-reduced-motion`.

## 2. Scoped dark theme

The lobby root carries `.bp-root`; tokens are CSS custom properties defined on it in
`app/board/_ui/board.css`, so the rest of HallPass (and the user's theme setting) is
untouched. The lobby is **always dark**.

| Token | Value | Use |
|---|---|---|
| `--bp-bg` | `#0e0a1a` | page |
| `--bp-surface` | `#181229` | cards, bars |
| `--bp-surface-2` | `#231a3b` | raised/hover, keys |
| `--bp-line` | `rgb(255 255 255 / .12)` | borders |
| `--bp-text` | `#f6f3ff` | body (≈16:1 on bg) |
| `--bp-muted` | `#bdb4d8` | secondary (≈9:1 on bg) |
| `--bp-brand` | `#7c2eef` | primary fill (white text) |
| `--bp-brand-soft` | `#b58bff` | brand-coloured text/icons on dark |
| `--bp-yellow` | `#ffc700` | focus ring, "New" |
| `--bp-pink` | `#ff5c93` | "Multiplayer", destructive accents |
| `--bp-danger` | `#ff7a8a` | End Session / errors on dark |

Type: Nunito (existing `--font-nunito`). Scale: page title 32, hero title 40 (clamped
to 32 at ≤1366), section/chip text 18, card title 20/24, card meta 15, button text
18–20, helper text ≥ 15. Nothing below 14 px.

Focus: a 4 px yellow ring with 2 px offset on every focusable element
(`:focus-visible`). Press feedback: `scale(.97)` for 100 ms. Card hover/focus:
`translateY(-2px)` + brighter border.

## 3. Screen anatomy

```
┌ header (88) ──────────────────────────────────────────────────────────────┐
│ hallpass • BOARD MODE │ [👤 Ava] [👤 Ben] …(≤8, scrolls) │ +Add Player │ ⏻ End│
├ featured strip (≈208) ────────────────────────────────────────────────────┤
│ FEATURED  Duskfall  tagline…  [ ▶ Play ]            [ cover art 16:10 ]   │
├ controls (64) ────────────────────────────────────────────────────────────┤
│ [All 31] [Arcade 7] [Shooter 4] …           [ 🔍 Search games   ⌨ ] [Clear]│
├ grid ─────────────────────────────────────────────────────────────────────┤
│ ┌art 16:10┐ ┌art┐ ┌art┐ ┌art┐ ┌art┐   5 / 4 / 3 / 2 columns               │
│ │ title   │ …                                                              │
└───────────────────────────────────────────────────────────────────────────┘
 floating: login windows (≤4) · username keyboard panel · sheets · session card
```

### 3.1 Header (persistent, sticky)

- Left: `Wordmark` + "Board Mode" chip.
- Centre: **player dock** — one button per signed-in player (56 px avatar, 18 px
  name, scrolls horizontally if it overflows). Tapping a player opens that
  player's **menu** (see 3.6). Empty state: "No players yet — tap Add Player".
- Right: **Add Player** (primary, 56 px; disabled at 8 players or 4 open windows,
  with the reason in its accessible description), a small "Ends by 3:42 pm" chip
  from the server's absolute expiry, then **End Session** (outline, danger colour,
  separated by a divider and 24 px of space so it is not hit while adding).

### 3.2 Featured strip

Source: the catalogue game with `isFeatured` (today Duskfall). If none is flagged,
the strip is omitted — it is never filled with a guessed game. Height capped to
`clamp(168px, 19vh, 220px)` so the first grid row is visible at 1080p. Left: eyebrow
"Featured", title, one-line tagline, **Play** (64 px). Right: the real cover
(`CoverImage`), 16:10, with the game's own gradient as the strip background (mixed
dark). Play follows the same path as a card tap.

### 3.3 Controls

Category chips (from `categories`, with counts, 56 px tall, "All" first), then
search and Clear. Chips and search combine (AND). The **search field has a ⌨ button**
that opens the same keyboard panel used for usernames (so students can search
without a hardware keyboard); the field is `inputmode="none"` only while the panel
is open. Empty result: a card with the active query/category, a one-tap "Clear
filters" and the note that nothing matched. Filters live in `BoardMode` state, so
they survive playing a game and returning.

### 3.4 Game card

Art box 16:10 with the cover (`loading="lazy"`, `decoding="async"`, fixed aspect so
nothing shifts). Top-left badges (from data): **New** (`isNew`), **Multiplayer**
(`multiplayer` present), **Desktop/Mobile only** note when `platform` is not
`both`/absent. A bottom scrim keeps text readable. Below the art: title (20),
category · tagline on one line (15, ellipsis). Whole card is one `<button>`; label
is "Play <title>". States: default, hover, focus-visible, pressed, disabled while a
launch is in flight. No cover → `CoverImage`'s gradient + initial (external games)
— never a stock image.

Columns by viewport width: ≥1700 → 5, ≥1180 → 4, ≥820 → 3, else 2. Gap 20 (16 below
1366). Side margin `clamp(24px, 3.4vw, 64px)`.

Arithmetic (verified later against screenshots):

| Display | Inner width | Cols | Card w | Art h | Card h | First row y→ | Second row |
|---|---|---|---|---|---|---|---|
| 1920×1080 | 1792 | 5 | 342 | 214 | ≈286 | 416–702 | 722–1008, fully visible |
| 1366×768 | 1270 | 4 | 305 | 191 | ≈263 | 368–631 | peeks 647–768 |
| 1024×768 | ≈960 | 3 | 308 | 192 | ≈264 | — | — |

### 3.5 Login window + username keyboard

Login window (existing behaviour kept: drag by title bar with pointer capture,
clamped by `clampPosition`, arrow-key nudge, reset, minimize, close, ≤4 windows,
individual state, PIN only in component state and cleared on minimize/close/hide):
widened to 380 px; title bar 56 px; username field 56 px with a **Keyboard** button;
PIN pad keys **72×72**; Join happens automatically on the sixth digit as today.

**Username keyboard** is a *separate* floating panel, not part of the login window.
Docked bottom-centre by default (width `min(900px, 100vw - 32px)`), draggable by its
handle, with Reset (re-dock) and Close; independent z-index above windows. It opens
when a username field is focused or its Keyboard button is tapped and edits **that
window's** username (the last-focused field wins; closing the window closes the
panel). Keys: `1`–`0`, `q`–`p`, `a`–`l` + `_`, `z`–`m`, Backspace, Clear, Done —
every character a username may contain (`[a-z0-9_]`, 3–20, `app/lib/username.ts`),
no shift needed because input is lower-cased server-side; keys ≥ 64 px; length is
capped at 20 and keys disable at the cap. It never receives the PIN. When used for
search the same panel allows letters, digits, space, `_` and `-` up to 40.

### 3.6 Player menu (removal)

Tapping a player in the dock opens a small popover menu anchored below it
(`role="menu"`): **Remove <name> from this board** (confirm inline: the item turns
into "Tap again to remove" for 4 s) and **Cancel**. Escape or outside tap closes;
arrow keys move between items; focus returns to the player button. The "✕" chip is
gone, so a normal tap can't remove someone.

### 3.7 Who's playing

Choosing a game: 0 players → open an Add Player window with "Add a player to get
started"; 1 player → launch directly (current behaviour); ≥2 → sheet "Who's playing
<game>?" with a grid of large avatar buttons (96 px avatar, 22 px name, ≥ 120 px
tall) and the line "Scores and achievements go to the player you pick." (V1 limit:
one credited player). External games show the existing note that scores aren't
saved.

### 3.8 Game, return, session

- In game: existing `PlayerOverlay` with `board`; the chrome shows "Playing as
  <name>" and, when due, Keep Playing. Unchanged contract: bind on launch, unbind on
  close/pagehide, no duplicate play-start.
- Idle warning: a bottom-centre card "Still playing?" with **Keep Playing**
  (primary) and **End Session**; it calls the real `touch`/end endpoints and never
  extends the absolute limit (server-enforced).
- Expiry/End: login windows and keyboard close, selected player cleared, a
  dismissible notice "This board session ended…" appears over an empty lobby. End
  Session is a confirm dialog with distinct Cancel and destructive buttons.

## 4. Accessibility

Landmarks: `header`, `main`; dialogs use `role="dialog"` + `aria-modal` + a label
and trap Esc; login windows keep `role="dialog"` with an accessible title; the
roster is a list; errors use `role="alert"`; count/status use `role="status"`. All
new strings live in `app/lib/boardpass/copy.ts`. Contrast of the tokens above is
≥ 4.5:1 for text (checked numerically in the verification step). Non-drag
alternative to moving a window: arrow keys on the title bar and the Reset control.

## 5. Non-goals and recorded decisions

- No backend, schema, cookie or auth changes. No per-seat credit.
- **Shared promo surfaces:** `FeaturePromo`, `SurveyBanner`, `MobileTabBar` and
  `MobileSplash` already keep route lists of places they must not appear; `/board`
  is added to those lists (they covered the lobby with a "stealth" promo in the
  baseline). `AnalyticsNotice` is a consent notice and is **left alone**.
- Known, unchanged security limits: un-sandboxed same-origin games; external games
  are anonymous; no heartbeat; per-seat credit deferred (see research doc §7).
- No "recently played" shelf: the board holds no per-player history on the client
  and we do not fabricate one.
- Real-hardware touch calibration cannot be tested here; sizes are CSS-pixel
  targets verified in a browser, to be re-checked on a physical board.

## 6. Component inventory

`BoardShell` (root, tokens) · `BoardHeader` · `PlayerDock` + `PlayerMenu` ·
`FeaturedStrip` · `LibraryControls` · `GameCard` · `GameGrid` (+ skeleton) ·
`LoginWindow` (restyled) · `UsernameKeyboard` · `WhoSheet` / `ConfirmSheet`
(`Sheet`) · `SessionPrompt` · pure modules `board-filter.ts`, `keyboard-keys.ts`,
`launch-decision.ts`, existing `drag-math.ts`, hook `useFloatingDrag`.

## 7. Verification record

Driven in real Chrome (Playwright, touch events, no hardware keyboard) against the
local dev server and the Neon `dev` branch, with three throwaway accounts that were
deleted afterwards. No migration was run; 051 was already applied there.

| Flow | Result |
| --- | --- |
| Sign in via the separate on-screen keyboard (`zzuitest_ava`, 12 chars incl. `_`) and PIN pad | Pass |
| Wrong PIN, then correct PIN, second player | Generic failure message; second player joins |
| Featured Play with two players → "Who's playing?" → pick the **second** player | Pass; server binds that player and `system-error` |
| Score POST from the page while bound | Stored under the chosen player's public handle with their `player_id` |
| Score POST to a **different** game's board while bound | Stored anonymously (credit is bound to one slug) |
| Close game → lobby | Binding cleared; a later score is anonymous |
| Search, category chips, combined filter, empty state, search by on-screen keyboard | Pass |
| Player menu: tap opens a menu only; Remove needs a second tap; Escape closes and returns focus | Pass |
| Login window drag, clamp at both extremes, Reset position, arrow-key nudge | Pass |
| End Session: Cancel keeps the session; confirm clears server state and the cookie | Pass |

First row of game art is fully visible without scrolling at 1920×1080, 1366×768,
1024×768 and 820×1180. The keyboard panel is fully on screen with Done reachable at
all four. While it is open it covers the lower half of the sign-in window (the
username field stays visible and the panel echoes what is typed); it can be dragged
or docked.

Not verified: real touch hardware, a Windows touch keyboard honouring
`inputmode="none"` (the design does not rely on it), the 5-minute idle expiry and
45-minute cap end to end (their logic is untouched; only the reaction to expiry is
new and covered by the state-clearing code path, not a timed run), and Google
sign-in (untouched).

Full-suite note: `npm test` has 17 failures in `app/lib/console-capture.test.ts` and
`app/lib/streak/streak-event.test.ts` (`localStorage.clear` is undefined under
Node 26). Neither file is touched by this branch. Lint errors in the full run are in
vendored or generated game bundles and unrelated modules; the board code is clean.
