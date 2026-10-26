# Concept C — The Possessed Arcade (builder brief)

Read CONTRACT.md first. This brief only adds what is specific to C.

**Idea.** The most atmospheric direction: the arcade is possessed. One-point perspective down a
long arcade aisle, vanishing point (217, 96). Rows of dead cabinets recede into fog on both sides;
their small screens are dark, some with eyes. At the end of the aisle stands the HI-SCORE SHRINE:
a huge CRT fused from cabinet parts, with cables spreading from it over the walls and floor like
roots. A broken skylight drops a shaft of yellow moonlight down the aisle. The three competition
cabinets stand in an arc in front, possessed. One warm doorway glows between the dead machines:
the prize counter. Still a usable web page: the hotspots are big and clear.

**Light story.** Near-black violet base, deepest of the three concepts. Key light: the moon shaft
(cold yellow). The shrine glows faintly. Each competition cabinet throws its own coloured light on
the reflective floor. The doorway is the only warm light. Fog at floor level.

## Layers (all 434 x 230)

- `desk-bg-haunted.png`, `desk-bg-calm.png` (opaque): walls, aisle, dead cabinets, shrine, floor,
  skylight, doorway.
- `desk-fg-haunted.png`, `desk-fg-calm.png` (transparent): dark foreground silhouettes at the
  edges: a cabinet side cutting in at left x 0–26 and right x 408–434, hanging cables and a broken
  neon tube along the top, cables on the floor in rows 214–230. Haunted adds a ghost peeking from
  behind the right foreground.
- `fog.png`: 434 x 40, transparent dithered fog, horizontally seamless; laid at y 150, drifted by CSS.
- Also `desk-haunted.png` and `desk-calm.png`: bg + fg flattened (previews and the no-JS fallback).
- Manifest: `desk.files` = the bg files; `desk.layers` =
  [{"name":"fg","haunted":"desk-fg-haunted.png","calm":"desk-fg-calm.png","depth":1},
   {"name":"fog","file":"fog.png","y":150,"depth":0.5}], plus `"bgDepth": -0.5`.

## Desktop placements (cabinet sprite 64 x 104)

- `sign` {x:16,y:4,w:118,h:30}: a crooked hanging neon FRIGHT FEST (in the fg layer) on chains,
  pink-orange neon tubes (steady yellow-white in calm), small "hallpass" wordmark with the yellow dot.
  One letter flickers: `anim-neon.png`, haunted only.
- `ticker` {x:24,y:36,w:102,h:9}: a small dot-matrix strip under the sign, calm dark interior.
- `board` = the shrine {x:155,y:8,w:124,h:82}; calm screen {x:167,y:20,w:100,h:58}, near-black with
  the faintest scanlines. A cracked marquee with baked "HI-SCORE" above or on the frame. Eyes or a
  faint moon-face may live in the frame, never over the calm screen.
- `slots`: L {40,96} (feet 200), C {185,90} (feet 194), R {330,96} (feet 200).
  `cab.button` {x:8,y:72,w:48,h:15}. Each slot gets a dim coloured floor reflection in the scene;
  `pool-on.png` adds the lit one.
- `quest` {x:118,y:84,w:46,h:88}: a fortune-teller booth, "MADAME MOON": a glass booth with a
  ghostly fortune teller and a crystal ball that is a tiny yellow moon; a card slot. Calm rect
  {x:122,y:154,w:38,h:12}: a dark plate on the booth base.
- `prize` {x:268,y:62,w:46,h:84}: the warm doorway, a small neon PRIZES sign above it
  {x:266,y:50,w:50,h:12}, warm light spilling down the aisle; through it, a tiny warm glimpse of
  shelves with packs (the Pack Room).
- `panel` {x:120,y:182,w:194,h:42}: keep reasonably calm (the page mostly uses a zoom + overlay).
- Haunted props (max 8): eyes in dead cabinet screens, the ghost (fg), the flickering neon letter,
  cobwebs on the shrine, bats in the skylight, a pumpkin on top of a dead cabinet.
  Calm: dark screens, no ghost/bats/cobwebs/pumpkin, steady neon.
- Loops (max 5): neon flicker (haunted), dead-cabinet eye blink (haunted), ghost peek (haunted),
  shrine edge shimmer outside the calm rect (both, subtle), dust in the moon shaft (both).
- Eggs: the ghost; a dead cabinet whose screen briefly shows the yellow moon; the ROOM 000 plaque
  on a dead cabinet.

## Cabinets (64 x 104, possessed; distinct silhouettes per game)

Anatomy: marquee 0–16 (eyelid shapes: closed when off, open when on), screen 18–60, panel 62–70,
button strip 72–87, base 88–103 with cables like roots. Slightly warped, leaning silhouettes.
Identity per the contract table. `mystery`: "???" with closed eyes (off) and glowing orange eyes (on).

## Phone 195 x 300

- Portrait aisle, vanishing point near the top centre. Shrine `board` {x:43,y:10,w:110,h:72}, calm
  screen {x:53,y:20,w:90,h:50}.
- One centred `slot` {x:65,y:150} (64 x 104), feet at y = 254.
- Keep x 0–40 and x 155–195 in rows 180–230 low in detail: HTML ◀ ▶ buttons go there.
- Fog; rows 258–300 calm.

## Elements and frames

- `el-board` (the shrine alone), `el-quest` (the fortune booth alone), `el-prize` (the doorway with its neon).
- frames: board = a cracked CRT bezel with cables at the corners; quest = a fortune card with a gold
  border and a moon in each corner; prize = a neon tube frame; paper = old arcade ticket card stock.
- tile-wall: near-black violet panelling with faint cables, seamless.
