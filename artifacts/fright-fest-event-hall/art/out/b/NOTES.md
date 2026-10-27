# Concept B: The School Hall

Built by `art/hall_b.py` (deterministic, python3 from art/). Manifest: `manifest.json`.

## Colour counts (scene PNGs, after a palette snap)
desk-haunted 48, desk-calm 40, phone-haunted 48, phone-calm 40. Cabinets are separate sprites and not counted.
Sprites from public/events/fright-fest (moon, ghost, bats, web, spider, pumpkin, plaque) are used with their own colours and then merged by the snap, so a few have slightly flattened shading.

## Regions
Clerestory band (8 panes: moon, bell-tower silhouette, stars, 3:15 clock), proscenium with plum velvet, valance, lighting bar with three lamps, hand-made FRIGHT FEST card banner with the hallpass tag (yellow dot), stage front with footlights and three calm ticket strips, HALL SCORES scoreboard, wall bars with bench, caretaker's bucket with key ring and mop, fire extinguisher, CANDY HUNT felt noticeboard, TUCK SHOP hatch with ROOM 000 plaque and arrow, A-frame chalkboard, parquet with court lines, moon patches, stacked chairs.
Calm fills (flat, all well above 7:1 against bone): #07070c (scoreboard), #17122a (quest strip), #0f1c1a (chalkboard), #150e20 (tickets, ticker, panel).
frame-paper is a DARK exercise-book paper (#1b1830), so bone text works.

## Extras beyond the contract
spot-on.png (64x94, dx -8, dy -6), spot-phone.png, cab-mystery-on-calm.png + scr-mystery-calm.png (yellow eyes for the calm season), anim-bats-phone.png, anim-ghost-phone.png. Mystery screen strips are crops of the sheet, so the eyes sit on the sheet exactly.

## Hotspots
All brief rects kept unchanged. Tuck-shop hatch is narrower than the brief implied (54 px) to make room for the plaque beside it. Chalkboard sits below the prize rect at {350,166,56,12}.

## Known weak spots
- Mystery cabinets read as sheeted ghosts rather than machines; fine for mystery, but the sheet fold shading is a little noisy when ON.
- 3x5 bitmap marquee letters are small: SURVIVE / TILL DAWN is tight, SHADOW CORE is readable mainly by colour.
- Floor moonlight is now four clean parallelogram shafts (lifted board colour plus a brighter core, 1 px ordered-dither edge) following the windows above; court lines are one step brighter but pass under the shafts (hidden there). The two outer shafts are partly cut by the screen edge.
- The panel mat and stage front are large dark flat areas (by design, for HTML), so the lower third feels empty without the HTML on it.
- The spotlight cone is subtle at 1x; the lit cabinet is distinguished mostly by its own glow.
- Right and left chair stacks are only sketched; the upper wall between board and windows is plain.
- The backdrop behind the cabinets is almost invisible (cabinets cover it).
- Bat and ghost loops are cut from re-rendered scenes (opaque tiles); layer cabinets above them. The ghost tile starts at x=294 so it does not cover cabinet 3.
