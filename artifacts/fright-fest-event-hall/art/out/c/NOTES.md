# Concept C - The Possessed Arcade: notes

Script: `art/hall_c.py` (deterministic; `python3 hall_c.py` from `art/`). Everything in `art/out/c/`.

## Colours (fixed 56-colour palette; every output is snapped to it)
- Haunted desk bg + fg + cabinets (no fog): 45 colours; calm: 42. The fog is one flat colour (#7d70a8) at constant 13-18% alpha, so a composite with fog blended shows more colours than the art uses.
- Over the 40 base: haunted extras are orange (4), neon pink (4); light tints (beam 4, door spill 2 haunted / 3 calm).

## What is where (desktop 434 x 230, vanishing point 217,96)
- bg: walls and floor in one-point perspective (clean stair-steps: cab-row base 1:1, wall base 1:2, cab tops 1:3, trim 1:4), ceiling beams, two rows of dead cabinets (inner row and a darker outer row), posters, the HI-SCORE shrine (fused green / purple / crimson cabinet parts, pink neon edge, cracked marquee), moon shaft from a broken skylight, MADAME MOON booth, the warm PRIZES doorway, floor guide lights, puddles.
- fg: dark edge cabinet slabs (left x 0-26, right 408-434), hanging cables, broken neon tube, floor cables (rows 214-230), crooked FRIGHT FEST sign on chains with the hallpass wordmark and yellow dot, the ticker plate. Haunted adds corner webs, a spider, the ghost behind the right slab.
- fog.png: 434 x 40, seamless horizontally. Flat `desk-*.png` = bg + fg (no fog).
- Neon: anim-neon.png is 12 frames at 6 fps (lit x10, off, dim): one short stutter every 2 s.
- Outer wall row lifted one value.
- Haunted props (8): dead-cabinet eyes, ghost, flickering neon letter, shrine webs and eyes, bats in the skylight, pumpkin, corner webs, spider.

## Hotspot changes vs the brief
- `prize` and its neon sign moved 4 px right (x 272, neon x 270) so the sign no longer overlaps the shrine's calm screen by 1 px. Prize calm plate {277,134,36,10}.
- Everything else as briefed. Calm rects measured against bone text #f2e8d5: all at 16.5:1 (screen, booth plate, door plate, ticker, three PLAY strips, phone screen).

## Extras beyond the contract
`cab-mystery-{off,on}-calm.png` and `scr-mystery-calm.png` (yellow eyes for the calm season), `el-*-calm.png`, `desk-bg-*` / `desk-fg-*` layers, `composite-desk-nolayers.png`, `composite-phone-calm.png`.

## Known weak spots (honest)
1. The centre slot cabinet hides the vanishing point and most of the aisle. Depth is carried by the side rows, the floor lines and the guide lights; it reads as "a hall" more than "a long aisle". This is the geometry the brief fixes (slot C at 185,90).
2. Dead cabinets are very dark and narrow at 1x; only the near ones read as cabinets. Far ones are texture. The outer wall row is a dark mass behind slot L and R.
3. The doorway is drawn frontal and the booth is frontal; only the rows obey strict perspective. The door's base does not follow the 1:1 row line exactly.
4. The shrine is 124 px wide so, next to three 64 px cabinets, it reads "big" through value and glow rather than true scale. Its bezel is thin because the calm screen takes 100 x 58.
5. Light is now solid: the moon shaft is a 2-value lifted parallelogram (2 px dither seam), the door spill 3 stepped bands, the fog 3 wavy bands at constant low alpha (seamless in x). Slot floor reflections, the shrine aura and haze glow still use fine dither.
6. Off-state mystery cabinets are quiet: closed-eye slits and "???" only. The eyelid effect on marquees is small at 1x.
7. The phone scene is a simplified aisle (no booth or doorway; those come from the el-* sprites). The wall x 0-40 / 155-195 in rows 180-230 holds only floor and a faint beam edge.
8. Animation strips are small (neon letter, one cabinet's eyes, ghost, shrine glints, dust). The ghost strip overlays the fg layer (layer: "fg"); the eyes, shimmer and dust overlay the bg.
9. Fonts: small labels (hallpass wordmark, MADAME, SURVIVE / TILL DAWN) use Micro5 and are only just legible at 1x.
