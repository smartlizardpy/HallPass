# Fright Fest 2026: event hall design exploration

Three pixel-art redesigns of the `/fright-fest` event page, with an interactive prototype to compare them.
This is a design exploration only. Nothing here is wired into the app, deployed or merged.

- **Branch:** `design/fright-fest-event-hall` (worktree `.claude/worktrees/fright-fest-hall`)
- **Review artifact (private until you share it):** https://claude.ai/artifact/EG5QUXXE4VfB9Kswk1rMMK

## Opening it

**Published:** open the link above. The top bar switches between views; Explore is the prototype.

**Locally:** open `prototype/index.html` in Chrome. If your browser blocks local frames, serve the folder:

```sh
cd artifacts/fright-fest-event-hall/prototype
python3 -m http.server 8000   # then open http://localhost:8000
```

`prototype/hall.html` is the event page on its own. It takes the same settings as query parameters
(for example `hall.html?concept=b&phase=live&data=sample&auth=in`).

### Explore controls

| Control | Options |
|---|---|
| Concept | A Arcade Hall · B School Hall · C Possessed · Live today (the current page) · Championship branch |
| Device | Chromebook 1366 (with the fold at 640 px) · 1280 laptop · Whiteboard 1920 · Phone 390 · Small phone 360 |
| Phase | Upcoming · Live · Closed · Final |
| Data | Real today (no results exist yet, so the boards are empty) · Sample (clearly labelled sample players) |
| Lineup | As configured (only Last Bell announced) · All three open |
| API | OK · Loading · Down (the leaderboard is unavailable) |
| Switches | Haunted skin (off = the year-round room) · Championship · Signed in · Reduced motion · Hotspots + data sources (the review overlay: hit areas, where each element's data comes from, the Candy Hunt integration boundary) |

The page reacts to clicks, taps, the arrow keys and Escape: select a cabinet, open the prize counter,
read the board and walk through Candy Hunt. Easter eggs are in every room.

## Where each deliverable is

| Deliverable | Where |
|---|---|
| Audit of the current page | Artifact → Audit (`prototype/docs.js`); captures in `shots/current/` |
| Research and visual references | Artifact → Research; full notes in `research/a-environments.md`, `b-event-ux.md`, `c-visual-language.md`, `d-feasibility.md`; game references in `art/ref/` |
| Art-direction system shared with HallPass and the Pack Room | Artifact → Art system; the contract every builder followed is `art/CONTRACT.md` |
| Three concepts with original pixel art | `art/brief-a.md`, `brief-b.md`, `brief-c.md`; the art is drawn by `art/hall_a.py`, `hall_b.py`, `hall_c.py` (shared kit `art/pxkit.py`) into `art/out/<a,b,c>/`, each with `NOTES.md` and `manifest.json` |
| Interactive review artifact | `prototype/` (link above) |
| Desktop, phone, laptop and whiteboard previews | Artifact → Explore → Device; static captures in `shots/` (`first-*`, `lap-*`, `wb-*`, `phone-*`, `phone2-*`) |
| Current vs proposed | Artifact → Compare, and Concept → "Current page" in Explore |
| States: upcoming, live, closed, final, empty, loading, leaderboard down, season off, championship off | Explore controls; captures `first-*-today` (today: upcoming, real data, empty boards), `calm-*`, `off-*`, `final-*`, `error-*`, `loading-a` |
| Integration points for real data | Artifact → Build notes; the review overlay toggle shows the source of every element on the page; mock API in `prototype/data.js` |
| Implementation effort and trade-offs | Artifact → Build notes (A 5–6 days, B 6–7, C 8–10) |
| Journey: homepage → event hall → Pack Room | Artifact → Journey; the prize counter opens a preview of the approved Pack Room in every concept |
| Independent review findings | Artifact → Reviews (`prototype/reviews.js`) |
| Plan, decisions and exclusions | `PLAN.md` |

## Rebuilding

```sh
python3 art/hall_a.py   # likewise hall_b.py, hall_c.py: redraw one concept into art/out/
python3 prototype/build.py   # copy art and references into prototype/art and write manifests.js
```

`build.py` reads the Pack Room art read-only from `artifacts/collectibles-redesign-src/art/out` in the
main checkout. The bundled pixel fonts in `fonts/` are used only by the art scripts.

## Flags for whoever picks this up

- **Candy Hunt does not exist.** It is shown as a labelled preview ("Preview · not open") with nothing
  earnable, and its integration boundary is marked in the review overlay.
- **There is no runner-up reward** in the championship config. The designs show only the guaranteed
  awards that exist: the overall champion pack, the three game champion packs and the participation pack.
- **Only Last Bell's Halloween Shift is real and verified.** Cursed Dash and Blood Moon are not in
  their games yet, so their cabinets stay unnamed until announced, matching the API.
- **Last Bell is desktop-only**, so on phones its button reads "Play on a laptop" instead of Play.
- All names on the boards are sample data (`sample·…`) and are labelled Sample in every state.
- The live homepage logged React hydration error #418 during the audit captures. It was not investigated.
- The research is thin in places. Web search returned little deep craft writing, and several
  publisher pages refused the fetch, so many points are marked unverified (general knowledge, not a
  cited page). The research files label each point as fetched or unverified.

## Concurrency

- All work is in this worktree on its own branch. The main checkout and its uncommitted work from
  other sessions were not touched.
- No app code, shared components, package configuration or global styles were changed.
- The Pack Room session confirmed it would not move the shared art sources. Its art was copied
  read-only into `prototype/art/packroom` and `prototype/art/packs`, and was not edited.
- Nothing was deployed, pushed or merged. No reward data, odds, Candy balances or inventories were touched.
