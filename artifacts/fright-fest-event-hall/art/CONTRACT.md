# Event hall art contract (shared by the three builders)

ART = /Users/ozan/Documents/Projects/HallPass/.claude/worktrees/fright-fest-hall/artifacts/fright-fest-event-hall/art

You draw ONE concept. You write ONLY `ART/hall_<x>.py` (x = a, b or c) and files under
`ART/out/<x>/`. Never touch anything else: not the repository's app/ or public/, not other
worktrees, not `ART/pxkit.py` (read-only copy of the Pack Room toolkit; put extra helpers in your
own script), not the other builders' files. Another agent is building the Pack Room elsewhere;
its files are reference only.

## What this is

HallPass.games is a browser arcade for school students. Its Halloween event, Fright Fest, gets an
event page designed as the INSIDE of HallPass's haunted arcade: the "Main Event Hall". It sits
between two approved designs that you must look at before drawing:

- OUTSIDE (homepage, approved): screenshot
  /private/tmp/claude-501/-Users-ozan-Documents-Projects-HallPass/1dce1b51-0904-4ee5-b505-f92dd5da0612/scratchpad/shot/home-1366.png
  A haunted school silhouette with a HALLPASS sign and bell tower, a big yellow pixel moon,
  three "???" mystery cabinets, orange FRIGHT FEST lettering.
- THE PRIZE COUNTER (Pack Room, approved, the quality bar):
  /Users/ozan/Documents/Projects/HallPass/artifacts/collectibles-redesign-src/art/out/rooms/a/composite-desk-halloween.png
  and composite-phone-halloween.png; its source room_a.py next to it shows the techniques
  (wallpaper with yellow-dot print, wood wainscot, bulb marquee, glass, pendant light cone).
- Visual-language spec: ART/../research/c-visual-language.md (read section 7, the ten rules).
- Real 1x Halloween sprites you may reuse or recolour: 
  /Users/ozan/Documents/Projects/HallPass/.claude/worktrees/fright-fest-hall/public/events/fright-fest/*.png
  (moon 22x22, ghost 12x13, ghost-wave 15x13, bat-a/bat-b 16x9, bat-perch 12x10, pumpkin 13x12,
  pumpkin-sm 10x9, web-corner 16x16, spider 9x9, lantern 9x14, plaque-000 26x12 "ROOM 000",
  cabinet 40x64 mystery cabinet, school 160x56 silhouette, trees 96x28, trophy 9x9).
- The three games' real cover art (for game identity; redraw as pixel art, never paste a
  downscaled photo): ART/ref/last-bell-cover.png, ART/ref/shadow-core-cover.png, ART/ref/std-hero.png

## The three competition games (identity is shared by all concepts)

| key | Game / event mode | Identity to draw on its cabinet |
|---|---|---|
| `lastbell` | Last Bell / The Halloween Shift | A school-corridor horror. Marquee: a dark framed board with off-white tall condensed letters LAST BELL (like the cover's sign). Body: institutional green-grey (#161614 → #6f7a68) with locker-vent side art. Screen: one-point corridor, lockers both sides, chequered floor, a small dark figure at the far end, one red light by a door. A small school bell may sit on top. Tagline "Report to Room 000". |
| `shadowcore` | Shadow Core: Halloween Dash / Cursed Dash | Black gloss with neon pink (#f43f5e, #ff4f8b) trim. Marquee: white gothic/blackletter-feel letters SHADOW CORE. Screen: a big pale moon, a black blob with two white eyes mid-jump, a row of neon-pink spikes. Clean, sharp, minimal. |
| `std` | Survive Till Dawn: Pixel Edition / Blood Moon | Crimson (#2a0a14 → #ff5470, accent #ffb347). Marquee: red pixel letters SURVIVE / TILL DAWN stacked. Screen: dark red woods, a blood-red moon, a small ranger sprite, glowing eyes between trees. |
| `mystery` | An unannounced game | The homepage's mystery cabinet language: "???" marquee, dark screen with two orange eyes (yellow in the calm season), generic night-purple body. MUST NOT hint which game it is. |

Today only Last Bell is announced. The other two show as `mystery` until their modes are verified,
so the default composite is: slot 1 lastbell, slots 2 and 3 mystery.

## Shared technical rules

- Draw at 1x with pxkit (`Canvas`, `shade`, `radial`, `glow`, `dither_mask`, `text`, `outline`,
  `blit`). Light from the top-left. 1 px dark outline (ink, not black) on characters and props,
  none on architecture. Hue-shifted ramps. Bayer dithering only. Glow = dithered rings, never blur
  or alpha soft edges. No anti-aliasing; text is 1-bit (`Canvas.text`).
- Palette: at most 40 colours per scene, plus up to 8 Halloween extras. Start from pxkit `P` and
  the ramps there, and from room_a.py's WALL / WOOD / GLASS / BRASS so the hall and the counter
  share materials. Pumpkin orange (#ff7a1a family) ONLY in the haunted season.
- Brand cues: lowercase "hallpass" wordmark with a raised yellow dot (#ffc700) somewhere on a
  sign; the yellow moon (#ffd84a ramp); brand purple #7c2eef.
- Fonts (ART/../fonts via pxkit): Jersey10 for big signs, Pixelify for the wordmark, Silkscreen /
  Micro5 / Handjet for small labels.
- Art holds SIGNS; HTML holds FACTS. Bake only names and signage (FRIGHT FEST, HIGH SCORES, game
  marquees, PRIZE COUNTER...). Never bake dates, numbers, player names, scores, counts or rules.
- Leave CALM zones exactly where HTML sits (listed per concept below): flat or very low-contrast
  dark fill, no texture that fights 12–16 px text. Calm zones must reach at least 7:1 contrast
  against bone text #f2e8d5 (dark enough: luminance of the darkest-ish ramp steps, e.g. #170b1f,
  #0b0612, #150c22, #1d1230).
- Cabinets are NOT baked into the scene: they are separate sprites placed over it, so a slot can
  be lastbell or mystery and lit or not. The scene paints only a faint floor shadow/pool at each slot.
- At most 5 animation strips per scene (`anim-<name>.png`, N equal frames side by side, 2–4
  frames, 3–8 fps, list them in the manifest with x, y, frames, fps, season). Halloween-only
  loops get `season: "haunted"`.
- Two seasons from one parameterised script:
  - `haunted`: full Halloween: cobwebs in top corners, one hanging spider, a ghost somewhere,
    pumpkins, bats, candy-corn bunting, orange light. At most 8 Halloween overlay props.
  - `calm`: the same room and identical hotspots with every Halloween prop removed, no orange
    (warm lights become yellow #ffc700 family), no ghost, no flicker loops. It is what the page
    shows when a player has switched the haunted look off, and after Halloween.

## Files you deliver in ART/out/<x>/ (exact names)

Scenes (opaque):
- `desk-haunted.png`, `desk-calm.png` — 434 x 230 (concept C: see its layers instead)
- `phone-haunted.png`, `phone-calm.png` — 195 x H (H per concept)

Cabinet sprites (transparent, same size for all four keys, size per concept):
- `cab-<key>-off.png` and `cab-<key>-on.png` for key in lastbell, shadowcore, std, mystery.
  off = marquee unlit (darker ramp), screen dim but its picture readable.
  on = marquee lit, screen bright, rim light on the body edges, a dithered glow in the screen colour.
- `scr-<key>.png` — a 3-frame loop of the screen picture at screen size (frames side by side), played
  over the screen when the cabinet is on. Subtle (a blink, a step, a flicker), not flashing.
- `pool-on.png` — the floor light pool for a lit cabinet (transparent, dithered), placed by offset.

Standalone elements for phone sections and the area below the scene (transparent):
- `el-board.png` (the high-score object), `el-quest.png` (the Candy Hunt object), `el-prize.png`
  (the prize-counter entrance). Each with its calm interior rect in the manifest.

Frames and textures for HTML sections below the scene (CSS border-image, displayed at 3x desktop / 2x phone):
- `frame-board.png`, `frame-quest.png`, `frame-prize.png`, `frame-paper.png`: 48 x 48, 9-slice with
  16 px slices. Corners carry the ornament (bolts, pins, bulbs, tape), edges tile cleanly, centre
  16x16 is a flat calm fill (state its colour in the manifest).
- `tile-wall.png`: 64 x 64 seamless, dark, low-contrast wall for the page background under the scene.

Previews for your own checking (and for the art director):
- `composite-desk-haunted.png` and `composite-desk-calm.png` at 3x with cabinets placed (slot 1
  `lastbell` ON, slots 2 and 3 `mystery` off), and `composite-desk-all.png` (haunted, all three named,
  slot 2 ON). `composite-phone-haunted.png` at 2× with lastbell ON. Draw the CALM zones as 1 px
  cyan rectangles ONLY in an extra `composite-desk-zones.png`, never in the deliverables.
- `NOTES.md`: colour counts, what each region is, known weak spots (be honest).

## manifest.json (exact shape; all numbers are 1x scene pixels, x,y = top-left)

```json
{
  "concept": "a",
  "title": "...",
  "desk": { "w": 434, "h": 230, "scale": 3,
    "files": { "haunted": "desk-haunted.png", "calm": "desk-calm.png" },
    "layers": [],
    "cab": { "w": 0, "h": 0, "screen": {"x":0,"y":0,"w":0,"h":0}, "button": {"x":0,"y":0,"w":0,"h":0} },
    "slots": [ {"x":0,"y":0}, {"x":0,"y":0}, {"x":0,"y":0} ],
    "pool": { "dx": 0, "dy": 0 },
    "zones": {
      "board":  {"x":0,"y":0,"w":0,"h":0,"calm":{"x":0,"y":0,"w":0,"h":0}},
      "quest":  {"x":0,"y":0,"w":0,"h":0,"calm":{"x":0,"y":0,"w":0,"h":0}},
      "prize":  {"x":0,"y":0,"w":0,"h":0,"calm":{"x":0,"y":0,"w":0,"h":0}},
      "sign":   {"x":0,"y":0,"w":0,"h":0},
      "ticker": {"x":0,"y":0,"w":0,"h":0},
      "panel":  {"x":0,"y":0,"w":0,"h":0}
    },
    "anims": [ {"file":"anim-x.png","x":0,"y":0,"frames":3,"fps":4,"season":"both|haunted|calm"} ],
    "eggs":  [ {"name":"ghost","x":0,"y":0,"w":0,"h":0,"note":"..."} ]
  },
  "phone": { "w": 195, "h": 0, "scale": 2, "files": {...}, "slot": {"x":0,"y":0}, "zones": {...}, "anims": [...] },
  "elements": { "board": {"file":"el-board.png","w":0,"h":0,"calm":{...}}, "quest": {...}, "prize": {...} },
  "frames": { "board": {"file":"frame-board.png","slice":16,"fill":"#hex"}, "quest": {...}, "prize": {...}, "paper": {...} },
  "tile": "tile-wall.png",
  "palette": { "colours": 0, "notes": "..." }
}
```
`cab.screen` and `cab.button` are relative to the cabinet sprite's top-left. `cab.button` is a
flat, calm strip on the cabinet's lower front where a 15-row-tall HTML PLAY button will sit.
`zones.panel` is a calm area where an HTML details panel appears. `eggs` are optional hidden
details (a ghost behind a cabinet, a pumpkin by a machine) the page can make clickable.

## Fold rule (desktop)

The scene sits under an 80 px site header. A 1366x768 Chromebook shows about 640 px of page, so
scene rows 0–186 (at 3x) are the first screen. The sign, the three cabinets with their PLAY strips,
the board and the prize entrance must all start above row 186.

## Quality bar and process

Match the Pack Room composite's finish: deliberate ramps, crisp silhouettes, believable materials,
one clear light story. Before you finish, view your own composites with the Read tool (it shows
images), list three weaknesses, fix them, and view again. Do this at least twice. Check that each
cabinet reads as its game at 1x without its label. Keep the script deterministic (fixed seeds).
