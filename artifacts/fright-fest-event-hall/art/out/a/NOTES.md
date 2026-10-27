# Concept A, The Arcade Hall: notes

Source: `art/hall_a.py` (deterministic, run from `art/`). Numbers are 1x scene pixels.

## Colour counts
| scene | colours | budget |
|---|---|---|
| desk-haunted | 40 | 40 + 8 extras (extras used: 5 pumpkin/ember steps, bone, cobweb lavender, pumpkin-stem green) |
| desk-calm | 33 | 40 (no orange anywhere) |
| phone-haunted / phone-calm | 38 / 31 | same |
| cabinets (lit) | lastbell 28, shadowcore 24, std 27, mystery 18 | own palettes, per sprite |

## Regions
Wall + wainscot + brass + bulb marquee are the Pack Room's ramps (copied from room_a.py). Floor is a true
projected black-and-cream chequer (rows grow toward the viewer), night-dimmed, lit by dithered pools
under each slot and a warm trapezoid spilling from the prize door. Doorway holds a miniature Pack Room
(shelves of tiny packs, pendant lamp, glass counter, featured pack on a riser). Moon window shows the
yellow moon and the bell-tower school silhouette. Light: cool violet ambient, orange sign glow, amber door.

## Hotspots
All brief coordinates kept; nothing shifted. Only change: the ROOM 000 egg plate is {317,127,18,10}.
Calm zones (all flat, 15.6:1 against bone #f2e8d5): board screen (two near-black steps, scanline every 4th row),
quest felt, doormat, panel rug, cabinet PLAY strips (flat #0b0612). The ticker zone includes its 1 px brass
frame; the interior ({157,45,120,8}) is near-black with a dot grid one step above.

## Extras beyond the contract
- `cab-mystery-off-calm.png`, `cab-mystery-on-calm.png`, `scr-mystery-calm.png`: yellow eyes for the calm
  season (orange is haunted-only).
- `el-board-calm.png`, `el-quest-calm.png`, `el-prize-calm.png`: yellow-lamp variants of the elements.
- `el-prize.png` is 94 x 150 (door 132 + a threshold strip carrying the doormat calm rect).
- `anim-doorlight.png` (haunted, 2 frames, opaque, 108 x 154 at 326,52) and `anim-ghost.png` (opaque,
  sits BEHIND the slot-3 cabinet sprite, x 311, y 86).

## Known weak spots (honest)
1. Floor is now a navy-plum arcade carpet (star / moon / teal and mustard dots on an offset grid, rows spreading toward the viewer), built only from existing wall/glass/wood ramps. Motifs are deliberately faint (1-2 steps); pools are dithered lifts and read mostly under lit cabinets.
2. Lastbell reads by silhouette + colour, but its ON state differs from OFF mostly by marquee, screen and
   rim; the corridor screen is deliberately dark so the figure and red light carry it. Shadow Core and
   Survive Till Dawn are clearer than Last Bell at 1x.
3. Survive Till Dawn's two-line roof marquee is 5 px Micro5 on a dark plank; legible at 3x, tight at 1x.
4. The HIGH SCORES board and prize door are large and empty by design (calm zones); the wall around them
   is quiet. The doormat and the long panel rug read as plain dark slabs.
5. Door spill: the same carpet lifted and warmed (plum-brown haunted, gold-brown calm), 2 bands with a 1-2 px ordered seam; motifs show through. Calm reads more brown than gold. Doormat flat on top.
6. Phone: floor is only 6 rows (192-197) before the calm rug; pools are mostly lost. The board and door
   are glimpses only.
7. `frame-*` 9-slices were checked by simulation only; inner corners of board/quest have a 1 px notch.
8. Not checked in a browser: the cabinet-over-scene alignment relies on the manifest numbers.
