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
| Rendering | foil pack: WebGL, or DOM fallback | `opening/pack/gl/*`, `opening/pack/dom.ts`, `opening/pack/art.ts` |
| Timelines | extraction, deal, flip, summary (Web Animations API) | `opening/reveal/*` |
| Sound / haptics | gesture-linked cues | `opening/sound.ts`, `opening/haptics.ts` |
| Card materials | uniform back, tilt-reactive foil | `Card.tsx`, `collectibles.css`, `useCardTilt.ts` |
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
