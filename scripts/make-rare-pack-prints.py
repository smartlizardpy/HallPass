#!/usr/bin/env python3
"""Make the four Rare pack prints from the shipped standard prints.

The Rare packs (hpo-rare, inet-rare, brr-rare, tr-rare; docs/candy-hunt.md) are
bought with Halloween Candy and share their collection's pack art. Each print is
its standard print with two additions, so a Rare pack reads as a Rare pack in the
Pack Room and in the opening, and the silhouette (alpha) is untouched:

  * a gold "RARE" plate over the badge slot (x 68-91, y 18-31), and
  * a thin gold foil frame inside the crimps.

The foil mask is the standard mask plus the plate and the frame, so the opening
turns both into metal. Only reads the two standard PNGs and writes the two Rare
PNGs; needs Pillow. Re-run it, do not paint over the output:

    python3 scripts/make-rare-pack-prints.py

These are PLACEHOLDERS in the sense ART.md uses for demo art: a hand-drawn Rare
print may replace either file at the same path (96 x 140, silhouette in alpha).
"""

import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "collectibles", "packs", "print")
COLLECTIONS = ["hpo", "inet", "brr", "tr"]

INK = (18, 8, 38, 255)
GOLD = (255, 199, 0, 255)
GOLD_HI = (255, 243, 176, 255)
GOLD_LO = (176, 120, 0, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

# 3 x 5 glyphs, '#' is ink.
GLYPHS = {
    "R": ["##.", "#.#", "##.", "#.#", "#.#"],
    "A": [".#.", "#.#", "###", "#.#", "#.#"],
    "E": ["###", "#..", "##.", "#..", "###"],
}

PLATE = (68, 18, 24, 14)  # x, y, w, h
CRIMP_TOP = 10
CRIMP_BOTTOM = 8


def put(img, x, y, colour, sil):
    """Paint only inside the silhouette `sil`, so the pack's outline never changes."""
    if 0 <= x < img.width and 0 <= y < img.height and sil.getpixel((x, y))[3] > 0:
        img.putpixel((x, y), colour)


def plate_pixels():
    """(x, y, role) for the plate: 'edge', 'face' or 'text'."""
    x0, y0, w, h = PLATE
    out = []
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            edge = x in (x0, x0 + w - 1) or y in (y0, y0 + h - 1)
            out.append((x, y, "edge" if edge else "face"))
    word = "RARE"
    text_w = len(word) * 3 + (len(word) - 1)
    tx = x0 + (w - text_w) // 2
    ty = y0 + 3
    for i, ch in enumerate(word):
        for gy, row in enumerate(GLYPHS[ch]):
            for gx, c in enumerate(row):
                if c == "#":
                    out.append((tx + i * 4 + gx, ty + gy, "text"))
    # a three-pixel sparkle row under the word
    sy = ty + 7
    for dx in (-4, 0, 4):
        cx = x0 + w // 2 + dx
        out.append((cx, sy, "text"))
        out.append((cx - 1, sy, "text"))
    return out


def frame_pixels(h):
    """A one-pixel frame inside the crimps, with a lighter pixel every fourth step."""
    left, right = 2, 93
    top, bottom = CRIMP_TOP + 8, h - CRIMP_BOTTOM - 3
    out = []
    for x in range(left, right + 1):
        out.append((x, top))
        out.append((x, bottom))
    for y in range(top, bottom + 1):
        out.append((left, y))
        out.append((right, y))
    return out


def build(col):
    src = os.path.join(ROOT, f"{col}-standard.png")
    src_foil = os.path.join(ROOT, f"{col}-standard-foil.png")
    print_img = Image.open(src).convert("RGBA")
    foil = Image.open(src_foil).convert("RGBA")
    assert print_img.size == foil.size == (96, 140), (col, print_img.size, foil.size)

    sil = print_img.copy()  # the silhouette, before any drawing
    for x, y in frame_pixels(print_img.height):
        put(print_img, x, y, GOLD_HI if (x + y) % 8 == 0 else GOLD, sil)
        put(foil, x, y, WHITE, sil)
    for x, y, role in plate_pixels():
        colour = {"edge": GOLD, "face": INK, "text": GOLD_HI}[role]
        put(print_img, x, y, colour, sil)
        # the plate face is ink, not metal: clear any foil the standard badge had there
        put(foil, x, y, WHITE if role != "face" else CLEAR, sil)
    # a shadow row under the plate keeps it lifted off busy art
    x0, y0, w, h = PLATE
    for x in range(x0 + 1, x0 + w):
        put(print_img, x, y0 + h, GOLD_LO, sil)
        put(foil, x, y0 + h, CLEAR, sil)

    print_img.save(os.path.join(ROOT, f"{col}-rare.png"), optimize=True)
    foil.save(os.path.join(ROOT, f"{col}-rare-foil.png"), optimize=True)
    print(f"wrote {col}-rare.png and {col}-rare-foil.png")


if __name__ == "__main__":
    for c in COLLECTIONS:
        build(c)
    sys.exit(0)
