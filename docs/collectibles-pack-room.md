# The Pack Room as a prize counter (concept A)

Sibling of `collectibles-design.md` (catalogue, ownership, API, binder) and
`collectibles-opening.md` (the foil pack and the tear). This note owns the
Pack Room page, the new pack prints, and the redesigned reveal and results.

The design was explored in `artifacts/hallpass-collectibles-redesign.html`
(sources: `artifacts/collectibles-redesign-src/`). The owner chose concept A,
"The Prize Counter", in October 2026.

**Nothing here changes who owns what.** The API, the store, the schema, the
catalogue, the odds, championship rewards and every test about them stay
exactly as they are. This is presentation only.

---

## 1. What is built

1. **`/packs` is a lit pixel-art prize counter.** The room is one painted scene:
   - laptop: 434×230 native, shown at 3×;
   - phone: 195×358 native, shown at 2×.

   HTML sits on top of it:
   - the player's newest sealed pack stands on the riser under the lamp;
   - their other packs stand on the counter (a click brings one forward);
   - an info panel shows the pack name, the collection, "3 cards", **Open** and **What's inside?** (the catalogue's odds);
   - an "N sealed · All packs" sheet;
   - recent pulls on the left board;
   - collection progress on the right board, which is the way into the binder.
2. **Seasons with no code path.** The Fright Fest room (pumpkins, a ghost, a
   flickering lamp) is the same layout with other pictures. CSS swaps it in
   under `html[data-hp-skin="haunted"]`, so it follows the event skin and the
   player's look menu live, and only the visible season's pictures download.
3. **Nine new pack prints** (96×140 pixel art, each with a foil mask):
   - Fright Fest Participation, three Game Champion packs and the Overall Champion;
   - HallPass Originals, Internet Culture, Brainrot and Turkish Internet Culture.

   They are used on the counter, as `<img>` at a whole-number scale, and in the
   WebGL opening (`opening/pack/art.ts`). The opening draws the print into its
   colour texture and builds the metal/roughness/coat texture from the foil
   mask. The procedural prints go.
4. **The opening plays in the room.** Open dims the room, and the pack lifts off
   the riser to the middle of the screen, where the WebGL pack takes over. The
   room stays behind, about 90% dark, through the reveal and the results.
   Leaving puts you back at the counter, which has already updated: the pack is
   gone, the count and the progress have gone up, and the pulls are on the
   recent board.
   - The URL becomes `/packs?pack=<public id>`, via `history.pushState`, the
     pattern documented in the Next.js 16 linking guide. A refresh or a shared
     link resumes in the room. Back closes it.
   - `/packs/open?pack=<id>` keeps working and renders the same room with that
     pack open. Old links and the lab still land correctly.
5. **The reveal: one large card at a time, on every screen.**
   - Cards are 300×420 (a new `xl` size) on laptops and 260×364 (`lg`) on
     phones, rarest last, as the server ordered them.
   - One button in a fixed place: **Turn it over**, then **Next card**, then
     **See all three**. **Reveal all** is a quiet link and **Skip** is in the bar.
   - Once the face is up: rare and above get a rarity plate and a soft light;
     epic and legendary also get slow rays; legendary gets a large gold plate.
   - New cards say "New for your binder". Cards the player already had say
     "Already in your binder" in a neutral colour, never "Duplicate".
   - Progress through the three cards shows once: a tray beside the card on
     laptops, three dots on phones.
6. **The results.**
   - Laptop: two columns. On the left, the hand, with the best pull in the
     middle and larger (marked BEST PULL when rare or better). On the right:
     - "Pack opened · N new for your binder", or "Nothing new this time";
     - the set's progress box, which leads with "8 of 20" and "+2 new", its new
       slots filling one by one;
     - one primary action, **See them in your binder**;
     - two equal secondaries, **Back to the Pack Room** and **Next pack (n left)**;
     - one quiet "How rare is this? See the odds".
   - Phone: the best card, then a list (name, rarity in words, New / Had it),
     then the same box and actions.
   - "Back to HallPass" goes; the site header already does that.

## 2. Decisions

- **Whole-number pixel scales where they fit, honest scaling where they don't.**
  - At a content width of 1302 px or more (a 1366 px laptop beside the 64 px
    sidebar, and anything wider) the room is exactly 3×, and the packs are
    exactly 2×.
  - Between 868 and 1301 px (1280 px laptops, landscape tablets) the whole
    scene scales uniformly between 2× and 3×. Pixels there are not perfectly
    even, but the alternative was letterboxing a 2× room with half the space
    empty.
  - Below 868 px the phone composition is used, at 2× (capped at 2.5× for
    portrait tablets), centred on the room's wall colour.
  - The HTML on top (text, buttons) is never scaled. It is positioned in room
    coordinates and keeps 44 px tap targets.
- **The Chromebook fold.** A 1366×768 Chromebook shows about 640 px of page under
  the browser's own bars. Open sits in a stacked panel directly under the
  featured pack, so its bottom edge is at about 638 px.
- **The room is drawn by the server.** The art and its loops are static HTML and
  CSS. Only the packs, the panel and the boards wait for `/api/v1/collection`.
  The scene never shifts when they arrive, because the room keeps a fixed aspect
  ratio from the first paint.
- **The opening layer is a modal dialog.** It is portalled to `<body>` and
  covers the whole viewport, the site header included. Everything else is
  `inert` while it is open, and focus returns to the pack (or to the counter)
  when it closes. Escape puts an untorn pack back; during the reveal it still
  means Skip.
- **The OpeningFlow state machine is unchanged.** `machine.ts` keeps every stage
  and guard; the server is still called once, from the commit handler. What
  changes is layout (`placement.ts`: the "row" layout goes, "focus" serves every
  screen) and presentation (`OpeningFlow.tsx`, `opening.css`). The flow gains an
  optional `room` prop with `close`, `next` and the room's already-loaded
  collection, so it can skip its own first fetch.
- **The candy placards are repainted.** The design's art carried "CANDY SOON"
  (laptop) and "CANDY EXCHANGE · SOON" (phone). Production should not promise a
  feature nobody has decided to build, so the gumball machine stays as scenery
  with a plain plate, and the phone's bottom plate reads "FREE PACKS · EARNED BY
  PLAYING". There is no candy UI.
- **The demo-art tag stays on cards** until real card art lands, as the
  catalogue already requires.

## 3. Deliberately excluded

- Rooms B and C, and any switcher between rooms.
- Pack backs. The WebGL pack has no back face; adding one is 3D work for later.
  The back art stays in `artifacts/`.
- Any API, schema, store, catalogue, odds or reward change. Any candy feature.
  Any change to championship logic.
- Deploying. This branch stacks on `collectibles-pack-opening`, which is not
  merged; nothing here is pushed or deployed.

## 4. Assumptions to check

- The Turkish pack print still needs a Turkish speaker's review, as the Turkish
  card set already does.
- The 68 card illustrations are still the demo art.
- The 640 px fold is an estimate for a 1366×768 Chromebook with Chrome's bars.

---

## 5. Implementation

### Files

| File | Change |
|---|---|
| `public/collectibles/room/a/*.png` | Room art: laptop and phone, normal and haunted, and the loop strips. |
| `public/collectibles/packs/print/<key>.png`, `<key>-foil.png` | The nine prints and their foil masks. |
| `public/collectibles/ART.md` | The new assets, their sizes and where their sources live. |
| `app/lib/collectibles/catalogue/index.ts` | `packPrintSrc(packId)`, `packFoilSrc(packId)`: pack id → print. Test: every pack has a 96×140 print and mask. |
| `app/components/collectibles/opening/pack/art.ts` | `packArt()` draws the PNG print at a whole-number scale (smoothing off), plus a material canvas from the foil mask. Same `PackArt` contract, so `glPack.ts` and `domPack.ts` don't change. |
| `app/components/collectibles/room/geometry.ts` (+ test) | Pure: the room's hotspots, choosing the composition and scale for a width, the order of sealed packs, which pack stands where. |
| `app/components/collectibles/room/PrizeCounter.tsx` | The room: art, loops, packs, info panel, boards, the All packs sheet, the odds popover, and the loading, signed-out, unavailable and empty states. |
| `app/components/collectibles/room/OpeningLayer.tsx` | The modal layer: the URL, the flight off the riser, dimming, inert, focus return, refreshing the room afterwards. Loads `OpeningFlow` on demand (prefetched on hover, focus or idle). |
| `app/components/collectibles/room/room.css` | The room's styles (only loaded on `/packs`). |
| `app/components/collectibles/useMyCollection.ts` | Adds `reload()`. |
| `app/components/collectibles/Card.tsx`, `collectibles.css` | The `xl` size (300×420; 48 px art ×5, 32 px art ×7). |
| `app/components/collectibles/opening/OpeningFlow.tsx`, `opening.css`, `placement.ts` (+ test), `RevealCard.tsx` | The `room` prop, the one-at-a-time reveal, the rarity staging, the new tags, tray and dots, the two-column results. |
| `app/lib/collectibles/opening.ts` (+ test) | `revealLine` says "already in your binder" instead of "duplicate". |
| `app/packs/page.tsx`, `app/packs/open/page.tsx` | Both render the room; the open page keeps `noindex`. |
| `app/components/collectibles/CollectiblesShell.tsx` | A `wide` option: the room needs the whole content width. |
| `app/packs/lab/*` | The lab's room view is the new room over the fake API, with opening in the room. |
| Removed | `PackRoom.tsx`, `PackPrint.tsx`, `OpenFromQuery.tsx`, and their CSS. |
| `docs/collectibles-design.md`, `docs/collectibles-opening.md` | Point here for the room, the prints and the reveal. |

### Order and commits

1. This plan.
2. The art (room and prints), with the candy placards repainted, plus `ART.md`.
3. `packPrintSrc` and its test.
4. The opening's pack drawn from the new print.
5. Room geometry and its tests.
6. The room itself on `/packs`: art, seasons, packs, panel, boards, states.
7. Room interactions: bring forward, What's inside?, the All packs sheet.
8. Opening in the room: the layer, the URL, the flight, the return; `/packs/open` and the lab.
9. The reveal: `xl` cards, one at a time, rarity staging, the new tags, tray and dots.
10. The results: two columns, best pull, progress box, actions.
11. Removing the dead code.
12. Updating the docs.

### Checks

- `npm run lint`, `npm test` and `npm run build`. Two test files fail on this
  branch before any change (`app/lib/console-capture.test.ts` and
  `app/lib/streak/streak-event.test.ts`: `localStorage` is missing under Node
  26); they are not touched.
- Playwright against the lab (the fake signed-in player) at 1366×768, 1280×720,
  390×844 and 360×740, in both seasons, with motion on and reduced. For each run:
  - open by drag and by Open it, through the reveal to the results, then back
    to the room;
  - check the counts update, nothing overflows sideways and there are no
    console errors;
  - check the Open button's bottom edge against the 640 px fold;
  - check focus order, Escape, and the inert room;
  - screenshot every beat.

### As built (26 Oct 2026)

- Built in the order above, one commit per step, plus a fix found by the
  browser checks: the Open button goes inert when the layer opens, so focus
  fell to `<body>` during the flight; the layer now holds it until the pack
  lands.
- Playwright against the lab on the dev server, at 1366×768 and 1280×720
  (laptop) and 390×844 and 360×740 (phone, touch), each once in the Fright Fest
  season with motion and once in the normal season with reduced motion. Each
  run: Open from the room, tear by dragging (a touch drag on phones), turn all
  three, the results, back to the room (sealed count down by one, recent pulls
  updated, focus back on Open); then Open it, the results, Next pack, Escape
  puts it back; then the browser's Back closes a layer. All eight pass with no
  console errors and nothing overflowing the layer sideways. Open's bottom edge
  sits at 638 px at 1366×768 and 607 px at 1280×720.
- `npm test`: the collectibles suites pass; the two files named above still
  fail, as before. `npm run lint`: no errors in anything this branch touches;
  50 errors remain in `public/games/last-bell/` (its bundled three.js and game
  scripts), the same on `collectibles-pack-opening`.
- Found in Safari on the live site the same day, and fixed:
  - The flight aimed at the stage's first, unmeasured layout (the pack at
    140 px), so the stand-in shrank in place and the full-size pack popped in.
    The stage now marks itself `data-measured`, and the flight waits for that
    and for one still frame.
  - Safari draws the focus ring for focus moved by script, so a pack opened
    with a click wore a yellow box. The layer keeps rings quiet
    (`data-quiet`) unless the opening began from the keyboard, until a key is
    pressed inside it.
  - The browser checks now also run in WebKit (laptop sizes).
- Not done: a real phone, a real screen reader, Safari on iOS. In a desktop browser
  window narrowed to 390 px (no touch) the site header is 477 px wide on every
  page, so the page scrolls sideways; with touch, as on a phone, it fits. That
  predates this work and is left alone here.
