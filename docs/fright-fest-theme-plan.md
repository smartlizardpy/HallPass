# Fright Fest 2026 theme: plan

Branch `fright-fest-theme` (from `main` 627d3b1). Visual source of truth:
`artifacts/fright-fest-homepage-explorations.html`, round 3, strength **C · The Arcade
Is Possessed** (`data-hp-lv="3"`), on the C2 "After Dark" homepage.
Nothing is deployed from this branch.

## 1. What (scope)

Two independent features:

| | Id | Owns |
|---|---|---|
| Theme | `fright-fest-2026-theme` | palette (Haunted Dark / Light), hero, header, sidebar, cards, footer, decorations, easter eggs, `/fright-fest` upcoming page |
| Championship | `fright-fest-2026-championship` | a config boundary only: `enabled: false`. No scoring, API or leaderboard is built |

In scope (decided with the user):
- C-strength skin across home, catalogue, game page surround, You / Friends / public profile, footer, phone.
- System theme choice counts as Haunted Dark; only an explicit Light gets Haunted Light.
- Event look menu (Haunted Dark / Haunted Light / Normal) and Still mode.
- The permanent homepage "For you" single-list change, as its own commit.
- A `/fright-fest` page with upcoming / live / ended states. No fabricated standings.

Excluded: championship gameplay or backend, real prizes (copy stays "Rewards to be
announced"), avatar frame and collectibles (not built; the artifact's previews are
mockups), embedded games, stealth / panic screens, sign-in, OAuth, dashboard, embeds,
challenge landing, legal and offline (palette only on legal and offline; no decorations).

Assumptions to flag: the competition card renders its "upcoming" state whenever
`championship.enabled` is false, even while the theme is live. Silkscreen is loaded
through `next/font` with `preload: false`, applied only under the skin.

## 2. Architecture

```
app/lib/events/
  types.ts            SeasonalEvent, ThemeWindow
  fright-fest.ts      THE configuration (theme window, enabled, championship flag)
  phase.ts            phaseAt(window, nowMs): pure, UTC ms
  look.ts             eventLook(): pure preference table
  boot.ts             eventBootScript(): before-paint, mirrors lib/theme/boot.ts
  championship.ts     championship flag only; imports nothing from the theme files
app/components/events/fright-fest/
  haunted.css         the ONLY file that gives base token names seasonal values
  sprites (public/events/fright-fest/*.png)
  HauntedHero, Marquee, ChampionshipBoard, Decor, Moments, EventLookMenu, EventController
app/fright-fest/page.tsx
```

Contract on `<html>`: `data-hp-event`, `data-hp-event-phase`, `data-hp-skin`,
`data-theme` (event's choice during the event). No attributes means today's HallPass.

- **Independence.** `championship.ts` and the theme files never import each other. A
  test greps the import graph. Championship UI reads only the championship flag; theme
  CSS and boot read only the theme window.
- **Expiry and disable.** The boot script compares `Date.now()` with `[startAt, endAt)`
  in UTC and writes the attributes. `theme.enabled = false` is a manual override that
  wins over the schedule. No clock path writes attributes after `endAt`.
- **No flash.** The event boot script runs straight after the theme boot script and
  sets the attributes before first paint. The server never reads the clock, so `/`
  stays prerendered and precacheable.
- **Exclusions.** The boot script skips an excluded path prefix list. A small client
  `EventController` re-evaluates on soft navigation. Stealth panic root sets
  `data-season-off`.
- **ThemeController** asks the event module for an override first, otherwise the two
  would fight. The saved `hp:theme` is never written. The event look is stored under
  `hp:event-look:fright-fest-2026`.
- **Token isolation.** Seasonal values for base tokens live only in `haunted.css`, only
  under `html[data-hp-skin]`; globals.css permanent values are untouched. A grep test
  enforces it. Specificity must beat both the `[data-theme]` block and the
  no-attribute `prefers-color-scheme` block.
- **Shared components** get attribute-gated hooks only (`data-event-game` on registry
  slugs, slot wrappers). Markup is identical with the skin off, apart from inert slots.
- **Kill switch.** v1: the `enabled` flag in code (one-line change). The artifact's
  `app_settings` kill switch is a separate open decision; reading it in the layout
  would make every ISR route depend on it (incident #131), so it is not built here.

## 3. How (commits, in order)

1. Plan doc and design artifacts.
2. `lib/events`: types, config, phase, look, championship flag + tests (matrix, UTC boundaries).
3. Boot script, exclusions, `ThemeController` override, layout wiring + tests (script run at fixed clocks).
4. `haunted.css` palettes + token-isolation test; Silkscreen font; sprites copied to `public/events/`.
5. Header (moon dot, marquee tab, bat roost, spider) and footer sky band.
6. Sidebar (entry, ghost, eyes, gradient) and event look menu + settings Appearance card option.
7. Homepage hero (canvas scene, cabinets, torch) and competition card with upcoming state.
8. Permanent homepage "For you" list change (separate, independently revertable).
9. Catalogue: card hover glow, registry frames and chips, section ghosts, railings, stars.
10. Game page surround, You / Friends / profile / search, phone tab bar.
11. Moments runtime (budget, daily caps, reduced motion, off-screen pause), "boo" search hook.
12. `/fright-fest` page.
13. Visual parity fixes, review fixes, docs on how to enable / disable.

Each commit keeps lint and tests green. `npm run build` runs at commits 4, 7, 11, 13
(build with any `POSTHOG_PERSONAL_API_KEY` set, per cache-lifetimes.ts).

## 4. Verification

- Unit: phase boundaries, look table, boot script at fixed clocks, independence grep,
  token isolation grep, reduced-motion coverage for every keyframe.
- The five state matrix (Off/Off, On/Off, Off/On, On/On, Expired/On) as tests over the
  config and boot output.
- Screenshots at 1366×768, 1920×1080, tablet, phone, both haunted themes and normal,
  side by side with the artifact.
- Four Sonnet reviewers (visual parity, accessibility and performance, architecture,
  regression) after the build; material findings fixed.

## 5. Known gaps already visible

- The artifact's mock runtime is scaffolding; moments, daily caps and persistence are
  designed here (the artifact only comments on them).
- Timeline: the artifact estimates 7–9 days for C. The event window starts 28 Oct.
- `next build` and Playwright availability to be confirmed before screenshots.
