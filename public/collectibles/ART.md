# Collectibles art

Everything in this folder is **demo art**. All 68 cards, 5 pack emblems and 5
collection symbols were drawn programmatically as stand-ins so the system can
ship and be tested. They are meant to be **replaced by the team** with
hand-made final art. Nothing in the code needs to change for the images
themselves; only the catalogue's `art.status` flips (see "Replacing a card").

## Spec

| Asset | Size | Path |
|---|---|---|
| Common and uncommon card (sticker) | 32 x 32 | `public/collectibles/<collection>/<id>.png` |
| Rare, epic and legendary card | 48 x 48 | `public/collectibles/<collection>/<id>.png` |
| Pack emblem | 48 x 48 | `public/collectibles/packs/<collection>.png` |
| Collection symbol | 16 x 16 | `public/collectibles/symbols/<collection>.png` |
| Pack print (front) | 96 x 140 | `public/collectibles/packs/print/<pack id>.png` |
| Pack foil mask | 96 x 140 | `public/collectibles/packs/print/<pack id>-foil.png` |
| Pack Room scene (laptop) | 434 x 230 | `public/collectibles/room/a/desk-<normal or halloween>.png` |
| Pack Room scene (phone) | 195 x 358 | `public/collectibles/room/a/phone-<normal or halloween>.png` |
| Pack Room loops | strips of equal frames | `public/collectibles/room/a/anim-*.png` |

Rules for every image:

- Transparent PNG at 1x, no anti-aliasing, no scaling blur. The site draws it at
  an integer scale with `image-rendering: pixelated`.
- At most **16 colours per collection** (shared palette, so a set looks like a set).
- A **1-px dark outline** around the subject.
- At most 2 KB per file (the test suite checks the size and the dimensions).
- **Original work only.** No copyrighted characters, logos, brand names, meme
  images, or real people. Players are mostly school pupils: keep it playful and
  school-safe.

The Internet Culture, Brainrot and Turkish Internet Culture concepts also need a
human content sign-off before their final art is published.

## Pack prints and the Pack Room

These are **final art** for the Pack Room redesign (docs/collectibles-pack-room.md),
drawn as pixel art from scratch in October 2026; the card art above is still demo
art. Their sources are the Python scripts in
`artifacts/collectibles-redesign-src/art/` (`pack_*.py`, `room_a.py`, on the
shared `pxkit.py`), with the fonts they draw lettering from in
`artifacts/collectibles-redesign-src/fonts/`. Edit a script and re-run it rather
than painting over a PNG, then copy the output here.

- **Prints** share one anatomy: the top crimp is rows 0-9, the bottom crimp the
  last 8 rows, and the tear notch is centred on row 16 (the opening's
  `TEAR.seamV`, 0.118, is the middle of that row). The silhouette is in the
  alpha channel.
- **Foil masks** are white where the print is foil (logo, moon, medal, frame).
  The opening turns them into the pack's metal and gloss (`opening/pack/art.ts`).
- **Room scenes** come in two seasons with the same layout. Where the packs, the
  stage and the boards sit is in `app/components/collectibles/room/geometry.ts`;
  move something in the art and that file moves with it.
- The Turkish Internet Culture print still needs the same content sign-off as
  its cards.

## Collections

`ff26` Fright Fest 2026 (20), `hpo` HallPass Originals (12), `inet` Internet
Culture (12), `brr` Brainrot (12), `tr` Turkish Internet Culture (12). 68 cards
in total. The definitive list (ids, names, rarities) is
`app/lib/collectibles/catalogue/collectibles.ts`; the 32 / 48 size follows the
rarity, except the `ff26-survivor` sticker, which is 48 x 48.

## Replacing a card

1. Draw the new image to the sizes above.
2. Save it over the existing file at the **same path** (for example
   `public/collectibles/hpo/hpo-hall-pass.png`).
3. In `app/lib/collectibles/catalogue/collectibles.ts`, set that card's art to
   `final` (the `art` extra on its row, for example `{ art: "final" }`).
4. Run `npx vitest run app/lib/collectibles`: it checks the file exists, its
   dimensions and its size.

Demo cards show a small "demo art" tag in the interface; final cards do not.
Emblems and symbols have no status flag: replace the file in place.
