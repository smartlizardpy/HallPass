# A. Environments: building a convincing small interior (~434x230)

Honesty note: web search returned little deep craft content. Rules marked (src) are backed by a page I fetched; rules marked (craft) are standard pixel-art practice stated from general knowledge, unverified against a source. Not reached: Lospec tutorial pages, GDC talks, Celeste/Owlboy/Hyper Light Drifter breakdowns, Stardew arcade art, Undertale/Deltarune shops.

## 1. Composition
- (craft) Use a flat, front-on "stage" view with a slight top-down floor (Stardew/Eastward interiors read this way), not true one-point perspective: cabinets drawn face-on, floor a band of ~50-60 px at the bottom, back wall ~120-130 px above. Eye level sits at the wall/floor seam, roughly 55-60% down.
- Four depth layers: (1) back wall with board/noticeboard/doorway, (2) cabinets against it, (3) floor props (carpet, stools, cables), (4) a thin dark foreground silhouette strip at the edges for framing. More than 4 turns to mush at this size.
- Detail goes at the edges and on the wall; keep a calm mid-value zone (carpet or dark panel with low-contrast pattern) behind HTML buttons and text. Lower saturation and contrast on far layers so UI and sprites pop (src: Slynyrd Pixelblog 63; Pixelblog 62 atmospheric perspective: distant planes less saturated, lighter, tinted to the ambient hue).
- Three cabinets at three distinct heights/widths; doorway and board as secondary anchors. Phone composition: stack vertically (board top, cabinets mid, doorway bottom), do not squash the landscape one.

## 2. Night lighting
- (craft; a dark-room guide in search results agrees, not fetched) Few sources: one cool ambient (deep blue-purple) plus warm accents. Max 3-4 lights: cabinet screens, marquee glow, one ceiling bulb, doorway light.
- No pure-black shadows; use dark blue/purple. Rim-light pixels only on lit edges to define silhouettes.
- Floor light pools: 2-3 stepped ellipses of lighter floor colour, edges dithered with a 2x2 checker, no blur. Screen glow = a trapezoid pool in front of each cabinet in its own colour.
- Light shafts: diagonal hard-edged bands one palette step lighter, dithered at boundaries. Keep dither to edges; overuse looks noisy (src: Divoom dithering guide, search result only).
- Colour temperature: warm amber lamps/doorway against cool teal-violet walls; Halloween orange as accent, not base.
- Moonlighter fakes light with superposed glow sprites, no dynamic lighting (src: 80.lv). Paint glows as separate palette-limited layers. Eastward uses a real lighting engine, not replicable in a static painting.

## 3. Cabinet anatomy and differentiation
- Top to bottom (src: Wikipedia): marquee (backlit, often overhangs), bezel, screen, control panel (angled, near waist height), coin door (low), plus side art.
- At ~60-70 px tall: marquee 8 px, screen 20-24 px, panel 8 px, coin door 6 px, body below. Show only a 3 px sliver of side art.
- Distinguish by silhouette first: (a) tall upright with a peaked/ghost-shaped top, (b) wider slanted "candy" sit-down shape with a rounded roof (src: Wikipedia types), (c) narrow cabaret/mini with a pumpkin or bat-wing marquee. Then one dominant hue each (orange / acid green / violet) on marquee, panel buttons and screen glow. Don't rely on label text.
- Each screen shows a small icon of its game, readable as a silhouette.

## 4. Storytelling props (playful, not scary)
- Cobwebs in corners with a tiny spider on a thread, a sheet-ghost on a stool "playing" a cabinet, one flickering marquee bulb (animated), pumpkin stools, ceiling bats, an "Out of order - boo!" sign, spilled tokens and candy, a prize-counter door ajar with glow and tiny eyes.
- Distinct detail per object beats empty horror (src: Eastward devs: "rich and subtle details", a decayed but lived-in world). No gore or jumpscares: ghosts round, smiling, pastel-cool.

## 5. Pixel scale discipline
- One pixel size across the scene: 434x230 at exactly 3x (1302x690 on 1366x768), nearest-neighbour; phone 195x360 at exactly 2x. Slynyrd mocks up 470x240 and scales 4x pixel-perfect (src: Pixelblog 63).
- No rotating or scaling sprites/glows inside the scene; no blurred gradients (CSS blur or box-shadow over art breaks the grid). HTML text in its own crisp layer; `image-rendering: pixelated`; place UI on multiples of 3px/2px.
- Outlines: 1 px, selective, dark tinted colour not black, lighter or absent on lit edges, consistent on all props.
- Palette: 32 colours shared by all three interiors (4-step ramps for wall/floor blue-violet, orange, green, purple, plus skin/white/black). Reuse across layers keeps it cohesive (src: Pixelblog 62 uses <=15 colours per scene with reuse).

## 6. Reference board
**Composition**
1. Slynyrd Pixelblog 62/63: desaturate far layers; fixed-size mockup at integer scale. Fetched: https://www.slynyrd.com/blog
2. Saint11 tutorial index (Parallax, Outlines, Resizing, IlluminationTechniques, LightMagic): titles only, GIFs not inspected; use as the artist's study list. Fetched: https://saint11.art/blog/pixel-art-tutorials/
3. Eastward (Pixpil): dense small props in a lived-in world. Fetched: https://www.gamedeveloper.com/disciplines/road-to-the-igf-pixpil-s-i-eastward-i-

**Lighting**
1. Moonlighter night scenes: glow via superposed sprites. Fetched: https://80.lv/articles/moonlighter-building-pixel-art-preparing-for-switch/
2. Eastward lighting engine (deferred shading, ambient tone for mood): search-reported only, the fetched page did not mention it; unverified.
3. Divoom dithering guide (checker for transitions, stop before noisy). Search result only: https://divoom.com/blogs/setup-ideas/pixel-art-dithering-when-to-use-and-stop

**Cabinets**
1. Wikipedia Arcade cabinet (types, marquee, bezel, side art). Fetched: https://en.wikipedia.org/wiki/Arcade_cabinet
2. Arcade Controls wiki overview (numbered part list). Search result only: https://wiki.arcadecontrols.com/index.php/Arcade_overview
3. Street Fighter / Mortal Kombat marquee art: unverified, no page fetched.

**Props / haunted**
1. Eastward (above). 2. Moonlighter's small Ghibli-inspired living details (fetched 80.lv). 3. Stardew Joja storyline as environmental storytelling: search-reported, unverified.

**Scale**
1. Slynyrd 63 (470x240 at 4x). 2. Saint11 "Resizing" (title only). 3. Lospec palette list, search result only: https://lospec.com/palette-list/tag/dithering
