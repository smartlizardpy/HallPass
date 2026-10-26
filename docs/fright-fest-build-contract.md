# Fright Fest skin: build contract for contributors

Read `docs/fright-fest-theme-plan.md` first. Visual source of truth: round 3 strength C
(`data-hp-lv="3"`) of `artifacts/fright-fest-homepage-explorations.html`; extracted pieces
(css, runtime js, markup, palette) are in the scratchpad `extract/` folder the lead hands out.

## Rules
- `<html data-hp-event="fright-fest">` means the event window is open on this page;
  `data-hp-skin="haunted"` means the haunted look is actually painted (a player can choose
  "Normal HallPass", leaving only the event attribute). Written by `app/lib/events/boot.ts`
  + `EventController`. `data-theme` is `dark|light`.
- ALL decoration and restyling CSS keys on `html[data-hp-skin="haunted"]`. Only the
  appearance-menu entry points (which must stay reachable to a "Normal" player) key on
  `html[data-hp-event="fright-fest"]` and are rendered/hidden by that attribute alone.
- Seasonal CSS lives ONLY in `app/components/events/fright-fest/*.css`; each selector starts
  with `html[data-hp-skin="haunted"]` (or `html[data-hp-event="fright-fest"]` for the menu
  entry only) (tested).
  Base tokens (`--background`, `--surface`, `--brand`…) are assigned only in `haunted.css`.
  Use the `--ha-*` tokens, `--ha-clip-N` (stepped pixel corners) and `--spr-<name>` sprite
  variables (`background-image: var(--spr-ghost)`, class `ha-spr`) that `haunted.css` defines.
- Never edit `app/globals.css` permanent values, never add event logic to shared components
  beyond inert hooks. Shared components may gain: decoration elements with class `ha-deco`
  (hidden for everyone by globals.css, shown by the skin), `aria-hidden="true"` and no
  focusability; `data-*` hooks; nothing that renders differently without the skin.
- Decorations live in margins, never over a cover, title, badge or control, and never block
  clicks (`pointer-events:none` unless an easter egg is meant to be clicked).
- Motion: steps() timing, short, plays once, nothing loops. Every keyframe/animation is
  disabled in `@media (prefers-reduced-motion: reduce)` AND `html[data-hp-still]` blocks
  inside your own css file. No sound. Nothing runs while off-screen.
- Moment decorations (bat, spider, eyes, ghosts, marquee flicker, moon glow) carry
  `data-ha-moment="<name>"` and rest in their static state; the runtime (written later by
  the lead) sets `data-playing` on them. Write the resting + `[data-playing]` CSS.
- Server components must not read the clock. The championship lives in
  `app/lib/championship/` (switch: `enabled` in `fright-fest-2026.ts`) and
  `app/components/championship/`; nothing in theme code imports either, and
  championship code imports nothing from the theme (`events.test.ts` enforces both).
- Do not modify games. Do not touch files outside your region. Do not run git commit/add
  (the lead commits). Run `npx eslint <files>` and `npx tsc --noEmit -p .` on what you
  change. Dev server: http://localhost:3100 (already running; do not start another).
- Screenshots: `node $SCRATCH/shot.mjs <url> <out.png> <w> <h> <dark|light> <ISO date> <full 0|1> [look=normal rm]`
  (use date 2026-10-29T12:00:00Z for skin on, 2026-10-20 for normal) and the artifact:
  `node $SCRATCH/art2.mjs <Home|Catalogue|Game|Search|You|Profile|Friends> "<Haunted Dark (default)|Haunted Light>" "<Laptop 1366|Phone 390|Board 1920>" <out.png> <full 0|1>`
  Run both from `$SCRATCH`, then READ the two PNGs and compare geometry, colour, spacing and
  art. Iterate until they match. Also check the skin-off page (date 2026-10-20) is unchanged.
