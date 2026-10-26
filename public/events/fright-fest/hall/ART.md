# Fright Fest hall art (concept A, the Arcade Hall)

The pixel art behind `/fright-fest` (docs/fright-fest-hall.md). Drawn as pixel
art from scratch in October 2026, in two seasons from one script: `haunted`
(shown under the Fright Fest skin) and `calm` (the "Normal" look, and the page
after 2 Nov: the same room with every Halloween prop and all orange removed).

## Source

The source script is `artifacts/fright-fest-event-hall/art/hall_a.py` on branch
`design/fright-fest-event-hall` (it uses the shared `pxkit.py` beside it and the
fonts in that folder). Edit the script and re-run it rather than painting over a
PNG, then copy the output here. The fonts and scripts are not in this repo.
`manifest.json` and `NOTES.md` from the same run hold the geometry and the
palette counts; the geometry is mirrored in `app/fright-fest/hall/geometry.ts`
(move something in the art and move it there; the geometry test reads these
files).

## Files

| Asset | Size | Files |
|---|---|---|
| Laptop scene | 434 x 230 | `desk-haunted.png`, `desk-calm.png` |
| Phone scene | 195 x 236 | `phone-haunted.png`, `phone-calm.png` |
| Cabinet, off / on | 58 x 96 | `cab-<key>-off.png`, `cab-<key>-on.png` |
| Cabinet screen loop | 3 frames of 42 x 32 | `scr-<key>.png` |
| Mystery cabinet, calm season (yellow eyes) | | `cab-mystery-{off,on}-calm.png`, `scr-mystery-calm.png` |
| Floor light under a lit cabinet | 80 x 10 | `pool-on.png` |
| Ambient loops (strips of equal frames) | | `anim-marquee-{haunted,calm}.png` 3 x 150x38, `anim-marquee-phone-{haunted,calm}.png` 3 x 150x30, `anim-doorlight.png` 2 x 108x154, `anim-ghost.png` 4 x 14x18, `anim-dust.png` 3 x 84x96 |
| Objects | | `el-board`, `el-quest`, `el-prize` (each with a `-calm` twin) |
| Frames, 9-slice with 16 px slices | 48 x 48 | `frame-board`, `frame-quest`, `frame-prize`, `frame-paper` |
| Page background under the room | 64 x 64 | `tile-wall.png` |

Rules: transparent or opaque PNG at 1x, no anti-aliasing, drawn at a whole
number scale with `image-rendering: pixelated`. The art holds signs (names and
lettering); the page holds facts (dates, numbers, names, scores).

## Cabinets of games that are not announced yet

Only the `lastbell` and `mystery` cabinets are in this folder. The other two
games' cabinets and screen loops are in `art/out/a/` on the design branch and are
deliberately NOT shipped. This folder is served as-is, a file in `public/` can be
fetched by anyone who guesses its name, and an unannounced game must not be named
or shown (docs/championship-design.md section 6). Copy a game's cabinet files here
(`cab-<key>-{off,on}.png`, `scr-<key>.png`) in the same change that flips its
`announced` flag in `app/components/events/fright-fest/registry.ts`, and add its
art key in `app/fright-fest/hall/props.ts`.
