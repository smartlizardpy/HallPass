# Fright Fest event hall (concept A): plan

Turns `/fright-fest` into concept A from the design exploration, "the Arcade
Hall": a pixel-art room with three cabinets, a high-score board, a Candy Hunt
noticeboard and a prize-counter door into the Pack Room. The design, its
reviews and its art are on branch `design/fright-fest-event-hall`
(`artifacts/fright-fest-event-hall/`). The owner picked A on 26 Oct.

Four pieces of work, shipped as four pull requests so each can merge on its own:

| PR | What | Branch |
|---|---|---|
| 1 | The dashboard's Collectibles desk becomes super-admin only | `fix/collectibles-desk-superadmin` |
| 2 | "What's in each pack" on `/packs` restyled to the Pack Room's look | `feature/pack-odds-restyle` |
| 3 | `/fright-fest` as the Arcade Hall | `feature/fright-fest-hall` |
| 4 | Candy Hunt (new feature) | after the owner's decisions, see §4 |

## 1. Plan what

### Facts the build must respect (checked in code, 26 Oct)

- `/fright-fest` is static and prerendered. Live data reaches it only through
  client islands over `/api/v1/championship/fright-fest-2026` and `/me`
  (incident #131, `cache-lifetimes.ts`). No clock, cookies or headers on the
  server.
- Unannounced games are never named. The API drops pending boards (counted in
  `pendingGames`). `registry.ts` names only `announced` games, and today that
  is only Last Bell.
- `lib/championship` and `components/championship` must not import the theme
  (`components/events/fright-fest`), nor the theme the championship
  (`events.test.ts`). The hall imports both, so it lives beside the page, in
  `app/fright-fest/hall/`.
- Every selector in `components/events/fright-fest/*.css` is skin-prefixed. No
  other stylesheet may set base tokens under a seasonal selector
  (`skin-isolation.test.ts`). The hall's CSS may swap pictures under
  `html[data-hp-skin="haunted"]`, as `room.css` does.
- The skin paints from 25 Oct and stops on 2 Nov by itself. Players can choose
  the "Normal" look. Results are due by 4 Nov, and the page must keep working
  (and never 404) after the skin ends.
- Hooks and anchors to keep: `data-testid="ff-phase"` / `"ff-countdown"`, and
  `#rules`, `#standings`, `#rewards`, `#board-<slug>` (used by `HomeCard`).
- The Pack Room is live at `/packs`. Pack prints are at
  `/collectibles/packs/print/<id>.png`, and the odds have the anchor
  `/packs#pack-odds`.
- Decorations are `aria-hidden`, never focusable, and never block clicks. All
  motion stops under `prefers-reduced-motion` and `html[data-hp-still]`.

### Decisions

1. **Build A as reviewed.** The Arcade Hall art from the exploration (the
   haunted room and its calm year-round twin, desk 434×230 and phone 195×H)
   moves into `public/events/fright-fest/hall/`. HTML sits on top in the room's
   own units, the way `room.css` builds the Pack Room. Whole-number scales up
   to 3×, pixelated, with the phone scene below 868 px (the Pack Room's
   breakpoint, so the two rooms switch together).
2. **Seasons.** The haunted art shows under `html[data-hp-skin="haunted"]` and
   the calm art otherwise. That covers "Normal" players, and the page after
   2 Nov, with no 404 and no Halloween props once Halloween is over.
3. **What the room does:**
   - Cabinets are buttons (roving focus, arrow keys) that select a game. A
     details panel on the room's floor shows the mode, status, ranking rule and
     Play. On phones, Last Bell shows "Play on a laptop".
   - The board shows the overall top rows and your row, live from the API, with
     the empty, loading, unavailable, provisional and final states.
   - The marquee ticker shows the phase and the countdown.
   - The prize-counter door links to `/packs`.
   - The noticeboard opens Candy Hunt (see §4).
   - Unannounced cabinets stay identical mystery cabinets.
4. **Below the room, keep the content and logic of today's sections**
   (`FrightFestSections`, `ChampionshipStandings`, `MyChampionship`,
   `PhaseBanner`, points, schedule, rules, rewards), restyled into A's framed
   sections. This adds the reviews' fixes:
   - a one-line Fright Points explainer;
   - the gap to the next place;
   - rewards that say "1 random card" with a link to the odds;
   - the full name as a title on truncated names.

   The tested data code is reused, not rewritten. The room's board and the
   sections share one fetch.
5. **Accessibility,** carried over from the prototype's review fixes:
   - focus stays on the selected cabinet;
   - one polite announcer;
   - pixel type at least 12 px;
   - text contrast at least 7:1 on the art;
   - 44 px targets (48 on coarse pointers / large screens);
   - nothing that works only on hover.
6. **Motion.** The room has a few ambient loops (marquee chase, ghost, dust)
   drawn as background steps, the way the Pack Room does. They pause off-screen
   and in hidden tabs, and they are off under reduced motion and `data-hp-still`.
   This follows the Pack Room's rule for scenes. The theme contract's
   "play once" rule is for decorations around the site.
7. **Easter eggs.** The ghost, the pumpkin and Room 000 are decorative. They
   are `aria-hidden` and not focusable. A pointer click shows one line of text
   and blocks nothing.
8. **`/packs` odds.** Restyle only. The words and numbers stay as they are,
   because they are the published disclosure.
   - Each pack becomes a prize card: its print, name, description, and slots as
     rows. A fixed card shows a rarity chip. A random slot shows the pool name,
     the exact percentages as text, and a rarity bar that is `aria-hidden`.
   - The packs are grouped as Fright Fest 2026 and everyday packs.
   - It uses the Pack Room's palette, so the page reads as one room. The
     anchor `#pack-odds` is kept.
9. **Dashboard.** `/dashboard/collectibles`, and its grant and revoke actions,
   require `super_admin`. The nav link moves to the super-admin block.
   Championship payouts are not affected: they call the collectibles store
   directly and stay with site admins.

### Deliberately excluded

- Any change to the championship API, scoring, phases, board opening, rewards,
  pack catalogue, odds, or inventories.
- Concepts B and C, the review shell, sample data, and the Pack Room preview
  dialog. The door simply links to `/packs`.
- Deploying, and running migrations against production.
- Rewriting the homepage, the Pack Room or the game pages.

### Assumptions

- The Play link for a cabinet is the same one the game page and `HomeCard` use
  today.
- The A art is final as reviewed. Small fixes (for example a cabinet frame) are
  made in the art script, never by hand-editing PNGs.

## 2. Plan how

### PR 1: Collectibles desk, super-admin only
- `app/dashboard/(app)/collectibles/page.tsx` and `actions.ts`:
  `requireRole("super_admin")`, with the docblocks updated.
- `_ui/DashNav.tsx`: move the link into `SUPER_ADMIN_ITEMS`, first in that
  list.
- `actions.test.ts`: assert that each action asks for `super_admin`, and that a
  refused caller writes nothing.
- 1–2 commits.

### PR 2: Pack odds restyle
- `app/components/collectibles/PackContents.tsx` (markup).
- `app/packs/page.tsx` (section header).
- A new `app/components/collectibles/pack-odds.css`.
- A unit test proving every percentage the catalogue publishes still appears
  as text.
- 2–3 commits.

### PR 3: The hall
Order and commits:
1. Art. Copy A's shipping PNGs into `public/events/fright-fest/hall/` (haunted
   and calm, desk and phone; no composites or previews), with an `ART.md` there
   in the style of `public/collectibles/ART.md`. It records that the source
   script is `artifacts/fright-fest-event-hall/art/hall_a.py` on branch
   `design/fright-fest-event-hall`. Fonts and scripts are not copied into the
   repo. Cabinet art for games that are not announced yet is not shipped
   either (see "As built").
2. `app/fright-fest/hall/geometry.ts` and its test: scene sizes, zones and
   breakpoints from A's manifest, as percentages of the room.
3. The room as a server component, with `hall.css`: scenes, seasons, labels,
   eggs, no data.
4. The client islands: cabinet selection with the details panel, the room's
   board, and the ticker. One shared fetch. The announcer.
5. The sections restyled in A's frames, with the explainer, the gap to the
   next place and the rewards copy.
6. `page.tsx` composition, removing the old night scene and the dead
   `FrightFestGames.tsx`.
7. Visual and keyboard pass, written up in this doc as built.

Tests:
- geometry;
- the pure helpers (cabinet status from the API and the registry, ticker text by
  phase);
- the existing `events`, `skin-isolation`, `summary` and route tests stay
  green;
- screenshots at 1366×768 (Chromebook), 1280×600, 1920, 390 and 360, in each
  phase, with the API down, and with the skin on and off.

### Checks before calling any PR done
- `npm run lint`, `npm test` and `npm run build`.
- The baseline on unchanged `main` (26 Oct) is:
  - lint errors only in `public/games/last-bell/*`;
  - test failures only in `console-capture.test.ts` and `streak-event.test.ts`.
- Anything beyond that baseline is ours to fix.

## 3. Who builds what

Sonnet builders, one per PR, in separate worktrees, with these plans as their
specs. I review each diff, check it in a real browser, and commit or adjust
before anything is pushed.

## 4. Candy Hunt (PR 4): needs the owner's decisions

Nothing exists today. Collectibles decision 1 says "Free and earned only. No
purchases, no currency". A candy you spend on packs would be a currency, so
either that rule is amended or candy is a progress jar that pays packs at
thresholds. What can be verified on the server: accepted ranked runs
(`championship_runs`), achievements (`player_achievements`, reported by the
game) and scores. Packs are granted through `collectiblesStore.grantPack`,
which has idempotent keys and `source: 'event'`. A new pack means a new
catalogue entry; existing odds tables can be reused.
The detailed plan follows once these are decided.
