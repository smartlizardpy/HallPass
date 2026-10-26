# Fright Fest event hall: design exploration plan

Written 26 Oct 2026. Design only. No production file changes; nothing deployed.
Branch `design/fright-fest-event-hall`, worktree `.claude/worktrees/fright-fest-hall`,
files only under `artifacts/fright-fest-event-hall/`.

## 1. What is being made (plan what)

Three alternative designs for `/fright-fest` as the inside of HallPass's haunted
arcade (the "Main Event Hall"), between the homepage (outside, Design C) and the
Pack Room (the prize counter, Option A). Delivered as one interactive review
artifact, with original pixel art, desktop, phone and whiteboard layouts, and
every event state.

### Facts the designs must respect (checked in code, 26 Oct)

| Fact | Source |
|---|---|
| Live page today: one night-scene card with a big countdown; "Games, scoring and rewards: to be announced". Overflows sideways on a 390 px phone. | `app/fright-fest/page.tsx` (main), live screenshots |
| Championship (unmerged branch): opens 28 Oct 00:00 UTC, closes 2 Nov 00:00 UTC, results by 5 Nov. | `fright-fest-championship:app/lib/championship/fright-fest-2026.ts` |
| Fright Points: 100, 80, 65, 40, 40, 20 ×5, then 5 for any other ranked player. Overall Champion needs a result on every opened board. | same |
| Only Last Bell's Halloween Shift is a real, verified mode. Cursed Dash and Blood Moon do not exist in their games yet; their boards are `pending` and their cabinets stay unnamed "mystery cabinets" until an admin opens them. | `docs/championship-design.md` §1–2, commit c563678 |
| Rewards: Participation Pack (result on every board), Game Champion Pack (1st on a board, one per game), Overall Champion Pack. **No runner-up reward exists.** | config `rewards`, `FrightFestSections.tsx` |
| Pack contents and odds are published in the collectibles catalogue (`ODDS.standard` 60/25/10/4/1, etc.). | `collectibles-prize-counter:app/lib/collectibles/catalogue/{packs,odds}.ts` |
| **Halloween Candy and Candy Hunt are not built anywhere.** Production Pack Room deliberately has no candy UI. | grep across branches; Pack Room session, 26 Oct |
| Last Bell has real achievements (e.g. `first-escape` "Last Out", `quick-escape` "Early Bell", `hard-escape` "Hard Detention"). Shadow Core and Survive Till Dawn report none. | `public/games/last-bell/achievements.js` |
| Last Bell is desktop-only. | `app/lib/games.ts` |
| Public API shapes: `PublicChampionship { available, phase, final, standings }`, `PublicStandings.boards[].entries[]`, `.overall[]`, `MyProgress`. | `fright-fest-championship:app/lib/championship/{index,standings}.ts` |

### Decisions

- The artifact shows **real data only where real data exists**. Standings are
  empty until 28 Oct, so the default "today" view is honestly empty. A separate
  "Sample data" toggle fills boards with obviously fictional, labelled names so
  the layout can be judged. Every sample row is marked SAMPLE.
- **Candy Hunt is shown as a labelled design preview** with an integration
  boundary. Notices are tied to real Last Bell achievements where they exist.
  Candy amounts are not configured anywhere, so they are shown as relative
  difficulty tiers, not numbers.
- **Rewards show the three real tiers.** The brief's "second-place runner-up"
  does not exist in the rules; it is flagged as a question, not drawn.
- **The two unverified games appear as mystery cabinets by default**, matching
  today's config. A "lineup" toggle shows all three named, for judging the
  future state.
- The prize-counter entrance links to `/packs` and never duplicates the Pack Room.
- The page art is event art (it is the event's own page). Halloween-only props
  (cobwebs, bats, ghosts, pumpkins, bunting, flicker loops) follow the haunted
  skin; with the skin off, a calm variant of the same room is shown.

### Deliberately excluded

Production code, the Pack Room, the homepage, the championship backend, candy
backend, reward data, odds, inventories, deploys, merges.

### Assumptions (to confirm)

- 1366×768 Chromebook shows about 640 px of page under the browser bars
  (the Pack Room plan's estimate).
- A future build lands on top of the championship branch (it owns `/fright-fest`).

## 2. How (plan how)

### Concepts

| | A · The Arcade Hall | B · The School Hall | C · The Possessed Arcade |
|---|---|---|---|
| Camera | Front-on, Pack Room's camera | Front-on, school assembly hall | One-point perspective down an aisle, 4 parallax layers |
| Machines | Three classic uprights centre stage, Play on each panel | Three surplus cabinets on the school stage; spotlight follows selection | Three possessed cabinets in an arc; selecting zooms the room 3×→4× |
| High scores | Wall-mounted HI-SCORE board, left | Old electronic gym scoreboard | A giant CRT "shrine" at the end of the aisle |
| Candy Hunt | Cork noticeboard teaser, full board below | School noticeboard with paper notices and merit stamps | Fortune-teller booth that "prints" notices; plain list below |
| Prize counter | Lit doorway with a peek of the counter | Tuck-shop serving hatch | Warm neon doorway, the only warm light in the deep |
| Panel material | CRT/control-deck | Paper hall-pass slip, stamps | CRT overlay with scanlines |
| Phone | Scroll-snap row of machines | Stage with three hall-pass tabs | One possessed machine at a time, ◀ ▶ |

### Art (three Sonnet builders, one per concept, in parallel)

Contract: `art/CONTRACT.md`. Each builder writes only `art/hall_<x>.py` and
`art/out/<x>/`. Toolkit: a read-only copy of the Pack Room's `pxkit.py`.
Desktop scene 434×230 at 3× (1302×690, the 1366 content width), phone hero 195×H
at 2×, whiteboard 4×. Cabinets, lit states, screen loops and 9-slice frames are
separate sprites so states can change without new art. A `manifest.json` gives
every hotspot, so the prototype positions HTML from the art's own numbers.

### Prototype (built by me while the art is drawn)

- `prototype/index.html`: the review shell. Views: Explore (concept, device,
  state, data, theme/championship/API toggles, reduced motion, hotspots),
  Compare (current vs proposed), Audit, Research, Art system, Integration,
  Reviews.
- `prototype/hall.html`: the event page itself, loaded in an iframe at the real
  device width (1366, 390, 1920) so media queries behave as in production.
  Renders from a mock data layer shaped exactly like the championship API.
- `prototype/build.py`: copies art into `prototype/art/` and validates the
  manifests.

### Order and commits

1. This plan.
2. Art contract.
3. Prototype shell and data layer (placeholder art boxes at contract hotspots).
4. Concept A integrated. 5. Concept B. 6. Concept C.
7. Phone and whiteboard passes.
8. Review shell documents (audit, research, art system, integration).
9. Revisions after the four independent reviews.
10. Final screenshots and write-up.

### Checks

Playwright screenshots at 1366×768, 1280×720, 390×844, 360×740 and 1920×1080 for
each concept and state; console errors; horizontal overflow; keyboard pass;
reduced motion; contrast of every text pair on art. No `npm` checks apply: no
app code changes.
