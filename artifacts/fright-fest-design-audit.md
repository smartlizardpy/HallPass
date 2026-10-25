# Fright Fest 2026: homepage design audit and research

Written 25 Oct 2026 for the Fright Fest homepage exploration. Design only: no production
file was changed. Screenshots come from the live site (hallpass.games) at 1366×768
(the school laptop the site is tuned for), 1920×1080 and an iPhone 13, in light and dark.

## 1. The homepage today

**Desktop (top to bottom).** `app/page.tsx` → `Arcade` → `ArcadeShell`.

| Region | What it is | Source |
|---|---|---|
| Left rail | 64px icon strip of genres (All, New, Trending, Arcade, Horror…), pins open to 192px; stealth and theme buttons at the foot | `Sidebar.tsx` |
| Header | Sticky, white at 85% with blur, 80px. Wordmark, `Games / Friends / You` tabs, a big pill search, Surprise die, streak flame, What's New, Sign in | `SiteHeader.tsx`, `primary-nav.tsx` |
| Featured banner | Purple `rounded-3xl` panel, yellow "★ Featured" chip, white title, white "View game" pill, plays count, cover on the right. Height is clamped in `svh` so the first card row stays above the fold at 768px tall. **Today it features Last Bell.** | `Arcade.tsx:711` |
| New games | 7-column grid at 1366 (10 games today) | `CATALOG_GRID` |
| Sponsor strip | One Frenchly strip | `FrenchlyAd` |
| Popular this week | 6 games. **Shadow Core and Survive Till Dawn are both in it, and so is Last Bell.** | |
| All games | 41 games with sort (Featured / Most played / New first / A–Z) and grid/list toggle | `CatalogToolbar` |
| Footer | Rounded card: wordmark, credits, legal links | `SiteFooter` |

**Phone.** A different layout, not a squeezed desktop: search + streak flame, one
"Games" heading, a 2-column grid of phone-playable games only, and a 3-tab bar
(Home / Friends / You). No hero and no editorial rows, by design ("all we need is the
games list"). 26 games show. Shadow Core is 17th, Survive Till Dawn 20th, and **Last
Bell is absent** (tagged desktop-only). Today the event is invisible on a phone.

**Dark mode.** The same layout on `#0f0f16`. The banner becomes a deep violet panel
with a hairline ring instead of a lit purple slab.

**Whiteboards.** No code mentions them. A board driven by a classroom PC reports a
mouse, so it gets the desktop layout at 1920×1080. A touch-only Android board matches
the phone test (`(pointer: coarse) and (hover: none)`), so it gets the **phone layout
stretched to board width**. That is an existing issue, outside this event's scope, but
it matters for any classroom-facing design.

## 2. What makes HallPass recognisable

1. The lowercase **hallpass** wordmark in brand purple with its raised **yellow dot**.
2. **Nunito** at 800–900 with tight tracking. Chunky, friendly and rounded, never edgy.
3. A **light, Poki-like page** (`#f4f4f7`, white surfaces) whose colour comes from the
   game covers, which are mostly dark and neon.
4. **24px-radius square covers** on a near-black base, a 10px uppercase chip set (pink
   NEW, yellow ★ HOT), and a dark heart disc in the top-right corner.
5. **One loud purple slab** (the featured banner). Everything else is quiet.
6. **Pills everywhere**: search, tabs, CTAs and chips are all fully rounded and 44px tall.
7. Restraint in motion: a 4px hover lift and a pulsing pip. Reduced motion is honoured
   site-wide.

## 3. Constraints every concept must respect

- **1366×768 first row.** The banner was cut from 383px to about 230px so a card row
  shows above the fold (`Arcade.tsx:667`). A taller event hero has to say what it
  costs here.
- **Prerendered and precached.** `/` is static HTML in the service-worker precache. Any
  "is the event on?" logic that runs during render bakes one moment into the HTML and
  risks hydration mismatches. The switch has to be decided at build or revalidate
  time, with a client-side backstop. See the architecture section of the artifact.
- **The phone layout is deliberately sparse.** Adding a hero there breaks a documented
  decision. Doing it for 4 days is defensible, but it is a choice, not a default.
- **Accessibility conventions.** 10px chip text is held to 4.5:1. Every control is
  44px tall. Every `@keyframes` must be named in the reduced-motion block
  (`globals.css:467`).
- **Stealth mode.** Event visuals must not set the tab title or favicon, play sound,
  sit above the panic screen (keep at or below `z-[60]`), or swallow keydown. A loud
  Halloween page behind a "Google Docs" tab is itself a tell, so quieter concepts suit
  this audience better.
- **Platforms.** Last Bell is desktop-only. Any phone treatment has to handle one of
  the three games being unplayable there.

## 4. Opportunities

- The homepage has **exactly one hero slot**, and it already features a Halloween game.
  The event can grow out of an existing pattern rather than bolt a new one on.
- All three competition games are **already live**. Nothing about the catalogue needs
  to change to promote them.
- There is **no personal-progress surface** on the homepage. "Jump back in" is the only
  personal row, and leaderboards live on store pages. A competition is personal, so
  this is the gap Concept D aims at.
- The header already carries a **streak flame chip**, a ready-made pattern for a small
  live counter.
- `app_settings` (Neon, cached, admin-writable) already exists for exactly this kind of
  switch.

## 5. Research summary

Three Sonnet agents ran in parallel. Two of them had thin source access, and it is
stated here rather than smoothed over.

**A. Seasonal event UX.** Could fetch Poki, CrazyGames, itch.io and press coverage.
Could not fetch official Roblox, Fortnite or Steam pages (blocked or 403).
- *Confirmed:* Poki and CrazyGames run Halloween as a **curated collection page that
  reuses all site chrome**. CrazyGames swaps its logo for a Halloween variant and keeps
  the nav intact. Neither runs a competition or a countdown.
- *Confirmed:* Roblox's The Haunt (2024) used a **hub plus daily-gated free rewards**
  and a daily contest. That is the closest analogue to Fright Points.
- *Confirmed:* itch.io jams end with a **"This jam is now over" banner** and keep the page
  as a permanent archive with results.
- *Interpretation:* seasonal layers are additive (hero or strip, nav entry, tile chips)
  and the core grid is never touched. Honest urgency comes from stated dates, not
  timers.
- *Young audience:* prize fulfilment means collecting an address, which raises COPPA
  and UK Children's Code duties for under-13s. Moderate leaderboard handles. No sound
  and no jump scares on a page that may be on a classroom screen.

**B. Visual direction.** Text sources only (no image access), so palettes and type
picks are the agent's judgement. I re-checked every contrast figure above.
- *Confirmed:* Google's Magic Cat Academy put a cute Halloween game in a school setting.
  Splatfest players complained about low-contrast neon team colours.
- *Recommendation:* keep Nunito for UI and add at most one display face. Use flat fills
  and hard edges instead of glows. Tie the visuals to school, hall-pass and arcade
  objects rather than clip-art bats and pumpkins. Purple is already a Halloween colour,
  so the costume is orange and bone added to the existing purple, not a new purple
  gradient.

**C. Technical constraints** (repo audit, file:line citations in the agent report)
fed sections 3 and 4 and the architecture recommendation.

## 6. Checked colour pairs (WCAG)

| Pair | Ratio | Use |
|---|---|---|
| `#ff7a1a` pumpkin on white | 2.61 | Fill only, never text |
| `#1c1c28` ink on `#ff7a1a` | 6.46 | Text on a pumpkin chip |
| `#a83c08` pumpkin-ink on `#f4f4f7` | 5.77 | Orange text in light mode |
| `#ff8a3d` on `#17171f` | 7.60 | Orange text in dark mode |
| `#f2e8d5` bone on `#1b1026` night | 15.0 | Hero text |
| `#b9a7cf` lavender on `#1b1026` | 8.26 | Secondary hero text |
| `#ff7a1a` on `#1b1026` | 7.01 | Event chip text on the night chip |
| `#b3301a` stamp ink on bone | 5.15 | Concept D stamps |
| `#5c5040` on bone | 6.46 | Concept D secondary text |
