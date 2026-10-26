# HallPass Halloween visual language (homepage + prize counter)

Sources: fright-fest/{haunted,hero,header}.css, HauntedHero.tsx, pxkit.py `P`, room_a.py:27-52, CONTRACT.md, rooms/a manifest.

## 1. Palette
Haunted skin tokens (haunted.css:58-66): night `#1b1026`, ink `#0b0612`, line `#3a2a52`, bone `#f2e8d5`, lav `#b9a7cf`, lav-2 `#ddd3ea`, amber `#ffb347`, pumpkin `#ff7a1a`, pumpkin-dk `#d9600a`. Page dark: bg `#0d0a14`, surface `#17121f`, border `#2e2440`, text `#efe9f6`/`#cdc3dc`, muted `#a698ba`. Hero sky/wall `#150c22`, deep shadow `#05020a` (CRT "off" overlay at .8).
- Brand (permanent): purple `#7c2eef` (dk `#6920d6`, lt `#8b5cf6`), yellow `#ffc700`, moon `#ffd84a`, cream `#fff8e7`, ink `#23153a`. Accents pink `#ff4f8b`/`#ff4fd8`, cyan `#00cfd6`/teal `#2bb5c4`.
- Ramps (pxkit.py:85-93, dark to light). Night `#0b0612 #150c22 #1d1230 #2a1a45 #3a2a5e #52407a`. Purple `#1c0b3d #2d1466 #4a1fa8 #6a2ce0 #8b5cf6 #b49cff #ddd0ff`. Moon `#8a5a00 #c98d00 #f2b800 #ffd84a #ffe98a #fff7cf`. Bone `#4a3d4f #7d6c7a #b3a29e #dccfbf #f2e8d5 #fffaf0`. Pumpkin `#4a1500 #8a2e00 #d9600a #ff7a1a #ffa04d #ffd2a0`. Red `#2b0610 #5a0c1f #8f1530 #c8213f #ef4b5c #ff8f8f`.
- Room (room_a.py:27-41): wall `#170b1f #22102c #2e163a #3d1e4a #4f285c`, lamp-lit wall `#6a3654 #8a4a5e`; wood `#1f0e0b #351910 #4f2716 #6e3a1e #8f5128 #b8743a`; glass `#141a30 #1a2440 #2c3a5e #5b6d96`; brass `#7a3f00 #b86e00 #ffc700 #ffe066`; bulb-off `#7a3f00`; web `#b9a7cf`.
- Halloween-only: the pumpkin/amber orange family, bone, web, haunted-skin purples. Pumpkin `#ff7a1a` must never appear in the normal season (CONTRACT.md).
- Text contrast: bone/amber/lav on night or ink is safe (all well above 7:1). Use ink `#120a1c` on amber/accent for marquees. Never lav-2 on amber. Light theme swaps focus/hover to `#a33a07` (haunted.css:49-51).

## 2. Pixel scale
- Homepage hero: sprites authored 1x, drawn with unit `--u` = 4 (5 above 1600px, 2 on phone) (hero.css:2-5), `image-rendering:pixelated`. Cabinet 40x64 is 160x256 CSS px on desktop.
- Pack room: desk 434x230 native at 3x (1302x690); phone 195x358 at 2x. Packs 96x140 native.
- Whole-number scales only for sprites. HTML on top is never scaled.
- Outline: 1 px dark (ink) on characters, none on scenery. Light from top-left. Hue-shifted ramps (shadows lean purple/red, highlights lean yellow).
- Dithering: Bayer only (HauntedHero.tsx 4x4 ordered matrix), regular so thinning reads as design.
- Glow: dithered concentric rings (moon, lamp, bulbs), never blur. The only soft effect is the torch (CSS radial mask over a dimmed layer, hero.css `ha-torch`/`ha-reveal`). Max 3 light sources, about 32 colours per scene (+8 Halloween).
- Calm, dark areas where interactive objects stand; detail at the edges.

## 3. Typography
- Site pixel font `--font-pixel` = Silkscreen (layout.tsx:3,49). Used for: FRIGHT FEST title (700, clamp 34-52px, bone with `4px 4px 0` pumpkin hard shadow, tracking 0), countdown digits (20px amber, 2ch wide), cabinet marquees (12px caps, ink on accent), chalk notes (16px / 12px phone, `#a896c4`), step numerals (14px), CRT screens (12px), header tab (tracking .02em).
- UI font Nunito: body 15px/700 lav-2, kickers 11px/900 caps tracking .12em, chips 10px/900 caps .05em, credits 13px/700.
- Art-side fonts (baked into PNG, files in /fonts): Pixelify Sans (wordmark "hallpass", 10px 700), Jersey 10 (big signs like "PACK ROOM", ~20px), Silkscreen (small labels/plaques). Also available: Handjet, Micro5, Jersey15, Sixtyfour.
- Rule: titles, signs and plaques are baked into art (crisp, no AA). Anything the user reads or acts on (counts, dates, buttons, rules, "TO BE ANNOUNCED") is real HTML over the art in Silkscreen/Nunito, never scaled with the art.

## 4. Materials
- Wood: dark brown ramp, top-left lit, 1 px lighter top edge, panelled counter fronts, wainscot under purple plaster wall.
- Wall/brick: plum plaster with dithered orange lamp pool. Homepage is a silhouette skyline (school 160x56, trees 96x28, fence 48x12, railing 24x10).
- Glass: navy with diagonal 1 px light streaks, dithered.
- CRT: ink screen, 4 px inset frame `#2a1b40` then `#4d3a6b`, amber 12px Silkscreen, off state `rgba(5,2,10,.8)` with amber text, flicker on hover.
- Neon/bulb signs: bulb border (yellow on, `#7a3f00` off), 3-frame chase; sign face purple `#4a1fa8` with orange/yellow letters.
- Bunting: candy-corn triangles (white/amber/yellow) on a sagging line. Cobwebs: `web-corner` 16x16 in `#b9a7cf` at top corners (opacity `--ha-web` .9 dark / .75 light); hanging spider on a thread.

## 5. Motifs and reusable 1x sprites
/public/events/fright-fest/: moon 22x22 (+moon-dot 4x4, moon-dot5 5x5), ghost 12x13, ghost-wave 15x13, ghost-icon 9x9, bat-a/bat-b 16x9 (flap pair), bat-perch 12x10, pumpkin 13x12, pumpkin-sm 10x9, lantern 9x14, tomb 12x14, cabinet 40x64 ("???" marquee, orange eyes, red/orange/yellow buttons), prize-box 56x40, trophy 9x9, plaque-000 26x12 (ROOM 000), spider 9x9, web-corner 16x16, eyes-open/eyes-blink 9x3, school 160x56, trees 96x28, fence-tile 48x12, railing 24x10.
Recurring: one pixel-disc moon upper centre, HALLPASS purple-on-grey sign on the school (bell tower above), three "???" cabinets, hidden doorway ghost, prize box and trophy as rewards, candy machine and ticket machine, candy-corn bunting, "hallpass." wordmark with yellow dot, FRIGHT FEST pack (moon, bell tower). A ghost drifts through the pack room.

## 6. Interaction and motion
- All motion is stepped (`steps(n,end)`): 4-step slides .45s (sidebar/pages), 3-step rise .45s, 12-step 1.6s spider drop, bat flap .24s steps(1) during a 3s one-off flight, ghost bob .6s steps(3) x1, sign flash .9s steps(1), CRT flicker .6s steps(1) x1 on hover/focus-visible, eye blink 1.6s x1. Nothing loops forever except the flap during a flight.
- Room anim strips: 2-4 frames at 4-5 fps (marquee 3f/4, lamp 3f/5, ticket 4f/4, dust 3f/4, ghost 4f/4), at most 5 per scene.
- Hover/focus: amber `#ffb347`; focus ring 3px amber, offset 4px; 44px hit area around small sprites; pixel-stepped corners (`--ha-clip-1..4` polygons) not border-radius; hard offset shadows.
- Reduced motion and Still mode (`html[data-hp-still]`): animations none, bats hidden, spider parked, torch rests (a tap still jumps it). Gate JS with matchMedia plus the attribute (HauntedHero.tsx:63-67). globals.css:473 leaves only colour/opacity transitions.
- Stealth/panic: skin is scoped to `html[data-hp-skin="haunted"]` and removed on stealth and excluded surfaces (docs/fright-fest-theme-plan.md:26,63). Keep every rule under that scope, never assign base tokens outside haunted.css, no sound or autoplay.

## 7. Ten rules of the world
1. It is always night: ink/night base, moon `#ffd84a` is the key light, lamps orange.
2. Light from top-left; one dark 1 px outline on every character; hue-shifted ramps.
3. Whole-number pixel scales, never blurred or rotated; glow is Bayer-dithered rings.
4. Four materials plus the CRT: wood, plum plaster, navy glass, brass/bulbs.
5. Orange (pumpkin/amber) is the Halloween accent, purple `#7c2eef` the brand, yellow marks hot spots.
6. Homepage is outside (skyline, school, cabinets in the yard); prize counter is a lit shop interior. The event hall is the lobby between: same plum wall and wood floor line, dark except the cabinets, a moonlit window or door back to the yard, a doorway towards the counter.
7. Each location has a bulb-bordered sign in Jersey/Pixelify (HALLPASS, PACK ROOM); the hall gets FRIGHT FEST and a ROOM 000 plaque on a door.
8. Cobwebs in top corners, one hanging spider, candy-corn bunting, a ghost somewhere; at most 8 overlay props.
9. Mystery stays mystery ("???", "TO BE ANNOUNCED") until revealed; leave calm dark space behind cards, packs and cabinets.
10. Art holds signs, HTML holds facts; all motion stepped, Still-mode safe, and removable by dropping `data-hp-skin`.
