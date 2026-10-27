# Concept A — The Arcade Hall (builder brief)

Read CONTRACT.md first. This brief only adds what is specific to A.

**Idea.** The arcade's main hall after closing. Approachable, clear, warm-and-cool, playfully
haunted. It is the room next door to the Pack Room's prize counter, so it uses the SAME camera
(front-on, floor seen slightly from above) and the SAME materials (plum wallpaper with the faint
yellow-dot print, wood wainscot, brass, bulb marquee). What is new: a black-and-cream chequered
arcade floor whose tile rows get taller towards the viewer, a ceiling beam band, the three
competition cabinets in pools of light, and a doorway through which you can SEE the prize counter.

**Light story.** Cool violet night ambient. Three sources: the FRIGHT FEST marquee (orange bulbs,
yellow in calm), the prize-counter doorway (warm amber, the brightest warm area), the moon window
(cold yellow-white). Cabinet screens carry their own glow (sprites).

## Desktop 434 x 230 (cabinet sprite 58 x 96)

- Wall/floor seam y = 156. Floor 156–230.
- `sign` {x:142,y:4,w:150,h:38}: bulb-bordered marquee. Small "hallpass" wordmark with yellow dot,
  then FRIGHT FEST in Jersey10, orange-amber with a dark drop shadow (yellow in calm). Bulb chase
  loop = `anim-marquee.png` (3 frames, 4 fps, both seasons).
- `ticker` {x:156,y:44,w:122,h:10}: a dot-matrix LED strip under the sign, thin brass frame,
  near-black calm interior (HTML text goes there).
- `slots` (top-left of each cabinet): {118,60}, {188,60}, {258,60}; feet at y = 156. Paint a soft
  floor shadow and a dim pool at each. `pool-on.png` brightens a pool.
- Cabinet anatomy (all keys): marquee rows 0–14, screen bezel 16–54 (`cab.screen` about
  {x:8,y:18,w:42,h:32}), control panel 56–66 (stick and buttons), `cab.button` {x:5,y:68,w:48,h:15}
  a flat dark start strip, coin door / base 84–95.
- `board` {x:8,y:10,w:94,h:96}: a wall-mounted HIGH SCORES board, like an arcade high-score
  cabinet hung on the wall: header marquee with baked "HIGH SCORES" in amber pixel letters, bolts,
  maybe a small crown or trophy ornament on top. Calm screen {x:15,y:30,w:80,h:68}: near-black
  (#0b0612), scanline rows allowed only one ramp step apart.
- `quest` {x:10,y:110,w:92,h:42}: CANDY HUNT cork noticeboard on the wainscot below the board:
  wood frame, cork, a baked paper header "CANDY HUNT", three pinned blank paper slips. Calm rect
  {x:16,y:134,w:80,h:14}: a dark felt label strip.
- `prize` {x:334,y:24,w:94,h:132}: the doorway to the prize counter. Arched opening about
  {x:342,y:52,w:76,h:104} showing a warm, lit glimpse of the Pack Room: the glass counter top, a
  shelf of tiny packs, the pendant lamp (look at the Pack Room composite and quote it in miniature).
  Above it a small bulb sign "PRIZE COUNTER" with an arrow {x:334,y:26,w:94,h:22}. Warm light spills
  onto the floor as a dithered trapezoid. Calm rect {x:346,y:160,w:70,h:14}: a dark doormat.
- A tall arched night window between the board and the sign (about {x:108,y:8,w:28,h:44}) showing
  the yellow moon and the haunted school's bell-tower silhouette: the outside, from the homepage.
- `panel` {x:112,y:166,w:210,h:58}: calm, darker floor in front of the cabinets (a long dark rug works).
- Haunted props (max 8): cobweb corners, a spider dropping from the sign, a ghost peeking from
  behind the right side of slot 3 (`anim-ghost.png`, haunted), pumpkins at the foot of the board and
  by the door, candy-corn bunting along the top, a bat hanging from the beam.
- Other loops: door light flicker (2 frames, subtle, haunted), dust motes in the door light (both).
- Eggs: the ghost behind slot 3; a pumpkin by the door; the ROOM 000 plaque (plaque-000.png) small on
  the wainscot near the door.

## Cabinets (58 x 96, classic uprights; distinct silhouettes)

- `lastbell`: tall, flat-topped, institutional, a small school bell on top, locker-vent sides.
- `shadowcore`: angular with a pointed gothic top, gloss black, neon-pink edge lines.
- `std`: a peaked cabin-like roof, crimson and dark wood, thorny little branches at the top corners.
- `mystery`: the homepage cabinet's language ("???", orange eyes), night purple.

## Phone 195 x 236

- `sign` {x:22,y:4,w:150,h:30} (a smaller cut of the marquee), `ticker` {x:34,y:36,w:126,h:9}.
- One centred `slot` {x:68,y:96}; feet and seam at y = 192. The page swipes the three cabinets
  through this slot, so the background must look right with any cabinet in it.
- Glimpses: the left edge shows part of the HIGH SCORES board, the right edge the warm doorway,
  the moon window top-left.
- Rows 198–236 calm (HTML: machine name and dots).

## Elements and frames

- `el-board` (the HIGH SCORES board alone), `el-quest` (the cork board, taller for phone, about 96 x 72
  with a calm rect), `el-prize` (the doorway alone with its sign and the glimpse).
- frames: board = dark metal with bolts and a small amber corner lamp; quest = cork in a wood frame
  with pins; prize = brass-and-glass case edge; paper = cream paper with tape corners.
- tile-wall: the plum wallpaper, darkened two steps, seamless.
