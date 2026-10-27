"""
pxkit — a small pixel-art toolkit for the HallPass collectibles redesign.

Everything is drawn at 1x into an RGBA numpy array and saved as PNG; the page
scales it up by whole numbers with `image-rendering: pixelated`.

Conventions (shared by every asset so the set looks like one family):
  * light from the top-left; 1 px dark outline on characters and props;
  * hue-shifted ramps (shadows lean violet/blue, highlights lean warm);
  * ordered (Bayer 4x4) dithering only, never alpha soft edges in the print;
  * no anti-aliasing: shapes are pixel-exact, text is rendered 1-bit.

Usage:
    import sys; sys.path.insert(0, ART); from pxkit import *
    c = Canvas(96, 140)
    c.rect(0, 0, 96, 140, '#1b1026')
    c.save(OUT + '/thing.png', preview=4)
"""

from __future__ import annotations

import math
import os
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(os.path.dirname(HERE), "fonts")

BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float32) + 0.5) / 16.0


def rgba(c) -> tuple[int, int, int, int]:
    """'#rgb' | '#rrggbb' | '#rrggbbaa' | (r,g,b[,a]) -> (r,g,b,a)."""
    if c is None:
        return (0, 0, 0, 0)
    if isinstance(c, str):
        s = c.lstrip("#")
        if len(s) == 3:
            s = "".join(ch * 2 for ch in s)
        if len(s) == 6:
            s += "ff"
        return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4, 6))  # type: ignore[return-value]
    t = tuple(int(v) for v in c)
    return t if len(t) == 4 else (t[0], t[1], t[2], 255)  # type: ignore[return-value]


def mix(a, b, t: float) -> str:
    """Blend two colours (for DESIGNING ramps, not for drawing soft edges)."""
    A, B = rgba(a), rgba(b)
    r = [round(A[i] + (B[i] - A[i]) * t) for i in range(3)]
    return "#%02x%02x%02x" % tuple(r)


def ramp(*stops: str) -> list[str]:
    return list(stops)


# ---------------------------------------------------------------- shared palette
# HallPass brand + collectibles tokens (from app/globals.css, haunted.css, collectibles.css).
P = {
    "brand": "#7c2eef",
    "brand_dk": "#6920d6",
    "brand_lt": "#8b5cf6",
    "yellow": "#ffc700",
    "moon": "#ffd84a",
    "pink": "#ff4f8b",
    "cyan": "#00cfd6",
    "cream": "#fff8e7",
    "cream2": "#f3e6c4",
    "ink": "#23153a",
    "night": "#1b1026",
    "night_ink": "#0b0612",
    "line": "#3a2a52",
    "bone": "#f2e8d5",
    "lav": "#b9a7cf",
    "amber": "#ffb347",
    "pumpkin": "#ff7a1a",
    "pumpkin_dk": "#d9600a",
}

# A few reusable hue-shifted ramps (dark -> light).
R_NIGHT = ["#0b0612", "#150c22", "#1d1230", "#2a1a45", "#3a2a5e", "#52407a"]
R_PURPLE = ["#1c0b3d", "#2d1466", "#4a1fa8", "#6a2ce0", "#8b5cf6", "#b49cff", "#ddd0ff"]
R_GOLD = ["#3d1d00", "#7a3f00", "#b86e00", "#e09a00", "#ffc700", "#ffe066", "#fff6c2"]
R_MOON = ["#8a5a00", "#c98d00", "#f2b800", "#ffd84a", "#ffe98a", "#fff7cf"]
R_SILVER = ["#1e2233", "#3b4258", "#646d88", "#959fb8", "#c7cfe0", "#eef2fb"]
R_BONE = ["#4a3d4f", "#7d6c7a", "#b3a29e", "#dccfbf", "#f2e8d5", "#fffaf0"]
R_PUMPKIN = ["#4a1500", "#8a2e00", "#d9600a", "#ff7a1a", "#ffa04d", "#ffd2a0"]
R_RED = ["#2b0610", "#5a0c1f", "#8f1530", "#c8213f", "#ef4b5c", "#ff8f8f"]
R_TEAL = ["#04212a", "#0a3d4a", "#0f6070", "#14879a", "#2bb5c4", "#8ee7ea"]


# ---------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, w: int, h: int, bg=None):
        self.a = np.zeros((h, w, 4), dtype=np.uint8)
        if bg is not None:
            self.a[:, :] = rgba(bg)

    # -- basics
    @property
    def w(self) -> int:
        return self.a.shape[1]

    @property
    def h(self) -> int:
        return self.a.shape[0]

    def copy(self) -> "Canvas":
        c = Canvas(self.w, self.h)
        c.a = self.a.copy()
        return c

    def _clip(self, x0, y0, x1, y1):
        return max(0, x0), max(0, y0), min(self.w, x1), min(self.h, y1)

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = rgba(c)
        return self

    def get(self, x, y):
        return tuple(int(v) for v in self.a[y, x])

    def rect(self, x, y, w, h, c, fill=True):
        if not fill:
            self.hline(x, x + w - 1, y, c).hline(x, x + w - 1, y + h - 1, c)
            self.vline(x, y, y + h - 1, c).vline(x + w - 1, y, y + h - 1, c)
            return self
        x0, y0, x1, y1 = self._clip(x, y, x + w, y + h)
        if x1 > x0 and y1 > y0:
            self.a[y0:y1, x0:x1] = rgba(c)
        return self

    def hline(self, x0, x1, y, c):
        if x1 < x0:
            x0, x1 = x1, x0
        return self.rect(x0, y, x1 - x0 + 1, 1, c)

    def vline(self, x, y0, y1, c):
        if y1 < y0:
            y0, y1 = y1, y0
        return self.rect(x, y0, 1, y1 - y0 + 1, c)

    def line(self, x0, y0, x1, y1, c):
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.px(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy
        return self

    # -- masks: boolean arrays the size of the canvas
    def grid(self):
        ys, xs = np.mgrid[0 : self.h, 0 : self.w]
        return xs, ys

    def ellipse_mask(self, cx, cy, rx, ry):
        xs, ys = self.grid()
        rx, ry = max(rx, 0.5), max(ry, 0.5)
        return ((xs - cx) / (rx + 0.5)) ** 2 + ((ys - cy) / (ry + 0.5)) ** 2 <= 1.0

    def poly_mask(self, pts: Sequence[tuple[float, float]]):
        im = Image.new("1", (self.w, self.h), 0)
        ImageDraw.Draw(im).polygon([(float(x), float(y)) for x, y in pts], fill=1, outline=1)
        return np.array(im, dtype=bool)

    def rect_mask(self, x, y, w, h):
        m = np.zeros((self.h, self.w), dtype=bool)
        x0, y0, x1, y1 = self._clip(x, y, x + w, y + h)
        m[y0:y1, x0:x1] = True
        return m

    def alpha_mask(self):
        return self.a[:, :, 3] > 0

    def color_mask(self, c):
        return np.all(self.a == np.array(rgba(c), dtype=np.uint8), axis=2)

    def fill_mask(self, m, c):
        self.a[m] = rgba(c)
        return self

    def ellipse(self, cx, cy, rx, ry, c, fill=True):
        m = self.ellipse_mask(cx, cy, rx, ry)
        if not fill:
            m = m & ~erode(m)
        return self.fill_mask(m, c)

    def circle(self, cx, cy, r, c, fill=True):
        return self.ellipse(cx, cy, r, r, c, fill)

    def poly(self, pts, c, fill=True):
        m = self.poly_mask(pts)
        if not fill:
            m = m & ~erode(m)
        return self.fill_mask(m, c)

    # -- dithering and shading
    def dither_mask(self, m, c, level: float, ox=0, oy=0):
        """Fill a fraction `level` (0..1) of mask m with c, ordered Bayer pattern."""
        xs, ys = self.grid()
        t = BAYER4[(ys + oy) % 4, (xs + ox) % 4]
        return self.fill_mask(m & (t < level), c)

    def dither(self, x, y, w, h, c, level: float):
        return self.dither_mask(self.rect_mask(x, y, w, h), c, level)

    def shade(self, m, field, colours: Sequence, dither=True):
        """Map a float field (same shape, 0..1) over mask m onto a ramp, with
        ordered dithering between steps. The workhorse for pixel lighting."""
        n = len(colours)
        f = np.clip(field, 0, 0.99999) * (n - 1)
        base = np.floor(f).astype(int)
        frac = f - base
        if dither:
            xs, ys = self.grid()
            up = frac > BAYER4[ys % 4, xs % 4]
            idx = np.clip(base + up, 0, n - 1)
        else:
            idx = np.clip(np.round(f).astype(int), 0, n - 1)
        cols = np.array([rgba(c) for c in colours], dtype=np.uint8)
        self.a[m] = cols[idx[m]]
        return self

    def vgrad(self, x, y, w, h, colours, dither=True, invert=False):
        m = self.rect_mask(x, y, w, h)
        xs, ys = self.grid()
        field = (ys - y) / max(1, h - 1)
        if invert:
            field = 1 - field
        return self.shade(m, field, colours, dither)

    def radial(self, m, cx, cy, r, colours, falloff=1.0, dither=True):
        """Light pool: brightest (last colour) at the centre, fading to colours[0] at r."""
        xs, ys = self.grid()
        d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / max(r, 1)
        field = np.clip(1 - d, 0, 1) ** falloff
        return self.shade(m, field, colours, dither)

    def glow(self, cx, cy, r, c, strength=0.5, rings=3, m=None):
        """A glow WITHOUT blur: concentric dithered rings of one colour."""
        if m is None:
            m = np.ones((self.h, self.w), dtype=bool)
        xs, ys = self.grid()
        d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
        for i in range(rings):
            rr = r * (1 - i / rings)
            lvl = strength * (i + 1) / rings
            ring = (d <= rr) & m
            self.dither_mask(ring, c, lvl * 0.5)
        return self

    # -- compositing
    def blit(self, src: "Canvas", x: int, y: int, mirror=False, only_mask=None):
        s = src.a[:, ::-1] if mirror else src.a
        h, w = s.shape[:2]
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.w, x + w), min(self.h, y + h)
        if x1 <= x0 or y1 <= y0:
            return self
        sub = s[y0 - y : y1 - y, x0 - x : x1 - x]
        dst = self.a[y0:y1, x0:x1]
        a = sub[:, :, 3:4].astype(np.float32) / 255.0
        if only_mask is not None:
            a = a * only_mask[y0:y1, x0:x1, None]
        out = dst.astype(np.float32) * (1 - a) + sub.astype(np.float32) * a
        out[:, :, 3] = np.maximum(dst[:, :, 3], (a[:, :, 0] * 255)).astype(np.float32)
        self.a[y0:y1, x0:x1] = np.clip(out, 0, 255).astype(np.uint8)
        return self

    def under(self, src: "Canvas", x=0, y=0):
        """Draw src beneath what is already here."""
        top = self.copy()
        self.a[:] = 0
        self.blit(src, x, y)
        self.blit(top, 0, 0)
        return self

    def outline(self, c, diagonal=False, inside=False):
        """Outline the opaque pixels (outside by default) with colour c."""
        m = self.alpha_mask()
        if inside:
            edge = m & ~erode(m, diagonal)
        else:
            edge = dilate(m, diagonal) & ~m
        return self.fill_mask(edge, c)

    def recolour(self, mapping: dict):
        for a, b in mapping.items():
            m = self.color_mask(a)
            self.a[m] = rgba(b)
        return self

    def mirror(self, axis="h"):
        self.a = self.a[:, ::-1].copy() if axis == "h" else self.a[::-1].copy()
        return self

    def crop(self, x, y, w, h) -> "Canvas":
        c = Canvas(w, h)
        c.blit(Canvas.from_array(self.a[max(0, y) : y + h, max(0, x) : x + w]), 0, 0)
        return c

    @staticmethod
    def from_array(arr) -> "Canvas":
        c = Canvas(arr.shape[1], arr.shape[0])
        c.a = arr.copy()
        return c

    @staticmethod
    def load(path) -> "Canvas":
        im = Image.open(path).convert("RGBA")
        return Canvas.from_array(np.array(im))

    def scaled(self, k: int) -> "Canvas":
        return Canvas.from_array(np.repeat(np.repeat(self.a, k, axis=0), k, axis=1))

    # -- text
    def text(self, x, y, s, c, font="Pixelify", size=10, weight=None, anchor="la", spacing=0, shadow=None, outline=None):
        """1-bit text. Returns (w, h) of the drawn string. anchor as PIL ('la','ma','ra',...)."""
        m, (w, h) = text_mask(self.w, self.h, x, y, s, font, size, weight, anchor, spacing)
        if outline:
            self.fill_mask(dilate(m, True) & ~m, outline)
        if shadow:
            col, dx, dy = shadow
            sh = np.roll(np.roll(m, dy, axis=0), dx, axis=1)
            self.fill_mask(sh & ~m, col)
        self.fill_mask(m, c)
        return w, h

    # -- output
    def image(self) -> Image.Image:
        return Image.fromarray(self.a, "RGBA")

    def save(self, path, preview: int | None = None, bg="#2b2b2b"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.image().save(path, optimize=True)
        if preview:
            im = self.image().resize((self.w * preview, self.h * preview), Image.NEAREST)
            base = Image.new("RGBA", im.size, rgba(bg))
            base.alpha_composite(im)
            base.convert("RGB").save(path.replace(".png", f".preview.png"))
        return path

    def colours(self) -> int:
        a = self.a[self.a[:, :, 3] > 0]
        return len({tuple(v) for v in a.reshape(-1, 4)})


# ---------------------------------------------------------------- morphology
def dilate(m, diagonal=False):
    o = m.copy()
    o[1:, :] |= m[:-1, :]
    o[:-1, :] |= m[1:, :]
    o[:, 1:] |= m[:, :-1]
    o[:, :-1] |= m[:, 1:]
    if diagonal:
        o[1:, 1:] |= m[:-1, :-1]
        o[:-1, :-1] |= m[1:, 1:]
        o[1:, :-1] |= m[:-1, 1:]
        o[:-1, 1:] |= m[1:, :-1]
    return o


def erode(m, diagonal=False):
    return ~dilate(~m, diagonal)


# ---------------------------------------------------------------- fonts
FONT_FILES = {
    "Silkscreen": "Silkscreen-Regular.ttf",  # Latin only, no Turkish İ Ş Ğ ı. Native 8 / 16.
    "SilkscreenBold": "Silkscreen-Bold.ttf",
    "Pixelify": "PixelifySans.ttf",  # variable wght 400-700; Turkish OK. Good at 10, 13, 16.
    "Jersey10": "Jersey10-Regular.ttf",  # condensed bold; best at 20, 30. Turkish OK.
    "Jersey15": "Jersey15-Regular.ttf",  # best at 15, 30.
    "Micro5": "Micro5-Regular.ttf",  # tiny condensed; use at 10. Turkish OK.
    "Handjet": "Handjet.ttf",  # condensed signage; 12, 16, 24. Turkish OK.
}
_font_cache: dict = {}


def get_font(name, size, weight=None):
    key = (name, size, weight)
    if key not in _font_cache:
        f = ImageFont.truetype(os.path.join(FONTS, FONT_FILES[name]), size)
        if weight is not None:
            try:
                f.set_variation_by_axes([weight])
            except Exception:
                pass
        _font_cache[key] = f
    return _font_cache[key]


def text_mask(W, H, x, y, s, font="Pixelify", size=10, weight=None, anchor="la", spacing=0):
    f = get_font(font, size, weight)
    im = Image.new("1", (W, H), 0)
    d = ImageDraw.Draw(im)
    d.fontmode = "1"
    if spacing:
        # manual letter spacing
        total = sum(d.textlength(ch, font=f) for ch in s) + spacing * (len(s) - 1)
        if anchor[0] == "m":
            x = x - total / 2
        elif anchor[0] == "r":
            x = x - total
        cx = x
        for ch in s:
            d.text((round(cx), y), ch, font=f, fill=1, anchor="l" + anchor[1])
            cx += d.textlength(ch, font=f) + spacing
        bbox = (x, y, x + total, y + size)
    else:
        d.text((x, y), s, font=f, fill=1, anchor=anchor)
        bbox = d.textbbox((x, y), s, font=f, anchor=anchor)
    return np.array(im, dtype=bool), (int(bbox[2] - bbox[0]), int(bbox[3] - bbox[1]))


def text_sprite(s, c, font="Pixelify", size=10, weight=None, spacing=0, pad=2, outline=None, shadow=None) -> Canvas:
    """Render text to its own tight canvas (handy for logos you then distort/stack)."""
    W, H = int(len(s) * size * 1.2) + 20, size * 2 + 10
    cv = Canvas(W, H)
    cv.text(pad + 2, pad + 2, s, c, font, size, weight, "la", spacing, shadow=shadow, outline=outline)
    ys, xs = np.nonzero(cv.alpha_mask())
    if len(xs) == 0:
        return Canvas(1, 1)
    return cv.crop(xs.min(), ys.min(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1)


# ---------------------------------------------------------------- pack anatomy
PACK_W, PACK_H = 96, 140
CRIMP_T = 10  # rows 0..9 top crimp (production CRIMP_TOP 0.072 * 140)
CRIMP_B = 8  # last 8 rows bottom crimp (0.058 * 140)
SEAM_Y = 16  # tear line (production TEAR.seamV 0.118 * 140 = 16.5)


def pack_silhouette(w=PACK_W, h=PACK_H, tooth=4, depth=2, notch=3):
    """Boolean mask: pinked crimp edges top and bottom, a V tear notch on each side at the seam."""
    m = np.ones((h, w), dtype=bool)
    for x in range(w):
        t = x % tooth
        d = depth - abs(t - tooth // 2) * depth // (tooth // 2) if tooth > 1 else 0
        # zig-zag: depth at tooth edges, 0 at middle
        dd = abs((x % tooth) - (tooth - 1) / 2) / ((tooth - 1) / 2)
        cut = int(round(dd * depth))
        m[:cut, x] = False
        m[h - cut :, x] = False
    for i in range(notch):
        for dy in range(-(notch - 1 - i), notch - i):
            y = SEAM_Y + dy
            if 0 <= y < h:
                m[y, i] = False
                m[y, w - 1 - i] = False
    return m


def crimp(c: Canvas, ramp_: Sequence[str], pattern="ridge", top=True, accent=None):
    """Heat-sealed crimp band with vertical ridges (pattern varies per collection)."""
    y0, hh = (0, CRIMP_T) if top else (c.h - CRIMP_B, CRIMP_B)
    xs, ys = c.grid()
    band = c.rect_mask(0, y0, c.w, hh)
    if pattern == "ridge":
        field = 0.35 + 0.45 * ((xs % 3) == 0) + 0.15 * ((xs % 3) == 1)
    elif pattern == "chevron":
        field = 0.3 + 0.55 * (((xs + (ys - y0)) % 4) < 2)
    elif pattern == "dots":
        field = 0.35 + 0.5 * (((xs % 4) == 1) & (((ys - y0) % 3) == 1))
    elif pattern == "zigzag":
        field = 0.3 + 0.55 * (((xs + abs(((ys - y0) % 4) - 2)) % 4) < 2)
    elif pattern == "checker":
        field = 0.3 + 0.55 * ((((xs // 2) + ((ys - y0) // 2)) % 2) == 0)
    else:
        field = np.full(xs.shape, 0.5)
    # a lit lip along the sealed edge and a shadow where the band meets the pouch
    edge = (ys == (y0 + hh - 1)) if top else (ys == y0)
    field = np.where(edge, 0.05, field)
    lip = (ys == y0 + hh - 2) if top else (ys == y0 + 1)
    field = np.where(lip, np.minimum(field + 0.25, 0.98), field)
    c.shade(band, field, ramp_, dither=False)
    if accent:
        y = y0 + hh // 2 if top else y0 + hh // 2
        c.hline(0, c.w - 1, y, accent)
    return c


def maker_mark(c: Canvas, x=5, y=19, ink="#fff8e7", dot="#ffc700", shadow="#0b0612"):
    """The HallPass maker's mark: lowercase 'hallpass' + raised yellow dot, same place on every pack."""
    w, _ = c.text(x, y, "hallpass", ink, "Pixelify", 10, 700, "lt", shadow=(shadow, 1, 1) if shadow else None)
    dx = x + w + 1
    c.rect(dx, y + 3, 2, 2, dot)
    if shadow:
        c.px(dx + 2, y + 5, shadow).px(dx + 1, y + 5, shadow).px(dx + 2, y + 4, shadow)
    return c


def tear_arrow(c: Canvas, x=None, y=12, ink="#fff8e7"):
    """A tiny 'tear here' cue printed on the strip, right side."""
    x = c.w - 18 if x is None else x
    c.text(x, y, "TEAR", ink, "Micro5", 10, None, "lt")
    ax = x + 13
    for i in range(3):
        c.vline(ax + i, y + 2 + i, y + 6 - i, ink)
    return c


def finalize_pack(print_: Canvas, foil: Canvas | None = None):
    """Cut the silhouette out of the print (and the foil mask)."""
    m = pack_silhouette(print_.w, print_.h)
    print_.a[~m] = 0
    if foil is not None:
        foil.a[~m] = 0
    return print_, foil


def save_pack(name, print_: Canvas, foil: Canvas | None, outdir):
    print_.save(os.path.join(outdir, f"{name}.png"), preview=4)
    if foil is not None:
        foil.save(os.path.join(outdir, f"{name}-foil.png"))


# ---------------------------------------------------------------- previews
def contact(paths: Iterable[str], out: str, scale=3, gap=12, bg="#1a1622"):
    ims = [Image.open(p).convert("RGBA") for p in paths]
    ims = [im.resize((im.width * scale, im.height * scale), Image.NEAREST) for im in ims]
    W = sum(i.width for i in ims) + gap * (len(ims) + 1)
    H = max(i.height for i in ims) + gap * 2
    sheet = Image.new("RGBA", (W, H), rgba(bg))
    x = gap
    for im in ims:
        sheet.alpha_composite(im, (x, gap))
        x += im.width + gap
    sheet.convert("RGB").save(out)
    return out


# ---------------------------------------------------------------- the shared pack BACK
RARITY_COL = {"C": "#9aa3b5", "U": "#3fbf7f", "R": "#4f8dff", "E": "#b06bff", "L": "#ffc700"}


def pack_back(
    *,
    field: Sequence[str],  # 3-5 colour ramp for the background (dark -> light)
    crimp_ramp: Sequence[str],
    crimp_pattern: str,
    ink: str,  # text on the field
    panel: str,  # info panel fill (usually cream)
    panel_ink: str,
    accent: str,  # headings / rules
    title: str,  # collection name, e.g. "FRIGHT FEST 2026"
    set_size: int,
    slots: Sequence[str],  # e.g. ["C60 U25 R10 E4 L1"] * 3, or ["SURVIVOR 2026", "C60 U25 R10 E4 L1", ...]
    code: str,  # e.g. "HP-FF26-S1"
    motif=None,  # optional fn(c) drawing a faint repeating motif on the field
) -> Canvas:
    """One back for the whole family: printed foil field, a centre fin seal, an INSIDE
    panel with the real per-slot odds, a set checklist, and the free-and-earned line."""
    W, H = PACK_W, PACK_H
    c = Canvas(W, H)
    xs, ys = c.grid()
    c.shade(np.ones((H, W), bool), 0.25 + 0.5 * (ys / H), field)
    if motif:
        motif(c)
    # title band
    c.rect(0, 19, W, 11, crimp_ramp[1])
    c.hline(0, W - 1, 19, crimp_ramp[3])
    c.hline(0, W - 1, 29, crimp_ramp[0])
    c.text(W // 2, 21, title, ink, "Micro5", 10, None, "mt")
    # info panel (cream card stock), with a 1px ink edge and a hard shadow
    px0, py0, pw, ph = 6, 34, W - 12, 72
    c.rect(px0 + 1, py0 + 1, pw, ph, crimp_ramp[0])
    c.rect(px0, py0, pw, ph, panel)
    c.rect(px0, py0, pw, ph, panel_ink, fill=False)
    c.text(px0 + 4, py0 + 3, "INSIDE: 3 CARDS", panel_ink, "Micro5", 10, None, "lt")
    c.text(px0 + pw - 4, py0 + 3, "% ODDS", accent, "Micro5", 10, None, "rt")
    c.hline(px0 + 3, px0 + pw - 4, py0 + 11, accent)
    y = py0 + 14
    for i, s in enumerate(slots):
        c.text(px0 + 4, y, f"{i + 1}", accent, "Micro5", 10, None, "lt")
        # rarity tokens get their colour chip
        x = px0 + 10
        for tok in s.split(" "):
            if len(tok) >= 2 and tok[0] in RARITY_COL and tok[1:].isdigit():
                c.rect(x, y + 1, 3, 4, RARITY_COL[tok[0]])
                c.rect(x, y + 1, 3, 4, panel_ink, fill=False) if False else None
                w, _ = c.text(x + 4, y, tok[1:], panel_ink, "Micro5", 10, None, "lt")
                x += 4 + w + 2
            else:
                w, _ = c.text(x, y, tok, panel_ink, "Micro5", 10, None, "lt")
                x += w + 3
        y += 9
    # checklist: one tiny slot per card in the set
    cols = 10
    cy0 = py0 + ph - 6 - ((set_size + cols - 1) // cols) * 7
    c.text(px0 + 4, cy0 - 9, f"SET: {set_size} TO COLLECT", panel_ink, "Micro5", 10, None, "lt")
    for i in range(set_size):
        gx = px0 + 4 + (i % cols) * 8
        gy = cy0 + (i // cols) * 7
        c.rect(gx, gy, 6, 6, panel_ink, fill=False)
        c.px(gx + 2, gy + 2, accent).px(gx + 3, gy + 3, accent)
    # free-and-earned line
    c.text(W // 2, 110, "FREE. EARNED BY PLAYING.", ink, "Micro5", 10, None, "mt")
    c.text(W // 2, 117, "NEVER SOLD.", ink, "Micro5", 10, None, "mt")
    # code + the yellow dot
    c.text(5, 123, code, ink, "Micro5", 10, None, "lt")
    c.rect(W - 9, 124, 3, 3, "#ffc700")
    c.px(W - 9, 124, crimp_ramp[0])
    # centre fin seal (heat-sealed strip running crimp to crimp), drawn over the field only
    fin = c.rect_mask(45, CRIMP_T, 6, 19 - CRIMP_T) | c.rect_mask(45, 30, 6, py0 - 30) | c.rect_mask(45, py0 + ph + 1, 6, 109 - (py0 + ph + 1))
    c.shade(fin, 0.3 + 0.4 * ((xs - 45) % 3 == 0) + 0.2 * (xs == 45), crimp_ramp, dither=False)
    crimp(c, crimp_ramp, crimp_pattern, top=True)
    crimp(c, crimp_ramp, crimp_pattern, top=False)
    m = pack_silhouette(W, H)
    c.a[~m] = 0
    return c
