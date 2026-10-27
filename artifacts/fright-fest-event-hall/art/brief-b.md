# Concept B — The School Hall (builder brief)

Read CONTRACT.md first. This brief only adds what is specific to B.

**Idea.** The arcade has moved into the old assembly hall of the haunted school seen on the
homepage (and in Last Bell). Front-on. Moonlit, eerie, nostalgic: a school hall at night. Cooler
and bluer than the Pack Room; warm only at the stage lights and the tuck-shop hatch. It must still
belong to HallPass: plum-purple velvet curtains (brand purple family), the yellow moon, the
"hallpass" wordmark with its yellow dot painted on the banner.

**Materials.** Night-tinted institutional walls (cream-and-green paint pushed toward blue-violet),
painted brick below a dado; a band of clerestory windows; a wooden stage with plum velvet curtains
and a valance; varnished parquet floor with painted court lines (dull red and yellow); gym wall
bars; stacked plastic chairs; a red-felt cork noticeboard; a serving hatch with a roller shutter.

**Light story.** Cold moonlight through the windows (blue-violet shafts on the floor), three warm
stage lamps on a lighting bar inside the arch, footlights, and the warm tuck-shop hatch. The
selected cabinet gets a spotlight cone (sprite).

## Desktop 434 x 230 (cabinet sprite 48 x 84)

- Windows band y 4–32 across the back wall: 5–7 tall panes with frames; the yellow moon in one
  pane; the school's bell tower silhouette (from school.png) through another; stars.
- School clock {x:209,y:6,w:16,h:16} between panes, hands at 3:15 (the last bell).
- Proscenium arch outer {x:114,y:34,w:206,h:120}. Inside the top, a hand-made school banner `sign`
  {x:136,y:38,w:162,h:18} reading FRIGHT FEST: paper letters pegged on a string, or painted on a
  sheet; handmade and slightly uneven; a small "hallpass" with the yellow dot painted in a corner.
  Plum velvet curtains on both sides plus a valance; a lighting bar with three stage lamps.
- Stage deck top at y = 146. `slots` {140,62}, {193,62}, {246,62}; feet at y = 146.
- Stage front face y 146–170: dark painted wood with footlights on the lip. Per-slot calm strips
  for HTML ticket buttons: `zones.tickets` = [{x:140,y:152,w:48,h:15}, {x:193,y:152,w:48,h:15},
  {x:246,y:152,w:48,h:15}]. Set `cab.button` to all zeros.
- `ticker` {x:150,y:172,w:134,h:9}: a thin dark strip on the floor edge right below the stage, or a
  painted plaque; HTML text goes there.
- `spot-on.png`: transparent dithered light cone from the lighting bar down onto one cabinet
  (about 64 x 110), with `spot: {dx,dy}` relative to the slot in the manifest.
- `board` {x:10,y:38,w:96,h:72}: an old electronic gym scoreboard high on the left wall: a black
  box, amber bulbs, baked "HALL SCORES" header. Calm interior {x:16,y:54,w:84,h:50}, near-black.
- Under it: wall bars {x:14,y:114,w:56,h:58}, a bench, and the caretaker's mop bucket with a key ring
  near {x:76,y:150} (a Last Bell nod; an egg).
- `quest` {x:328,y:38,w:96,h:66}: school noticeboard on the right wall: red-felt border, cork, a
  baked paper header "CANDY HUNT", a few blank paper notices with drawing pins and one gold merit
  star. Calm rect {x:336,y:86,w:80,h:12}: a paper strip.
- `prize` {x:332,y:108,w:92,h:56}: the TUCK SHOP serving hatch: roller shutter half up, warm light
  and tiny pack shapes inside, hand-painted "TUCK SHOP" sign above. Calm rect: a small chalkboard
  A-frame in front, about {x:350,y:166,w:56,h:12}. Nearby, a small ROOM 000 plaque with an arrow.
- Floor y 170–230: parquet with court lines in slight perspective, stacked chairs at the far left and
  right foreground.
- `panel` {x:120,y:184,w:194,h:44}: calm (a long dark rubber mat or a darker floor band).
- Haunted props (max 8): cobwebs on the proscenium corners, bats outside the windows (anim), a
  ghost peeking out between the right curtains (anim), a paper-bat garland on the banner, pumpkins
  on the stage lip, a spider on the clock.
- Loops: ghost between the curtains (haunted), bats past a window (haunted), footlight flicker
  (2 frames, subtle, haunted), dust in a moon shaft (both).

## Cabinets (48 x 84, school-surplus 70s/80s cabinets with wood-grain sides and masking-tape labels)

Anatomy: marquee 0–12, screen 14–46, panel 48–58, base 60–83.
- `lastbell`: green-grey, a small bell on top, a taped label "PROPERTY OF ROOM 000".
- `shadowcore`: black with pink tape trim, pointed top.
- `std`: crimson with dark wood, a tiny tree silhouette on top.
- `mystery`: under a dust sheet with a paper "???" tag pinned on it (off); the `on` state shows the
  sheet glowing from within with two orange eyes showing through. Never hints at a game.

## Phone 195 x 252

- The proscenium fills the width; windows band y 0–14 above it; banner `sign` {x:16,y:18,w:163,h:18}.
- Stage deck at y = 196; one centred `slot` {x:73,y:112}; the spotlight on it; stage front 196–214.
- Rows 218–252 calm (HTML: three paper hall-pass tabs that switch the cabinet).

## Elements and frames

- `el-board` (the gym scoreboard alone), `el-quest` (the noticeboard, taller for phone, about 96 x 80),
  `el-prize` (the tuck-shop hatch with its sign).
- frames: board = black scoreboard metal with amber bulbs at the corners; quest = red felt and cork
  with drawing pins; prize = painted hatch wood with a shutter edge; paper = lined exercise-book
  paper with a red margin and tape.
- tile-wall: night-tinted painted brick, seamless.
