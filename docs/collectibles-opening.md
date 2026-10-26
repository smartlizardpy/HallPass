# Pack opening — the physical redesign

Sibling of `collectibles-design.md` (which still owns the catalogue, ownership,
API and binder). This note owns **how a pack is opened on screen**: the foil
pack, the tear, the cards leaving the wrapper, the reveal and the summary.

The opening is a *presentation* of a result the server has already decided.
Nothing here changes who owns what. See §6.

---

## 1. Audit of the first opening (Oct 2026)

| Observed | Cause in the code |
|---|---|
| The pack looks flat | It was two flat CSS boxes (`.hp-pack-body`, `.hp-pack-seal`) and one `overlay` gradient that followed the raw pointer. "Tilt" was a ±12° rotation of a flat plane: no shading, no pillow shape, no crinkles, no crimp ridges, and a hard sticker shadow instead of a soft contact shadow. |
| The tear isn't foil | Progress was `abs(dx) / width` inside a 35° cone (axis projection, not the finger's path). The seal was one rigid element clipped by a regular sawtooth. While dragging, the whole strip translated ≤ 10 px and rotated ≤ 9°, including the part that should still be attached. There was no torn edge and no gap. The commit was a CSS transition to a fixed `translate + rotate + fade`, and release velocity was ignored. |
| Packaging and cards are disconnected | On success the pack subtree unmounted and a new card row mounted in the same frame. The cards keyframed in from `translateY(70px) scale(.6)` in mid-air. |
| All cards appear abruptly | Three cards mounted at once over about 0.6 s, from nowhere. The layout jumped from the pack box to the card row. |
| Face-down cards leak rarity | Deliberate in the first design: `CardBack` took `rarity` and drew the rarity's **die-cut silhouette** (crown, scallops, steps, notch) plus a **rarity-coloured glow**. `HOLD_MS` also paused rarer cards for 150–600 ms before flipping, which is a timing tell. |
| Mobile reveal is cramped | It used the desktop row with `sm` cards, wrapped 2 + 1. The summary actions sat under the bottom nav. There was no single-card focus and no safe-area handling. |
| Rare cards are weak | Rare was a sheen that only moved on hover, so it never moved on touch. Epic and legendary were one gradient that jumped with the raw pointer. The card did not tilt, and no reveal moment existed beyond the pre-flip hold. |

Also:
- The only sound was one noise burst, not tied to the gesture.
- There were no haptics.
- A refresh mid-reveal showed every card face up.
- `setTear` re-rendered the whole flow on every pointer frame.

The backend was checked and is **not** a cause. `openPack` is atomic (an advisory lock, then one `UPDATE … RETURNING` feeding the insert) and idempotent, and the route returns the stored pulls on every later call.

## 2. Reference: OpenPack, and holo CSS (licences)

- **OpenPack** (github.com/Luango/openpack) has **no licence**: no LICENSE file, and the GitHub licence field is null. That means all rights reserved, so nothing is copied. Everything here is an independent implementation. Its art is Pokémon TCG imagery, and its sound files have no per-file provenance.
  - **What it does:**
    - The tear follows the finger's **path** (SVG clip-paths along a jittered polyline).
    - The pack is flat, unshaded art.
    - Its own rAF springs drive the motion.
    - Sound tracks pointer speed, and there is a haptic ratchet.
    - Most of the physical feel comes from **input handling**, not rendering.
  - **What we do differently:**
    - The forgiving rules suit children: no "kink" voiding, and progress is kept after an early release.
    - The torn strip bends and is lit.
    - There is a keyboard and reduced-motion path.
    - Sound is synthesised or CC0.
- **cards-css** (github.com/kongyo2/cards-css) is labelled MIT, but it reuses the distinctive variables and formulas of **simeydotme/pokemon-cards-css, which is GPL-3.0**. We take **concepts only**: pointer variables on one element, layered gradients with blend modes, a radial glare, and generated textures. We copy no CSS and no textures.

## 3. Architecture

**Raw WebGL for the foil pack (no three.js), a DOM fallback, and DOM cards.**

The test the brief sets is that a tear paused half-way must look like a half-open wrapper, not two rectangles. That needs three things:
1. The torn part of the strip **bends** while the untorn part stays attached.
2. The lighting changes across that bend and with tilt.
3. There is a visible torn edge and gap.

Clip-paths and rigid transforms (the old code and OpenPack alike) cannot bend a strip with continuous shading. A small WebGL renderer can:
- one canvas;
- about 3k triangles in one pass;
- generated crinkle and crimp normals;
- studio reflections plus a light that follows the pointer;
- draws only while something moves.

The cards stay DOM, for pixel art at whole-number scales, real text and accessibility. They sit **between** a DOM interior (the back wall of the pouch) and the canvas (the front wall), so they can slide out of the wrapper with the wrapper genuinely in front of them.

| Layer | Owns | Files |
|---|---|---|
| State | stages, guards, reveal order, resume | `opening/machine.ts`, `opening/resume.ts` |
| Input | tear gesture model (pure), pointer plumbing | `opening/tear.ts`, `opening/pack/PackStage.tsx` |
| Rendering | foil pack: WebGL, or DOM fallback | `opening/pack/gl/*`, `opening/pack/domPack.ts`, `opening/pack/art.ts`, `opening/pack/mesh.ts`, `opening/pack/surface.ts` |
| Timelines | extraction, deal, flip, summary (Web Animations API) | `opening/OpeningFlow.tsx`, `opening/RevealCard.tsx`, `opening/placement.ts`, `opening/motion.ts` |
| Sound / haptics | gesture-linked cues | `opening/sound.ts`, `opening/haptics.ts` |
| Card materials | uniform back, tilt-reactive foil | `Card.tsx`, `holo.css`, `useCardTilt.ts` |
| Pack Room shelf | the same print, as a 2D canvas | `PackPrint.tsx`, `PackRoom.tsx` |
| Backend result | unchanged | `/api/v1/collection/packs/<id>/open` |

### Stages

`loading → sealed ⇄ tearing → committing → opened → extracting → revealing → summary`, with `signed-out`, `missing`, `revoked` and `error` as load outcomes.

- **Inspection** is an input mode of `sealed`, not a stage.
- **"Complete"** is `summary` with the per-device resume record marked done.
- **The server is called exactly once per commit.**
  - It is called from the commit handler, guarded by an in-flight ref and by the stage. It is never called from an effect, so StrictMode cannot double it.
  - Animation callbacks only dispatch presentation events (`loosened`, `extracted`, `flip-done`) and never touch the server.
- **Skip:**
  - It is available from `committing` onward.
  - It jumps to the summary with the same pulls.
  - If the answer has not arrived yet, it waits for it.

## 4. Decisions

1. **One physical form.** Every pack is the same crimped foil booster. Each collection keeps its print: colours, pixel emblem, motifs and name. (Owner, 26 Oct.)
2. **The back of a card says nothing.** Every back has the same silhouette, pattern and timing. The flip starts identically for every card, and the face appears at the same moment. Rarity staging starts only once the face is visible. This replaces the "true-rarity glow" of `collectibles-design.md` §5.
3. **Reveal order is rarest last** (stable by slot). This is the real order, not a fake tell, and it builds the reveal up.
4. **Forgiving tear:**
   - Start anywhere on the top band.
   - Progress follows the finger along the seal and never goes backwards.
   - Releasing early keeps the tear and relaxes the strip.
   - It commits at the far edge, or on release past 55% (or a quick flick).
5. **Refreshing after opening resumes the reveal** where this device left it (`localStorage`, per pack). A pack opened more than a day ago with no record goes straight to the summary.
6. **Sound is off by default,** with one toggle. Haptics are subtle, on Android only (iOS has no vibration API).

## 5. Excluded

- Catalogue, odds, rarities, card art, binder, ownership and API changes.
- View Transitions: `experimental.viewTransition` in Next 16 is "not for production".
- three.js, GSAP and Motion.
- Trading-card-style "screen takeover" effects.

## 6. Backend invariants this must keep

- Contents are rolled and stored server-side, once, at open time. The client never chooses them.
- A refresh at any point cannot reroll. Before the commit the pack is still sealed. After it, the open call returns the stored pulls.
- A rendering error never loses a pack. The cards are in the binder the moment the open call succeeds, whatever the animation does next.

## 7. As built (26 Oct 2026)

### The sequence

| Step | What the player sees | Timing |
|---|---|---|
| Sealed | One crimped foil booster with the collection's print. It tilts toward the pointer (or a finger) and catches the studio light and a pointer light; the thumb dents the foil. | the player's pace |
| Tear | Drag along the top seal. The torn length of the strip lifts, curls toward the viewer and twists while the rest stays attached; the torn edge and the silver inner film show. Releasing early keeps the tear. | the player's pace; Open it / Enter tears it in 0.62 s |
| Opened | The strip flies off with the release velocity. The wrapper loosens, lowers, and the face-down stack shows in the mouth. | 520 ms, then ~0.6 s |
| Extracting | The stack is drawn up out of the wrapper (DOM cards between the interior and the canvas front wall). | 0.7 s |
| Dealing | The cards are dealt from the stack to their places while the wrapper drops away. | 120 ms stagger, 620 ms each |
| Revealing | Every back is identical. A turn lifts, rotates and settles the card in 860 ms; the face shows at 52 % for every card. Only then does the rarity moment play (0 / 650 / 1000 / 1200 / 1500 ms, common to legendary). Rarest last. | player-driven |
| Summary | The hand (a row on wide screens, a fan on phones), NEW / Duplicate, collection progress, Open another pack, See your binder, Pack Room, Back to HallPass. | |

### Screens

- **Wide** (three medium cards fit across): a row; only the next card is a button; the summary follows ~0.7 s after the last turn settles.
- **Phones** (`chooseFit` in `placement.ts`): one card in front, as large as the height allows (lg, md, then sm), the face-down rest stacked behind, seen cards in a tray below. Tap turns over, then tap or swipe moves on. The card in front takes every touch (`touch-action: none`) so a swipe never scrolls the page.
- **Short and wide** (a phone on its side): the title, chips and buttons stand in a column beside the table, the tray sits beside the card, and the card in front shrinks (to no less than 0.6) to fit.
- The stage fills the screen below the site header and above the tab bar (`--ho-top`, `--hp-bottom-chrome`), so no phone scrolls mid-opening. Checked at 390×844, 320×568 and 844×390.

### Measurements

Headless Chromium with **software WebGL (SwiftShader)** on the dev server (React development build), 1280×860 at 2× density, pack 03. rAF frame intervals; 16.7 ms is one 60 Hz refresh. These are pessimistic: a real GPU draws the pack far faster, and CDP CPU throttling slows the page's main thread but not SwiftShader, which renders in the GPU process.

| Phase | 1× CPU: median / p95 | 4× CPU: median / p95 (share > 20 ms) |
|---|---|---|
| Idle, sealed | page requests **0** frames | 0 |
| Pointer over the pack | 16.7 / 33.4 ms | 16.7 / 33.4 (26 %) |
| Tear | 16.7 / 33.3 ms (14 %) | 16.7 / 33.4 (45 %) |
| Open, extract, deal | 16.7 / 33.4 ms; one frame up to 100–350 ms | 16.7 / 33.4 (33 %) |
| Card turn | 16.7 / 16.8 ms | 16.7 / 16.8 (1 %) |
| Summary | page requests **0** frames | 0 |

- 6× CPU matched 4×. Adaptive quality settled the canvas at 1.25–1.5× density during the tear (from 2×); before it judged a median over 12 frames, the tear's median was 33 ms.
- Crinkle normal map: 16 / 23 / 40 ms at 256 / 384 / 512 px (Node, Apple silicon). It is generated in an idle callback after the first frame, at 320 px on modest devices.
- We do **not** claim 60 fps on any device: nothing was measured on a real GPU, phone or Chromebook.

### QA (lab, Chromium; phone flow also in WebKit)

- One open call per attempt, including double and triple clicks, repeated Enter and a click storm on cards and Reveal all.
- Refresh mid-tear: still sealed. After commit: the same pulls. After turning one card: that card face up, the rest down. In the summary: the summary.
- `fail=1`: notice, pack visibly whole, the second tear succeeds (2 calls). `slow=3000`: "Opening…", Skip waits for the answer.
- Skip and Esc from committing, opened, extracting and revealing all land on the same three cards.
- WebGL context loss and `--disable-webgl`: the DOM pack takes over and the journey completes.
- After the summary no canvas is left and no animation frame is requested.
- Keyboard only: Tab, Enter/Space and Esc complete it; focus moves to the next card, waits on the title while nothing is focusable, then lands on the summary heading.
- Reduced motion: the whole journey works, with fades for movement.

### Known limitations

- No real iPhone, Android phone or Chromebook was used; no real screen reader (VoiceOver, TalkBack) was run, only the accessibility tree and the live-region text.
- Nobody has listened to the synthesised sounds; their levels (peaks about −11 to −14 dBFS) are computed, not judged.
- The touch tear was only driven in Chromium (CDP touch events); WebKit was run with Open it and taps.
- Two tabs on one pack were only checked against the lab's per-tab mock, which cannot prove the real server's idempotency; the route's own tests cover that.
- The turning card briefly overlaps "Card N of 3" above it on phones.

### Preview

`npm run dev`, then `/packs/lab` (development only; it 404s in production):
`?view=pack&id=<pack id>` is the pack on its own with a bench (Auto tear, Loosen, Tug, Drop away), `?view=room` is the Pack Room, and `?view=open&pack=11111111-2222-4333-8444-5555555555NN` (NN 01–06) is an opening against a mocked player. Add `reset=1` to reseal, `slow=<ms>`, `fail=<n>` or `state=signedout`.
