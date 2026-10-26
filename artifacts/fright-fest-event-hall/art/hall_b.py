"""Concept B - The School Hall (Fright Fest event page, builder B).

The arcade has moved into the haunted school's assembly hall: clerestory windows with the moon,
a stage with plum velvet curtains and a hand-made banner, three school-surplus cabinets under a
lighting bar, a gym scoreboard (HALL SCORES), wall bars, a red-felt noticeboard (CANDY HUNT) and a
tuck-shop serving hatch that leads to the prize counter.

Run from the art/ folder:  python3 hall_b.py      (deterministic: fixed seeds)
Writes ONLY to out/b/.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pxkit import *  # noqa
from PIL import Image, ImageDraw

OUT = os.path.join(HERE, "out", "b")
FF = "/Users/ozan/Documents/Projects/HallPass/.claude/worktrees/fright-fest-hall/public/events/fright-fest"
os.makedirs(OUT, exist_ok=True)

W, H = 434, 230
PW, PH = 195, 252
MIRX = W - 1

# ------------------------------------------------------------------ palette
INK = "#0b0612"
WALL = ["#11131f", "#191c2d", "#232740", "#2f3552", "#3e4768", "#55607f"]  # cream paint at night, pushed blue-violet
GRN = ["#0c1613", "#13231e", "#1c3329", "#294a3a", "#3b6350", "#55806a"]  # institutional green (Last Bell corridor)
WOOD = ["#1a0f12", "#2c1a1a", "#452a22", "#653d2b", "#8a5a36", "#b4814a"]
VEL = ["#1d0a2b", "#34104a", "#511a6e", "#7a2a9c", "#a455d0"]  # plum velvet (brand-purple family)
SKY = ["#080b20", "#0f1838", "#192a5a", "#2a4382"]
STEEL = ["#171a26", "#2a2f44", "#454d68", "#6e7896", "#a2adc9"]
BRASS = ["#7a3f00", "#b86e00", "#ffc700", "#ffe066"]
METAL = ["#07070c", "#12131c", "#1f2230", "#343848", "#52586e"]
RED = ["#3a0a18", "#6e1226", "#a31c38", "#d33252"]
CORK = ["#4a3020", "#6a4a2c", "#8c6a3e", "#b08850"]
CREAM, BONE, LAV = "#fff8e7", "#f2e8d5", "#b9a7cf"
PAPER = ["#8c8678", "#b9b29f", "#dcd5c0"]
MOONLT = ["#3a4a9a", "#6f88e0", "#b8c8ff"]
WARM_H = ["#4a1500", "#d9600a", "#ff7a1a", "#ffb347"]
WARM_C = ["#7a3f00", "#b86e00", "#ffc700", "#ffe066"]
CALM_FILL = "#150e20"  # flat calm fill for tickets / ticker / panel
SLATE = "#0f1c1a"
LB = ["#0a0f0d", "#161614", "#202c25", "#33433a", "#4c5e50", "#6f7a68", "#8e9886"]
PINK, PINK2 = "#f43f5e", "#ff4f8b"
CRIM = ["#2a0a14", "#5a0c1f", "#8f1530", "#c8213f", "#ff5470"]


def spr(name):
    return Canvas.load(os.path.join(FF, name + ".png"))


# ------------------------------------------------------------------ small helpers
def tmask(s, font, size, weight=None):
    m, _ = text_mask(400, 80, 2, 2, s, font, size, weight, "la")
    ys, xs = np.nonzero(m)
    return m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def put_mask(c, m, x, y, col, outline=None, shadow=None):
    h, w = m.shape
    full = np.zeros((c.h, c.w), bool)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(c.w, x + w), min(c.h, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    full[y0:y1, x0:x1] = m[y0 - y : y1 - y, x0 - x : x1 - x]
    if outline:
        c.fill_mask(dilate(full, True) & ~full, outline)
    if shadow:
        sc, dx, dy = shadow
        c.fill_mask(np.roll(np.roll(full, dy, 0), dx, 1) & ~full, sc)
    c.fill_mask(full, col)


def ptext(c, x, y, s, col, font="Silkscreen", size=8, weight=None, align="l", **kw):
    m = tmask(s, font, size, weight)
    if align == "m":
        x -= m.shape[1] // 2
    elif align == "r":
        x -= m.shape[1]
    put_mask(c, m, x, y, col, **kw)
    return m.shape[1], m.shape[0]


G3 = {
    "A": "010101111101101", "B": "110101110101110", "C": "011100100100011", "D": "110101101101110",
    "E": "111100110100111", "F": "111100110100100", "G": "011100101101011", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101010", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "Q": "010101101110011", "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101010010010", "Z": "111001010100111", "0": "111101101101111", "?": "110001010000010",
    " ": "000000000000000",
}


def btext(c, x, y, s, col, tall=0, spc=1):
    """3x5 bitmap caps (tall > 0 stretches the middle row for tall condensed signs). Returns width."""
    cx = x
    for ch in s:
        g = G3[ch]
        rows = [g[i * 3 : i * 3 + 3] for i in range(5)]
        rows = rows[:3] + [rows[2]] * tall + rows[3:] if tall else rows
        if ch == " ":
            cx += 1 + spc
            continue
        for ry, r in enumerate(rows):
            for rx, v in enumerate(r):
                if v == "1":
                    c.px(cx + rx, y + ry, col)
        cx += 3 + spc
    return cx - x - spc


def bwidth(s, spc=1):
    return sum((1 if ch == " " else 3) + spc for ch in s) - spc


def rnd(seed):
    return np.random.RandomState(seed)


def mirror_pts(pts):
    return [(MIRX - x, y) for x, y in pts]


def prop(w, h):
    return Canvas(w, h)


def outlined(c, col=INK):
    """Add a 1 px outline OUTSIDE the opaque pixels by padding the canvas by 1 px."""
    o = Canvas(c.w + 2, c.h + 2)
    o.blit(c, 1, 1)
    o.outline(col)
    return o


def snap(c, nmax, protect=()):
    """Merge the rarest colours into their nearest kept neighbour so the scene stays within budget."""
    a = c.a[:, :, :3].reshape(-1, 3)
    cols, counts = np.unique(a, axis=0, return_counts=True)
    if len(cols) <= nmax:
        return c
    order = list(np.argsort(-counts))
    keep = set()
    for p in protect:
        t = np.array(rgba(p)[:3])
        hit = np.nonzero((cols == t).all(1))[0]
        if len(hit):
            keep.add(int(hit[0]))
    for i in order:
        if len(keep) >= nmax:
            break
        keep.add(int(i))
    kept = cols[sorted(keep)].astype(np.int32)
    wgt = np.array([2.0, 4.0, 3.0])
    d = (((cols[:, None, :].astype(np.int32) - kept[None, :, :]) ** 2) * wgt).sum(-1)
    m = kept[d.argmin(1)]
    idx = {tuple(cols[i]): tuple(m[i]) for i in range(len(cols))}
    flat = c.a[:, :, :3].reshape(-1, 3)
    lut = np.array([idx[tuple(v)] for v in flat], dtype=np.uint8)
    c.a[:, :, :3] = lut.reshape(c.h, c.w, 3)
    return c


# ------------------------------------------------------------------ architecture
def back_wall(c):
    xs, ys = c.grid()
    c.rect(0, 0, W, 170, WALL[2])
    # upper wall, lit near the windows, falling off toward the dado
    m = c.rect_mask(0, 34, W, 77)
    f = 0.70 - 0.62 * np.clip((ys - 34) / 76.0, 0, 1) + 0.05 * np.cos(xs / 7.0)
    c.shade(m, np.clip(f, 0, 1), WALL[:5])
    # window band wall + ceiling beam
    c.rect(0, 4, W, 30, WALL[3])
    c.rect(0, 0, W, 4, INK)
    c.hline(0, W - 1, 3, WALL[1])
    for x in range(0, W, 62):
        c.rect(x, 0, 5, 3, WALL[1])
    # window sill
    c.rect(0, 32, W, 2, WALL[5])
    c.hline(0, W - 1, 33, WALL[1])
    # dado rail
    c.rect(0, 110, W, 3, WALL[4])
    c.hline(0, W - 1, 110, WALL[5])
    c.hline(0, W - 1, 112, WALL[1])
    # painted brick below the dado (institutional green)
    r = rnd(11)
    for row, y in enumerate(range(113, 170, 4)):
        c.rect(0, y, W, 4, GRN[1])
        off = 5 if row % 2 else 0
        for x in range(-10 + off, W, 10):
            tone = r.choice([2, 2, 2, 3, 3, 4])
            c.rect(x + 1, y, 9, 3, GRN[tone])
            c.hline(x + 1, x + 9, y, GRN[min(tone + 1, 5)] if r.rand() < 0.35 else GRN[tone])
    # vignette: the lower wall sinks into night toward the floor
    for k, lv in enumerate((0.55, 0.40, 0.25)):
        c.dither(0, 140 + k * 10, W, 10, INK, lv * 0.7)
    # skirting
    c.rect(0, 166, W, 4, GRN[0])
    c.hline(0, W - 1, 166, GRN[2])


def pane_frame(c, cx, top, h, hw_clip=None):
    x, y, w = cx - 15, top, 30
    c.rect(x - 2, y - 2, w + 4, h + 4, STEEL[2])
    c.hline(x - 2, x + w + 1, y - 2, STEEL[4])
    c.vline(x - 2, y - 2, y + h + 1, STEEL[3])
    c.hline(x - 2, x + w + 1, y + h + 1, STEEL[0])
    c.vline(x + w + 1, y - 2, y + h + 1, STEEL[1])


def sky_pane(c, cx, top, h, seed, stars=6):
    x, y, w = cx - 15, top, 30
    xs, ys = c.grid()
    m = c.rect_mask(x, y, w, h)
    c.shade(m, 0.05 + 0.85 * np.clip((ys - y) / max(1, h - 1), 0, 1), SKY)
    r = rnd(seed)
    for _ in range(stars):
        sx, sy = x + 1 + r.randint(0, w - 2), y + 1 + r.randint(0, max(1, h * 2 // 3))
        c.px(sx, sy, CREAM if r.rand() < 0.5 else LAV)
    # transom bar
    c.hline(x, x + w - 1, y + 9, STEEL[1])
    c.hline(x, x + w - 1, y + 10, STEEL[0])
    return m


def windows(c, hw, bat=None):
    centres = [189, 133, 77, 21, 245, 301, 357, 413]
    for cx in centres:
        pane_frame(c, cx, 5, 27)
        sky_pane(c, cx, 5, 27, seed=cx)
    # moon pane
    moon = spr("moon")
    cx = 301
    xs, ys = c.grid()
    pm = c.rect_mask(cx - 15, 5, 30, 27)
    c.glow(cx, 17, 17, "#27407e", 0.9, 4, pm)
    c.blit(moon, cx - 11, 8, only_mask=pm)
    c.hline(cx - 15, cx + 14, 14, STEEL[1])
    c.hline(cx - 15, cx + 14, 15, STEEL[0])
    # school bell tower silhouette (the haunted school from the homepage)
    cx = 133
    t = c.rect_mask(cx - 15, 5, 30, 27)
    body = c.rect_mask(cx - 15, 24, 30, 8)
    tower = c.rect_mask(cx - 5, 15, 10, 17)
    roof = c.poly_mask([(cx - 7, 15), (cx, 8), (cx + 7, 15)])
    wing = c.poly_mask([(cx - 15, 24), (cx - 9, 21), (cx + 15, 21), (cx + 15, 24)])
    c.fill_mask((body | tower | roof | wing) & t, "#07091a")
    c.rect(cx - 2, 18, 4, 5, "#07091a")
    bell = WARM_H if hw else WARM_C
    c.rect(cx - 1, 19, 2, 3, bell[3])
    c.px(cx, 18, bell[2])
    for wx in (cx - 12, cx + 9):
        c.px(wx, 26, bell[1])
    c.hline(cx - 15, cx + 14, 14, STEEL[1])
    c.hline(cx - 15, cx + 14, 15, STEEL[0])
    if bat is not None:  # haunted bat past the window at 245 (the animation tiles)
        px_, py_, wing_a = bat
        b = spr("bat-a" if wing_a else "bat-b")
        pm2 = c.rect_mask(245 - 15, 5, 30, 27)
        c.blit(b, px_, py_, only_mask=pm2)
    # moon light spilling down the wall under the moon window (cold, dithered)
    sh = c.poly_mask([(286, 34), (316, 34), (300, 52), (276, 52)])
    c.dither_mask(sh & ~c.rect_mask(328, 0, 120, 120), MOONLT[0], 0.22)


def clock(c, hw):
    cx, cy = 217, 14
    c.circle(cx, cy, 8, METAL[0])
    c.circle(cx, cy, 7, BRASS[1])
    c.circle(cx, cy, 6, "#d8d0bc")
    c.circle(cx, cy, 6, "#a79f8c", fill=False)
    for tx, ty in [(cx, cy - 5), (cx + 5, cy), (cx, cy + 5), (cx - 5, cy)]:
        c.px(tx, ty, INK)
    c.hline(cx, cx + 5, cy, INK)  # minute hand at 3
    c.hline(cx, cx + 3, cy + 1, INK)  # hour hand just past 3 -> 3:15, the last bell
    c.px(cx, cy, BRASS[2])
    c.px(cx - 4, cy - 4, "#f2ecda")
    c.px(cx - 3, cy - 5, "#f2ecda")


def proscenium(c, hw, ghost=None):
    WARM = WARM_H if hw else WARM_C
    ax0, ax1 = 114, 320
    # backdrop inside the arch: a dark plywood flat, faintly lit from the lamps
    xs, ys = c.grid()
    m = c.rect_mask(120, 38, 194, 108)
    f = 0.30 - 0.10 * np.clip((ys - 38) / 108.0, 0, 1) + 0.07 * np.cos(xs / 5.0)
    c.shade(m, np.clip(f, 0, 1), ["#0a0716", "#120d24", "#1b1432", "#271c44"])
    # lamp cones (dithered) behind the cabinets
    for cx in (164, 217, 270):
        for y in range(62, 146):
            t = (y - 62) / 84.0
            half = int(3 + t * 19)
            lvl = 0.20 * (1 - 0.7 * t)
            row = np.zeros((c.h, c.w), bool)
            row[y, cx - half : cx + half + 1] = True
            c.dither_mask(row, WARM[0], lvl)
    # ghost peeks from behind the right curtain (drawn before the curtain so the cloth overlaps)
    if ghost is not None:
        g = spr("ghost")
        c.blit(g, 295, 104 + ghost)
    # lighting bar and three stage lamps
    c.rect(122, 57, 190, 2, STEEL[1])
    c.hline(122, 311, 57, STEEL[3])
    for rx in (128, 306):
        c.vline(rx, 49, 56, STEEL[1])
    for cx in (164, 217, 270):
        c.rect(cx - 1, 56, 3, 2, STEEL[0])
        c.rect(cx - 4, 58, 9, 4, STEEL[2])
        c.hline(cx - 4, cx + 4, 58, STEEL[4])
        c.rect(cx - 4, 61, 9, 1, STEEL[0])
        c.rect(cx - 2, 62, 5, 1, WARM[3])
        c.px(cx - 5, 59, STEEL[1])
    # curtains: left is lit from the top-left, the right sits a step darker
    left = [(120, 40), (142, 40), (139, 60), (134, 82), (127, 98), (128, 110), (131, 128), (136, 146), (120, 146)]
    right = mirror_pts(left)
    velvet(c, left, 0, 0.0)
    velvet(c, right, 3, -0.10)
    for pts in (left, right):
        xs_ = [p[0] for p in pts]
        inner = (min(xs_) if pts is right else max(xs_))
    # tie-backs: brass cord and tassel
    for (x0, x1) in ((120, 127), (306, 313)):
        c.hline(x0, x1, 98, BRASS[2])
        c.hline(x0, x1, 99, BRASS[1])
        c.hline(x0, x1, 100, BRASS[0])
    for tx in (126, 307):
        c.vline(tx, 101, 106, BRASS[2])
        c.rect(tx - 1, 104, 3, 3, BRASS[1])
    # pillars
    for px0 in (114, 314):
        c.rect(px0, 34, 6, 112, WALL[4])
        c.vline(px0 + (0 if px0 == 114 else 5), 34, 145, WALL[5] if px0 == 114 else WALL[2])
        c.vline(px0 + (5 if px0 == 114 else 0), 34, 145, WALL[2] if px0 == 114 else WALL[5])
        c.vline(px0 + 2, 40, 140, WALL[3])
        c.rect(px0, 138, 6, 8, WALL[2])
        c.hline(px0, px0 + 5, 138, WALL[5])
    # lintel
    c.rect(ax0, 34, ax1 - ax0 + 0, 4, WALL[4])
    c.hline(ax0, ax1 - 1, 34, WALL[5])
    c.hline(ax0, ax1 - 1, 37, BRASS[1])
    c.hline(ax0, ax1 - 1, 36, WALL[2])
    # valance (scalloped plum with braid)
    vm = np.zeros((c.h, c.w), bool)
    for x in range(120, 314):
        bot = 46 + int(round(3 * math.sin(math.pi * ((x - 120) % 14) / 14.0)))
        vm[38 : bot + 1, x] = True
        c.px(x, bot, BRASS[1])
    f = 0.40 + 0.22 * np.cos(xs * 2 * np.pi / 7.0) + 0.14 * (1 - (ys - 38) / 10.0)
    inner_m = vm & ~np.roll(vm, -1, 0)
    c.shade(vm, np.clip(f, 0, 1), VEL)
    for x in range(120, 314):
        bot = 46 + int(round(3 * math.sin(math.pi * ((x - 120) % 14) / 14.0)))
        c.px(x, bot, BRASS[1])
        if (x - 120) % 14 == 0:
            c.vline(x, bot, bot + 2, BRASS[2])
            c.px(x, bot + 2, BRASS[1])
    c.hline(120, 313, 38, VEL[4])


def velvet(c, pts, ph, bias):
    m = c.poly_mask(pts)
    xs, ys = c.grid()
    f = 0.40 + 0.26 * np.cos((xs + ph) * 2 * np.pi / 6.5) + 0.10 * np.cos((xs + ph * 2) * 2 * np.pi / 15.0 + 1.3)
    f += 0.22 * (1 - (ys - 40) / 106.0) + bias
    c.shade(m, np.clip(f, 0, 1), VEL)
    c.fill_mask(m & ~erode(m), VEL[0])


def banner(c, x, y, w, hw, bunting=True, bats=False, seed=5):
    """Hand-made: letter cards pegged on a sagging string, each hanging at its own height."""
    cols_h = [("#f2e8d5", INK), ("#ff7a1a", INK), ("#b9a7cf", INK), ("#f2e8d5", INK)]
    cols_c = [("#f2e8d5", INK), ("#ffc700", INK), ("#b9a7cf", INK), ("#f2e8d5", INK)]
    cols = cols_h if hw else cols_c
    r = rnd(seed)
    word = "FRIGHT FEST"
    cw, gap, sp = 10, 1, 5
    total = sum(cw if ch != " " else sp for ch in word) + gap * (len(word.replace(" ", "")) - 1)
    tag_w = 36
    avail = w - tag_w - 4
    x0 = x + max(0, (avail - total) // 2) + 1
    # string with sag
    def sag(px_):
        return y + 1 + int(round(1.5 * math.sin(math.pi * (px_ - x) / w)))
    for px_ in range(x, x + w):
        c.px(px_, sag(px_), "#cdbf9e")
        c.px(px_, sag(px_) + 1, "#3a2c20")
    cx = x0
    k = 0
    for ch in word:
        if ch == " ":
            cx += sp + gap
            continue
        body, ink = cols[k % len(cols)]
        dy = int(r.choice([0, 0, 1, 1, 2]))
        top = sag(cx + 4) + 2 + dy
        ch_h = 13
        card = prop(cw, ch_h)
        card.rect(0, 0, cw, ch_h, body)
        card.hline(0, cw - 1, 0, mix(body, "#ffffff", 0.35))
        card.vline(0, 0, ch_h - 1, mix(body, "#ffffff", 0.18))
        card.hline(0, cw - 1, ch_h - 1, mix(body, INK, 0.45))
        card.vline(cw - 1, 0, ch_h - 1, mix(body, INK, 0.35))
        m0 = tmask(ch, "Jersey10", 16)
        m = np.zeros((m0.shape[0], m0.shape[1] + 1), bool)
        m[:, :-1] |= m0
        m[:, 1:] |= m0
        put_mask(card, m, (cw - m.shape[1]) // 2, 2, ink)
        oc = outlined(card)
        c.blit(oc, cx - 1, top - 1)
        c.rect(cx + cw // 2 - 1, top - 2, 2, 3, "#6a4a2c")  # peg
        c.px(cx + cw // 2 - 1, top - 2, "#b08850")
        cx += cw + gap
        k += 1
    # the hallpass tag (wordmark + raised yellow dot) hangs off the right end
    tx, ty = x + w - tag_w - 1, sag(x + w - tag_w) + 3
    tag = prop(tag_w, 13)
    tag.rect(0, 0, tag_w, 13, "#e6dcc4")
    tag.hline(0, tag_w - 1, 0, "#fffaf0")
    tag.hline(0, tag_w - 1, 12, "#8c8678")
    tag.vline(tag_w - 1, 0, 12, "#b9b29f")
    tag.px(0, 0, "#e6dcc4")
    ww, _ = ptext(tag, 3, 5, "hallpass", "#3a1a78", "Micro5", 10)
    tag.rect(3 + ww + 1, 4, 2, 2, "#ffc700")
    ot = outlined(tag)
    c.blit(ot, tx - 1, ty - 1)
    c.rect(tx + 3, ty - 2, 2, 3, "#6a4a2c")
    c.rect(tx + tag_w - 6, ty - 2, 2, 3, "#6a4a2c")


def garland(c):
    """Paper-bat garland on the valance (haunted)."""
    pts = [(121, 40), (313, 40)]
    for xx in range(121, 314):
        t = (xx - 121) / 192.0
        c.px(xx, 40 + int(round(4 * math.sin(math.pi * t))), "#8c8678")
    for bx in (126, 133, 141, 291, 299, 306):
        t = (bx - 121) / 192.0
        yy = 40 + int(round(4 * math.sin(math.pi * t))) + 1
        c.hline(bx - 2, bx + 2, yy, INK)
        c.hline(bx - 3, bx + 3, yy + 1, INK)
        c.px(bx - 3, yy, INK)
        c.px(bx + 3, yy, INK)
        c.px(bx - 1, yy + 2, INK)
        c.px(bx + 1, yy + 2, INK)
        c.px(bx - 1, yy + 1, "#7c2eef")


def stage_front(c, hw, foot=0):
    WARM = WARM_H if hw else WARM_C
    # lip (varnished edge)
    c.rect(106, 146, 222, 3, WOOD[4])
    c.hline(106, 327, 146, WOOD[5])
    c.hline(106, 327, 148, WOOD[2])
    # face: dark painted wood
    FACE = "#201528"
    c.rect(106, 149, 222, 21, FACE)
    r = rnd(3)
    for x in range(108, 327, 12):
        c.vline(x, 150, 168, "#1a1022")
    c.hline(106, 327, 149, "#34224a")
    c.hline(106, 327, 168, "#34224a")
    c.rect(106, 169, 222, 1, METAL[0])
    # stage ends: the school crest on the left, a brass kick plate on the right
    c.rect(106, 149, 1, 21, "#2c1d3c")
    c.rect(327, 149, 1, 21, METAL[0])
    # calm ticket strips + a one-pixel rim just outside each
    for sx in (140, 193, 246):
        c.rect(sx - 1, 151, 50, 17, "#2c1d3c")
        c.rect(sx, 152, 48, 15, CALM_FILL)
        for bx in (sx - 4, sx + 51):
            c.rect(bx, 156, 2, 2, BRASS[1])
            c.px(bx, 156, BRASS[3])
    # footlights on the lip: warm bulbs with a dithered glow over the cabinet feet
    for i, x in enumerate(range(112, 324, 8)):
        on = True if foot == 0 else (i % 2 == 0)
        col = WARM[3] if on else WARM[1]
        c.rect(x, 147, 2, 1, col)
        c.px(x, 147, WARM[3] if on else WARM[2])
    # crest on the stage front left
    cr = prop(14, 17)
    cr.poly([(0, 0), (13, 0), (13, 9), (6, 16), (0, 9)], VEL[3])
    cr.poly([(1, 1), (12, 1), (12, 9), (6, 14), (1, 9)], VEL[2])
    cr.rect(5, 3, 3, 3, BRASS[2])
    cr.hline(2, 11, 9, CREAM)
    cr.hline(2, 11, 10, BRASS[1])
    c.blit(outlined(cr), 117, 151)
    # a dark floor shadow under every cabinet slot (the cabinets are separate sprites)
    for sx in (140, 193, 246):
        c.dither(sx - 3, 146, 54, 3, INK, 0.45)


def wall_bars(c):
    x, y, w, h = 14, 114, 56, 58
    c.rect(x, y, w, h, GRN[0])  # shadowed wall behind the bars
    for sx in (x, x + 26, x + w - 4):
        c.rect(sx, y, 4, h, WOOD[2])
        c.vline(sx, y, y + h - 1, WOOD[4])
        c.vline(sx + 3, y, y + h - 1, WOOD[0])
    for ry in range(y + 3, y + h - 2, 4):
        c.rect(x + 4, ry, 22, 2, WOOD[3])
        c.hline(x + 4, x + 25, ry, WOOD[4])
        c.hline(x + 4, x + 25, ry + 2, WOOD[0])
        c.rect(x + 30, ry, 22, 2, WOOD[3])
        c.hline(x + 30, x + 51, ry, WOOD[4])
        c.hline(x + 30, x + 51, ry + 2, WOOD[0])
    c.rect(x - 1, y - 2, w + 2, 3, WOOD[2])
    c.hline(x - 1, x + w, y - 2, WOOD[4])
    # bench
    c.rect(18, 160, 50, 3, WOOD[4])
    c.hline(18, 67, 160, WOOD[5])
    c.hline(18, 67, 162, WOOD[1])
    for lx in (22, 62):
        c.rect(lx, 163, 3, 7, WOOD[2])
        c.vline(lx, 163, 169, WOOD[3])
    c.rect(18, 159, 50, 1, INK)
    c.dither(16, 168, 54, 2, INK, 0.5)


def mop_bucket(c, hw):
    # mop leaning on the wall, then the caretaker's yellow bucket with a key ring
    for i in range(0, 38):
        c.px(93 - i // 5, 132 + i, WOOD[4])
        c.px(94 - i // 5, 132 + i, WOOD[2])
    b = prop(14, 14)
    b.poly([(0, 0), (13, 0), (11, 13), (2, 13)], "#ffc700")
    b.poly([(1, 1), (12, 1), (11, 12), (3, 12)], "#e0a400")
    b.vline(1, 1, 8, "#ffe066")
    b.hline(0, 13, 0, "#fff0a0")
    b.hline(2, 11, 13, "#7a3f00")
    b.rect(5, 4, 4, 3, "#3a1a78")
    b.rect(5, 4, 1, 3, "#7c2eef")
    c.blit(outlined(b), 77, 155)
    # grey mop head strands in the bucket
    for sx in range(82, 90):
        c.vline(sx, 152, 156, "#b3a29e" if sx % 2 else "#7d6c7a")
    # key ring hooked over the bucket handle
    c.line(78, 156, 82, 149, STEEL[3])
    c.line(88, 156, 86, 150, STEEL[3])
    c.circle(76, 152, 2, BRASS[2], fill=False)
    c.px(76, 154, BRASS[3])
    for kx, ky in ((74, 155), (76, 156), (78, 155)):
        c.vline(kx, ky, ky + 2, BRASS[2])
        c.px(kx, ky + 3, BRASS[1])
    # fire extinguisher on the wall
    e = prop(6, 17)
    e.rect(0, 3, 6, 14, "#a31c38")
    e.rect(0, 3, 1, 14, "#d33252")
    e.rect(1, 0, 4, 3, METAL[3])
    e.rect(1, 9, 4, 3, CREAM)
    c.blit(outlined(e), 98, 140)


def scoreboard(c, x, y, hw):
    """HALL SCORES: the old electronic gym scoreboard. Calm interior = (x+6, y+16, 84, 50)."""
    WARM = WARM_H if hw else WARM_C
    for cx_ in (x + 14, x + 80):  # hanging chains
        for yy in range(y - 6, y):
            c.px(cx_, yy, STEEL[3] if yy % 2 else STEEL[1])
    c.rect(x, y, 96, 72, INK)
    c.rect(x + 1, y + 1, 94, 70, METAL[1])
    c.hline(x + 1, x + 94, y + 1, METAL[4])
    c.vline(x + 1, y + 1, y + 70, METAL[3])
    c.hline(x + 1, x + 94, y + 70, METAL[0])
    c.vline(x + 94, y + 1, y + 70, METAL[0])
    # header panel with amber bulb lettering
    c.rect(x + 3, y + 3, 90, 11, METAL[0])
    ptext(c, x + 48, y + 6, "HALL SCORES", WARM[3], "Silkscreen", 8, align="m", shadow=(WARM[0], 1, 1))
    # calm interior with a one pixel bevel
    c.rect(x + 5, y + 15, 86, 52, METAL[2], fill=False)
    c.rect(x + 6, y + 16, 84, 50, "#07070c")
    # bulbs down both sides and across the bottom bar
    for by in range(y + 18, y + 64, 6):
        for bx in (x + 2, x + 92):
            c.rect(bx, by, 2, 2, WARM[2])
            c.px(bx, by, WARM[3])
    for bx in range(x + 10, x + 88, 8):
        c.rect(bx, y + 68, 2, 2, WARM[2] if (bx // 8) % 3 else WARM[0])
        c.px(bx, y + 68, WARM[3] if (bx // 8) % 3 else WARM[1])
    # bolts and the horn
    for bx, by in ((x + 3, y + 3), (x + 91, y + 3), (x + 3, y + 67), (x + 91, y + 67)):
        c.px(bx, by, METAL[4])
    c.rect(x + 44, y + 68, 8, 2, METAL[3])
    # a faint warm wash on the wall below (the bulbs)
    c.dither(x + 4, y + 72, 88, 2, WARM[0], 0.25)


def noticeboard(c, x, y, hw, h=66):
    """CANDY HUNT noticeboard. Calm strip = (x+8, y+h-18, 80, 12)."""
    r = rnd(21)
    c.rect(x, y, 96, h, INK)
    c.rect(x + 1, y + 1, 94, h - 2, STEEL[3])
    c.hline(x + 1, x + 94, y + 1, STEEL[4])
    c.rect(x + 2, y + 2, 92, h - 4, RED[2])
    xs, ys = c.grid()
    fm = c.rect_mask(x + 2, y + 2, 92, h - 4)
    c.dither_mask(fm & (((xs + ys) % 3) == 0), RED[1], 0.5)
    c.dither_mask(fm & (xs < x + 40), RED[3], 0.12)
    # cork field
    cm = c.rect_mask(x + 6, y + 6, 84, h - 12)
    c.shade(cm, 0.45 + 0.2 * r.rand(c.h, c.w) - 0.25 * (ys - y) / h, CORK)
    c.rect(x + 5, y + 5, 86, h - 10, RED[0], fill=False)
    # CANDY HUNT paper header, pinned
    hx = x + 14
    c.rect(hx, y + 8, 68, 11, "#dcd5c0")
    c.hline(hx, hx + 67, y + 8, "#fffaf0")
    c.hline(hx, hx + 67, y + 18, PAPER[0])
    c.rect(hx + 68, y + 9, 1, 10, INK)
    c.hline(hx + 1, hx + 68, y + 19, INK)
    ptext(c, hx + 34, y + 11, "CANDY HUNT", "#3a1a78", "Silkscreen", 8, align="m")
    for px_ in (hx + 2, hx + 65):
        c.rect(px_, y + 9, 2, 2, "#d33252")
        c.px(px_, y + 9, "#ff8f8f")
    # blank paper notices with drawing pins
    notes = [(x + 9, y + 23, 22, 21, "#dcd5c0", 0), (x + 37, y + 22, 22, 22, "#e8d8a0", 1), (x + 65, y + 24, 22, 20, "#bcd6c8", 0)]
    for nx, ny, nw, nh, col, tilt in notes:
        c.rect(nx + 1, ny + 1, nw, nh, CORK[0])
        c.rect(nx, ny, nw, nh, col)
        c.hline(nx, nx + nw - 1, ny, "#fffaf0")
        c.vline(nx + nw - 1, ny, ny + nh - 1, mix(col, INK, 0.3))
        c.hline(nx, nx + nw - 1, ny + nh - 1, mix(col, INK, 0.3))
        for ly in range(ny + 5, ny + nh - 3, 4):
            c.hline(nx + 3, nx + nw - 5 - (ly % 3) * 2, ly, mix(col, INK, 0.12))
        pc = ["#d33252", "#ffc700", "#00cfd6"][(nx // 7) % 3]
        c.rect(nx + nw // 2 - 1, ny + 1, 2, 2, pc)
        c.px(nx + nw // 2 - 1, ny + 1, "#ffffff")
    # gold merit star on the middle notice
    sx, sy = x + 47, y + 33
    for dx, dy in ((2, 0), (1, 1), (2, 1), (3, 1), (0, 2), (1, 2), (2, 2), (3, 2), (4, 2), (1, 3), (2, 3), (3, 3), (1, 4), (3, 4)):
        c.px(sx + dx, sy + dy, "#ffc700")
    c.px(sx + 2, sy + 1, "#ffe066")
    c.px(sx + 1, sy + 2, "#ffe066")
    sy0 = y + h - 18
    if h > 70:  # taller board: a second row of small notices
        for nx in (x + 12, x + 40, x + 68):
            c.rect(nx, y + 48, 18, 10, "#dcd5c0")
            c.hline(nx, nx + 17, y + 48, "#fffaf0")
            c.rect(nx + 8, y + 49, 2, 2, "#d33252")
    # calm strip: dark paper
    c.rect(x + 7, sy0 - 1, 82, 14, CORK[0])
    c.rect(x + 8, sy0, 80, 12, "#17122a")
    c.rect(x + 7, sy0 - 1, 82, 14, "#2c2548", fill=False)
    c.rect(x + 8, sy0, 80, 12, "#17122a")
    for px_ in (x + 9, x + 85):
        c.px(px_ - 1, sy0 - 1, "#d33252")


def tuckshop(c, x, y, hw):
    """TUCK SHOP serving hatch, 92 x 56. Shutter half up, warm light inside."""
    WARM = WARM_H if hw else WARM_C
    xs, ys = c.grid()
    c.rect(x, y, 92, 56, INK)
    c.rect(x + 1, y + 1, 90, 54, GRN[3])
    c.vline(x + 1, y + 1, y + 54, GRN[4])
    c.hline(x + 1, x + 90, y + 1, GRN[5])
    c.vline(x + 90, y + 1, y + 54, GRN[2])
    for px_ in range(x + 10, x + 90, 12):
        c.vline(px_, y + 2, y + 54, GRN[2])
    # painted sign board, uneven hand lettering
    c.rect(x + 5, y + 2, 82, 11, VEL[1])
    c.rect(x + 5, y + 2, 82, 11, VEL[0], fill=False)
    c.hline(x + 6, x + 85, y + 3, VEL[3])
    word = "TUCK SHOP"
    wm = tmask(word, "Jersey10", 16)
    put_mask(c, wm, x + 46 - wm.shape[1] // 2, y + 3, "#ffe066" if True else CREAM, shadow=(INK, 1, 1))
    # striped awning with scalloped hem
    for ax in range(x + 3, x + 89):
        col = "#e8dcc0" if ((ax - x) // 6) % 2 == 0 else "#b8203c"
        c.vline(ax, y + 14, y + 17, col)
        if ((ax - x) % 6) in (1, 2, 3, 4):
            c.px(ax, y + 18, col)
    c.hline(x + 3, x + 88, y + 14, "#f4ecd6")
    c.hline(x + 3, x + 88, y + 17, "#8c1830")
    # hatch opening (warm interior)
    ox, oy, ow, oh = x + 6, y + 20, 54, 28
    c.rect(ox - 1, oy - 1, ow + 2, oh + 2, INK)
    c.rect(ox, oy, ow, oh, WARM[1])
    m = c.rect_mask(ox, oy, ow, oh)
    c.shade(m, 0.30 + 0.55 * (1 - np.abs(xs - (ox + ow / 2)) / (ow / 2)) * (1 - 0.3 * np.clip((ys - oy) / oh, 0, 1)), [WARM[0], WARM[1], WARM[2]])
    # back shelf with tiny packs
    c.rect(ox, oy + 23, ow, 2, WOOD[3])
    c.hline(ox, ox + ow - 1, oy + 23, WOOD[5])
    c.rect(ox, oy + 25, ow, 3, WOOD[0])
    r = rnd(8)
    packs = ["#7c2eef", "#f43f5e", "#00cfd6", "#ffc700", "#2a4382", "#d33252", "#8b5cf6"]
    for px_ in range(ox + 3, ox + ow - 6, 8):
        col = packs[r.randint(0, len(packs))]
        c.rect(px_, oy + 14, 6, 9, col)
        c.rect(px_, oy + 14, 6, 9, INK, fill=False)
        c.vline(px_ + 1, oy + 15, oy + 21, mix(col, "#ffffff", 0.35))
        c.rect(px_ + 2, oy + 17, 3, 3, CREAM)
    # hanging bulb
    c.vline(ox + ow // 2, oy + 12, oy + 14, INK)
    c.rect(ox + ow // 2 - 1, oy + 15, 3, 2, CREAM)
    # roller shutter half up: slats down to mid-height and a heavy bottom bar
    shut = oy + 10
    for yy in range(oy, shut):
        c.hline(ox, ox + ow - 1, yy, GRN[4] if yy % 3 == 0 else GRN[3])
    c.hline(ox, ox + ow - 1, shut, INK)
    c.rect(ox, shut + 1, ow, 2, STEEL[2])
    c.hline(ox, ox + ow - 1, shut + 1, STEEL[4])
    c.rect(ox + 22, shut + 3, 4, 1, STEEL[3])  # pull handle
    # counter ledge and front panel
    c.rect(x + 3, y + 48, 86, 3, WOOD[4])
    c.hline(x + 3, x + 88, y + 48, WOOD[5])
    c.hline(x + 3, x + 88, y + 50, WOOD[1])
    c.rect(x + 3, y + 51, 86, 4, GRN[2])
    c.dither(x + 1, y + 51, 90, 4, INK, 0.3)
    # service bell on the counter
    c.rect(x + 20, y + 45, 5, 3, BRASS[2])
    c.hline(x + 20, x + 24, y + 45, BRASS[3])
    c.px(x + 22, y + 44, BRASS[1])
    # warm light spilling onto the floor in front of the hatch
    c.dither_mask(c.poly_mask([(x + 8, y + 56), (x + 84, y + 56), (x + 96, y + 70), (x + 0, y + 70)]) & c.rect_mask(0, 170, c.w, 12), WARM[0], 0.4)
    # ROOM 000 plaque with an arrow, on the counter front
    pl = spr("plaque-000")
    c.blit(pl, x + 64, y + 22)
    for sx_ in (x + 64, x + 89):
        c.px(sx_, y + 22, STEEL[4])
    for i in range(4):  # arrow pointing back at the hatch
        c.vline(x + 66 + i, y + 38 - i, y + 38 + i, CREAM)
    c.hline(x + 70, x + 82, y + 38, CREAM)


def chalkboard(c, x, y):
    """A-frame chalkboard. Calm rect = (x, y, 56, 12)."""
    c.rect(x - 2, y - 2, 60, 16, WOOD[3])
    c.hline(x - 2, x + 57, y - 2, WOOD[5])
    c.rect(x - 2, y - 2, 60, 16, WOOD[1], fill=False)
    c.rect(x, y, 56, 12, SLATE)
    c.hline(x - 1, x + 56, y + 13, WOOD[0])
    c.rect(x + 10, y + 13, 6, 1, CREAM)  # chalk ledge
    for lx in (x + 2, x + 50):
        c.line(lx, y + 14, lx - 3, y + 22, WOOD[2])
        c.line(lx + 1, y + 14, lx - 2, y + 22, WOOD[1])


def floor(c, hw):
    F = ["#1d1015", "#2c181a", "#3f2522", "#573428", "#6e4630"]
    r = rnd(7)
    y, row = 170, 0
    while y < H:
        rh = 3 + row // 3
        L = 12 + row * 2
        x = -int(r.randint(0, L))
        while x < W:
            tone = int(r.choice([1, 1, 2, 2, 2, 3, 0]))
            c.rect(x, y, L, rh, F[tone])
            if r.rand() < 0.5:
                c.hline(max(x + 1, 0), min(x + L - 2, W - 1), y, F[min(tone + 1, 4)])
            c.vline(x, y, y + rh - 1, F[0])
            x += L
        c.hline(0, W - 1, y + rh - 1, F[0])
        y += rh
        row += 1
    # painted court lines (dull red and yellow) in slight perspective
    def fl(x0, y0, x1, y1, col):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) * 2 + 1
        for i in range(n + 1):
            t = i / n
            px_, py_ = int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))
            if py_ >= 171:
                c.px(px_, py_, col)
                c.px(px_ + 1, py_, col)

    fl(218, 40, -80, 230, "#7a6022")
    fl(218, 40, 520, 230, "#7a6022")
    fl(218, 40, 16, 230, "#6e2634")
    fl(218, 40, 420, 230, "#6e2634")
    c.hline(0, W - 1, 207, "#6e2634")
    c.hline(0, W - 1, 208, "#6e2634")
    # moonlight patches from the clerestory (cold, dithered); the hall's centre stays dark
    xs, ys = c.grid()
    fm = c.rect_mask(0, 170, W, 60)
    joint = np.array(rgba("#1d1015")[:3])
    bayer = BAYER4[ys % 4, xs % 4]
    for cx in (21, 77, 357, 413):
        poly = [(cx - 19, 172), (cx + 11, 172), (cx - 9 - 24, 230), (cx + 21 - 24 - 30 + 30, 230)]
        poly = [(cx - 19, 172), (cx + 11, 172), (cx - 1, 230), (cx - 31, 230)]
        pm = c.poly_mask(poly) & fm
        edge = pm & ~erode(pm)
        pm = pm & ~(edge & (bayer >= 0.5))
        core = c.poly_mask([(cx - 13, 176), (cx + 5, 176), (cx - 7, 226), (cx - 25, 226)]) & pm
        isj = np.all(c.a[:, :, :3] == joint, axis=2)
        c.fill_mask(pm & isj, "#232846")
        c.fill_mask(pm & ~isj, "#3a4470")
        c.fill_mask(core & isj, "#2c3258")
        c.fill_mask(core & ~isj, "#4c5a8c")
    # shadow toward the corners
    c.dither_mask(fm & (ys > 214), INK, 0.35)
    c.dither_mask(fm & ((xs < 12) | (xs > W - 13)), INK, 0.3)
    # the long dark rubber mat (HTML panel) and the ticker plaque (both calm and flat)
    c.rect(119, 183, 196, 46, "#2c2142")
    c.rect(120, 184, 194, 44, CALM_FILL)
    c.hline(120, 313, 183, "#3a2c56")
    c.rect(149, 171, 136, 11, "#2c2142")
    c.rect(150, 172, 134, 9, CALM_FILL)
    for bx in (147, 285):
        c.rect(bx, 174, 2, 3, BRASS[1])
        c.px(bx, 174, BRASS[3])
    # rubber edge studs on the mat
    for bx, by in ((121, 185), (312, 185), (121, 226), (312, 226)):
        c.px(bx, by, BRASS[1])


def chair_stack(c, x, base, n=5, flip=False):
    """A stack of school plastic chairs in profile, nested with a small rise each."""
    CH = ["#1c2438", "#2e3d60", "#46618c", "#6b8ab8"]
    for i in range(n):
        ch = prop(18, 24)
        # slanted backrest, seat and (bottom chair only) legs
        for k in range(11):
            ch.rect(1 + k // 4, k, 3, 1, CH[2])
            ch.px(1 + k // 4, k, CH[3])
        ch.rect(2, 10, 15, 3, CH[2])
        ch.hline(2, 16, 10, CH[3])
        ch.hline(2, 16, 12, CH[1])
        if i == 0:
            ch.rect(14, 13, 2, 11, STEEL[2])
            ch.vline(14, 13, 23, STEEL[4])
            ch.rect(3, 13, 2, 11, STEEL[1])
        o = outlined(ch)
        c.blit(o, x - 1 + i, base - 25 - i * 4, mirror=flip)


# ------------------------------------------------------------------ the scene
def scene(season="haunted", ghost=0, bat=None, foot=0):
    hw = season == "haunted"
    WARM = WARM_H if hw else WARM_C
    c = Canvas(W, H, INK)
    back_wall(c)
    windows(c, hw, bat=bat)
    clock(c, hw)
    scoreboard(c, 10, 38, hw)
    wall_bars(c)
    mop_bucket(c, hw)
    noticeboard(c, 328, 38, hw)
    tuckshop(c, 332, 108, hw)
    # ROOM 000 plaque with an arrow, on the tuck-shop counter front
    # fire alarm, right of the stage
    c.rect(322, 118, 7, 9, "#a31c38")
    c.rect(323, 119, 5, 3, "#d33252")
    c.rect(322, 118, 7, 9, INK, fill=False)
    proscenium(c, hw, ghost=ghost if hw else None)
    banner(c, 136, 38, 162, hw)
    if hw:
        garland(c)
    stage_front(c, hw, foot=foot)
    floor(c, hw)
    # warm light spill on the floor from the hatch
    c.dither_mask(c.poly_mask([(340, 170), (416, 170), (424, 184), (332, 184)]) & ~c.rect_mask(349, 164, 60, 20), WARM[0], 0.35)
    chalkboard(c, 350, 166)
    # footlight glow already in stage_front; haunted overlay props
    if hw:
        for px_ in (123, 299):
            c.blit(spr("pumpkin"), px_, 136)
        wb = spr("web-corner")
        c.blit(wb, 114, 34)
        c.blit(wb, 304, 34, mirror=True)
        c.vline(212, 22, 26, "#b9a7cf")
        c.blit(spr("spider"), 208, 26)
    return c


# ------------------------------------------------------------------ cabinets
def sheet_ramp(on, hw):
    WARM = WARM_H if hw else WARM_C
    base = ["#3a4060", "#5b6486", "#8a92b4", "#b5bbd6", "#dfe2f0"]
    if not on:
        return base
    return [base[1], mix(base[2], WARM[2], 0.35), mix(base[3], WARM[2], 0.55), WARM[3], mix(WARM[3], "#ffffff", 0.5)]


def screen(key, f, hw=True):
    """34 x 32 screen picture, frame f in 0..2."""
    c = Canvas(34, 32, "#0a0a12")
    xs, ys = c.grid()
    if key == "lastbell":
        # one-point corridor: lockers both sides, chequered floor, a figure at the far end, one red light
        ceil = [(0, 0), (34, 0), (22, 9), (12, 9)]
        flr = [(0, 32), (34, 32), (22, 19), (12, 19)]
        lw = [(0, 0), (12, 9), (12, 19), (0, 32)]
        rw = [(34, 0), (22, 9), (22, 19), (34, 32)]
        c.fill_mask(c.poly_mask(ceil), LB[2])
        c.fill_mask(c.poly_mask(lw), LB[4])
        c.fill_mask(c.poly_mask(rw), LB[3])
        c.rect(12, 9, 10, 10, LB[2])
        # lockers: vertical seams converging, vents
        for sx, shade_ in ((1, LB[1]), (4, LB[1]), (7, LB[1]), (9, LB[1]), (10, LB[1])):
            for y in range(0, 32):
                if lw and c.poly_mask(lw)[y, sx]:
                    c.px(sx, y, shade_)
        for sx in (24, 26, 29, 32):
            for y in range(0, 32):
                if c.poly_mask(rw)[y, sx]:
                    c.px(sx, y, LB[1])
        for vy in (6, 8):
            c.hline(2, 3, vy, LB[1])
        # chequered floor in perspective
        fm = c.poly_mask(flr)
        zt = np.maximum(ys - 18.0, 0.5)
        u = np.floor((xs - 17.0) / (0.9 + zt * 0.30))
        v = np.floor(np.log(zt + 0.5) * 3.2)
        chk = ((u + v) % 2) == 0
        c.fill_mask(fm & chk, LB[5] if f != 1 else LB[4])
        c.fill_mask(fm & ~chk, LB[1])
        # far door, red light, figure
        c.rect(14, 11, 6, 8, LB[0])
        c.rect(14, 11, 6, 8, LB[1], fill=False)
        c.px(21, 11, "#ff2a3a" if f != 2 else "#7a1020")
        if f != 2:
            c.px(20, 12, "#7a1020")
            c.px(22, 12, "#7a1020")
            c.px(21, 13, "#7a1020")
        fx = 16 + (1 if f == 1 else 0)
        c.rect(fx, 14, 2, 2, "#05060a")
        c.rect(fx - 1, 16, 4, 3, "#05060a")
        # ceiling strip light
        c.hline(14, 19, 8, LB[6] if f != 1 else LB[3])
        c.dither(10, 2, 14, 6, LB[3], 0.15 if f != 1 else 0.0)
        c.rect(0, 28, 34, 4, LB[1]) if False else None
    elif key == "shadowcore":
        c.vgrad(0, 0, 34, 32, ["#0a0812", "#171027", "#24183a"])
        c.circle(20, 11, 9, "#e6e9f6")
        c.circle(20, 11, 9, "#c4c9de", fill=False)
        for cx_, cy_ in ((16, 8), (23, 13), (19, 15)):
            c.px(cx_, cy_, "#c4c9de")
        c.circle(17, 9, 1, "#f6f8ff")
        # black blob mid jump
        jy = (0, -3, -1)[f]
        bx, by = 8, 18 + jy
        c.ellipse(bx + 3, by + 3, 4, 3, "#030206")
        c.rect(bx + 1, by + 6, 6, 1, "#030206")
        c.rect(bx + 1, by + 2, 2, 2, "#ffffff")
        c.rect(bx + 4, by + 2, 2, 2, "#ffffff")
        c.px(bx + 2, by + 3, "#030206")
        c.px(bx + 5, by + 3, "#030206")
        # neon pink spikes
        c.rect(0, 29, 34, 3, "#14091a")
        for sx in range(12, 34, 5):
            c.poly([(sx, 29), (sx + 2, 22), (sx + 4, 29)], PINK)
            c.line(sx + 2, 23, sx + 2, 28, PINK2)
        c.hline(0, 33, 29, PINK2)
        c.dither(0, 24, 34, 5, PINK, 0.12)
    elif key == "std":
        c.vgrad(0, 0, 34, 32, ["#1a060e", "#2a0a14", "#4a1020"])
        c.circle(24, 8, 5, "#8f1530")
        c.circle(24, 8, 4, CRIM[3])
        c.circle(23, 7, 2, CRIM[4])
        c.glow(24, 8, 10, CRIM[3], 0.5, 3)
        # dark red woods
        r = rnd(4)
        for tx in range(0, 34, 6):
            th = 12 + (tx * 7) % 7
            ty = 31
            c.poly([(tx, ty), (tx + 3, ty - th), (tx + 6, ty)], "#14040a")
            c.poly([(tx + 1, ty - th // 2), (tx + 3, ty - th - 2), (tx + 5, ty - th // 2)], "#14040a")
        c.rect(0, 28, 34, 4, "#14040a")
        # ranger sprite
        c.rect(9, 20, 4, 8, "#14040a")
        c.rect(10, 22, 2, 5, "#ffb347")
        c.rect(9, 19, 4, 1, "#c8213f")
        c.rect(10, 20, 2, 2, "#e8b890")
        c.px(10, 25 + (f % 2), "#ffb347")
        c.vline(14, 22, 27, "#8a5a36")  # staff
        # glowing eyes between the trees
        for ex, ey in ((22, 17), (28, 14)):
            if not (f == 2 and ex == 22):
                c.px(ex, ey, "#ffb347")
                c.px(ex + 2, ey, "#ffb347")
    elif key == "mystery":
        mc = (WARM_H if hw else WARM_C)
        r = sheet_ramp(True, hw)
        f_ = 0.55 + 0.3 * np.cos(xs * 2 * np.pi / 7.0) - 0.4 * (np.hypot(xs - 17, ys - 16) / 22.0)
        c.shade(c.rect_mask(0, 0, 34, 32), np.clip(f_, 0, 1), r)
        ex = (0, -1, 0)[f]
        for sx in (9, 21):
            if f == 2:
                c.hline(sx + ex, sx + ex + 3, 14, mc[1])
            else:
                c.rect(sx + ex, 12, 4, 5, mc[2])
                c.rect(sx + ex, 12, 4, 1, mc[3])
                c.rect(sx + ex + 1, 14, 2, 2, mc[0])
    return c


def dim_screen(c):
    d = c.copy()
    rgb = d.a[:, :, :3].astype(np.float32)
    dark = np.array(rgba("#0a0814")[:3], dtype=np.float32)
    d.a[:, :, :3] = np.clip(rgb * 0.52 + dark * 0.48, 0, 255).astype(np.uint8)
    return d


def cab_body(key, on, hw, f=0):
    """Everything except the screen picture. 48 x 84."""
    c = Canvas(48, 84)
    xs, ys = c.grid()
    glow = WARM_H if hw else WARM_C
    wood_f = lambda x, y: 0.40 + 0.30 * ((x * 3 + y * 5) % 7 == 0) + 0.12 * ((y // 3) % 2)
    if key == "lastbell":
        body = LB
        m = c.rect_mask(1, 5, 46, 79)
        c.fill_mask(m, body[3])
        # sides: wood grain
        for side in (range(1, 5), range(43, 47)):
            for x in side:
                for y in range(5, 84):
                    col = WOOD[2] if wood_f(x, y) < 0.5 else WOOD[3]
                    c.px(x, y, WOOD[1] if (y * 3 + x) % 11 == 0 else col)
        c.vline(1, 5, 83, WOOD[4])
        # front gradient (light top-left)
        fm = c.rect_mask(5, 5, 38, 79)
        c.shade(fm, 0.78 - 0.35 * (ys / 84.0) - 0.12 * (xs / 48.0), LB[2:7])
        # little school bell on top
        c.rect(21, 1, 6, 4, BRASS[2])
        c.hline(21, 26, 1, BRASS[3])
        c.hline(20, 27, 4, BRASS[1])
        c.px(23, 0, BRASS[1])
        c.px(24, 0, BRASS[1])
        c.px(24, 5, BRASS[3])
        # marquee board: dark framed sign
        c.rect(4, 5, 40, 8, LB[0])
        c.rect(4, 5, 40, 8, LB[5] if on else LB[3], fill=False)
        c.rect(5, 6, 38, 6, "#0c0f0c")
        tc = "#f2ecd8" if on else "#6f7a68"
        btext(c, 7, 7, "LAST BELL", tc)
        # control panel
        c.rect(4, 47, 40, 2, LB[5])
        c.rect(4, 49, 40, 10, LB[2])
        c.hline(4, 43, 49, LB[4])
        c.rect(9, 52, 3, 2, "#0a0f0d")
        c.vline(10, 49, 53, "#0a0f0d")
        c.circle(10, 50, 1, "#d33252")
        c.rect(25, 53, 3, 3, "#ffc700")
        c.rect(31, 53, 3, 3, "#d33252")
        c.rect(37, 53, 3, 3, "#00cfd6")
        # base: locker vent side art + masking tape label + coin door
        c.rect(4, 60, 40, 23, LB[2])
        for vy in (62, 64, 66):
            c.hline(6, 15, vy, LB[0])
            c.hline(6, 15, vy + 1, LB[3])
        tape = prop(34, 21)
        tape.rect(0, 0, 34, 21, "#d8c9a0")
        tape.hline(0, 33, 0, "#efe3c0")
        tape.vline(33, 0, 20, "#b3a47c")
        for yy, s in ((2, "PROPERTY"), (8, "OF ROOM"), (14, "000")):
            btext(tape, 2, yy, s, "#8f1530" if yy == 14 else "#3a2a2a")
        c.blit(tape, 4, 60 + 0)
        c.rect(38, 64, 5, 8, "#0a0f0d")
        c.rect(39, 66, 3, 1, "#8e9886")
        c.px(40, 70, "#ff2a3a")
        c.rect(4, 79, 40, 4, LB[0])
    elif key == "shadowcore":
        m = c.rect_mask(1, 5, 46, 79) | c.poly_mask([(1, 5), (24, 0), (46, 5)])
        c.fill_mask(m, "#0e0b16")
        # glossy black front with a diagonal sheen
        fm = c.rect_mask(1, 5, 46, 79) | c.poly_mask([(1, 5), (24, 0), (46, 5)])
        sheen = 0.18 + 0.2 * (((xs + ys // 2) % 11) < 2) + 0.10 * (1 - ys / 84.0)
        c.shade(fm, sheen, ["#07050c", "#14101e", "#241c36", "#3a2e55"])
        c.line(1, 5, 24, 0, PINK if on else "#a62a40")
        c.line(46, 5, 24, 0, PINK if on else "#a62a40")
        # marquee
        c.rect(2, 5, 44, 8, "#08060e")
        c.rect(2, 5, 44, 8, PINK if on else "#7a1f34", fill=False)
        tcol = "#ffffff" if on else "#8e8aa6"
        btext(c, 3, 7, "SHADOW CORE", tcol)
        # pink tape trim
        for ty in (13, 47, 59, 78):
            c.hline(1, 46, ty, PINK if on else "#a62a40")
        c.vline(2, 14, 46, PINK2)
        c.vline(45, 14, 46, "#a62a40")
        c.hline(1, 46, 60, "#ff9fb4") if False else None
        # panel
        c.rect(3, 48, 42, 11, "#171126")
        c.hline(3, 44, 48, "#3a2e55")
        c.circle(10, 51, 1, PINK2)
        c.vline(10, 52, 55, "#050308")
        c.rect(24, 53, 3, 3, "#ffffff")
        c.rect(30, 53, 3, 3, PINK)
        c.rect(36, 53, 3, 3, PINK2)
        # base with pink tape X and coin door
        c.rect(3, 61, 42, 17, "#0a0812")
        c.line(5, 63, 42, 76, PINK2)
        c.line(42, 63, 5, 76, PINK2)
        c.rect(18, 65, 12, 9, "#08060e")
        c.rect(18, 65, 12, 9, "#3a2e55", fill=False)
        c.px(24, 70, "#ff2a3a")
        c.rect(3, 79, 42, 4, "#050308")
    elif key == "std":
        m = c.rect_mask(1, 2, 46, 82)
        c.fill_mask(m, CRIM[2])
        for side in (range(1, 5), range(43, 47)):
            for x in side:
                for y in range(5, 84):
                    col = "#3a1a14" if wood_f(x, y) < 0.5 else "#4f2418"
                    c.px(x, y, "#241008" if (y * 3 + x) % 11 == 0 else col)
        c.vline(1, 5, 83, "#6b3a22")
        fm = c.rect_mask(5, 2, 38, 82)
        c.shade(fm, 0.68 - 0.3 * (ys / 84.0) - 0.1 * (xs / 48.0), CRIM[:4])
        # tiny tree silhouettes on top
        for tx in (35, 40):
            c.poly([(tx - 2, 2), (tx, 0), (tx + 2, 2)], "#14040a")
        # marquee: SURVIVE / TILL DAWN stacked
        c.rect(3, 2, 38, 12, "#12040a")
        c.hline(3, 40, 2, CRIM[4] if on else CRIM[1])
        lc = CRIM[4] if on else "#9a2a40"
        btext(c, 5, 3, "SURVIVE", lc)
        btext(c, 5, 9, "TILL DAWN", lc)
        # panel
        c.rect(4, 47, 40, 2, CRIM[3])
        c.rect(4, 49, 40, 10, CRIM[1])
        c.hline(4, 43, 49, CRIM[2])
        c.circle(10, 50, 1, "#ffb347")
        c.vline(10, 51, 54, "#14040a")
        c.rect(25, 53, 3, 3, "#ffb347")
        c.rect(31, 53, 3, 3, "#ffe066")
        c.rect(37, 53, 3, 3, "#ff5470")
        # base: dark wood panelling and coin door
        c.rect(4, 60, 40, 23, "#3a1a14")
        for px_ in (6, 25):
            c.rect(px_, 62, 17, 14, "#4f2418")
            c.rect(px_, 62, 17, 14, "#241008", fill=False)
        c.rect(36, 66, 5, 8, "#14040a")
        c.px(38, 72, "#ff5470")
        c.rect(4, 79, 40, 4, "#241008")
    else:  # mystery: a dust sheet over a cabinet, with a pinned paper ??? tag
        m = np.zeros((84, 48), bool)
        for y in range(4, 84):
            half = min(23.0, 11 + (y - 4) * 1.2)
            if y >= 76:
                half = 23.5
            m[y, int(round(24 - half)) : int(round(24 + half))] = True
        for x in range(0, 48):  # scalloped hem
            d = int(round(3 * abs(math.sin(math.pi * x / 9.0))))
            m[80 + d :, x] = False
        c.fill_mask(m, "#ffffff")
        ramp_ = sheet_ramp(on, hw)
        f_ = 0.52 + 0.26 * np.cos(xs * 2 * np.pi / 14.0 + 0.5) + 0.10 * np.cos(xs * 2 * np.pi / 6.0 + 1.0) - 0.22 * (xs / 48.0) - 0.12 * (ys / 84.0)
        f_ = f_ + 0.10 * (ys < 14)
        if on:
            f_ = f_ + 0.55 * np.clip(1 - np.hypot(xs - 24, ys - 32) / 24.0, 0, 1)
        c.shade(m, np.clip(f_, 0, 1), ramp_, dither=False)
        if on:
            mc = WARM_H if hw else WARM_C
            ex = (0, -1, 0)[f]
            for sx in (14, 28):
                if f == 2:
                    c.hline(sx + ex, sx + ex + 4, 31, mc[1])
                else:
                    c.rect(sx + ex, 27, 5, 6, mc[2])
                    c.rect(sx + ex, 27, 5, 1, mc[3])
                    c.rect(sx + ex + 1, 30, 3, 2, mc[0])
        tag = prop(17, 11)
        tag.rect(0, 0, 17, 11, "#e6dcc4")
        tag.hline(0, 16, 0, "#fffaf0")
        tag.hline(0, 16, 10, "#8c8678")
        btext(tag, 3, 3, "???", "#a31c38")
        tag.rect(7, 0, 2, 2, "#d33252")
        c.blit(outlined(tag), 26, 54)
    # outline the finished silhouette (inside, ink)
    a = c.alpha_mask()
    c.fill_mask(a & ~erode(a), INK)
    return c


def cabinet(key, on, hw=True):
    c = cab_body(key, on, hw)
    if key == "mystery":
        return finish_cab(c, key, on, hw)
    sc = screen(key, 0, hw)
    sc = sc if on else dim_screen(sc)
    # bezel
    c.rect(6, 14, 36, 33, "#07060e")
    c.rect(7, 14, 34, 32, "#000000")
    c.blit(sc, 7, 14)
    return finish_cab(c, key, on, hw)


def finish_cab(c, key, on, hw):
    if not on:
        return c
    # rim light on the lit edges, plus a dithered glow in the screen colour around the bezel
    gcol = {"lastbell": "#8e9886", "shadowcore": PINK2, "std": CRIM[4], "mystery": (WARM_H if hw else WARM_C)[2]}[key]
    xs, ys = c.grid()
    body = c.alpha_mask() & ~c.color_mask(INK)
    ring = body & (np.hypot(xs - 24, ys - 30) < 26) & ~c.rect_mask(6, 13, 36, 34) & (ys >= 14)
    c.dither_mask(ring, gcol, 0.14)
    edge = body & ~erode(body)
    c.fill_mask(edge & (xs < 24) & (ys > 4), mix(gcol, "#ffffff", 0.25))
    return c


def spot_sprite():
    c = Canvas(64, 94)
    xs, ys = c.grid()
    t = ys / 93.0
    half = 5 + t * 27
    d = np.abs(xs - 31.5)
    inside = d <= half
    f = (1 - d / np.maximum(half, 1)) * (1 - 0.45 * t)
    for lvl, col in ((0.50, "#fff1cf"), (0.22, "#ffe2a0")):
        pass
    c.dither_mask(inside, "#fff1cf", 0.0)
    xs_, ys_ = xs, ys
    m1 = inside & (f > 0.25)
    c.dither_mask(m1, "#ffe9b8", 0.28)
    m2 = inside & (f > 0.55)
    c.dither_mask(m2, "#fff6dc", 0.24)
    return c


def spot_phone():
    c = Canvas(80, 150)
    xs, ys = c.grid()
    t = ys / 149.0
    half = 4 + t * 26
    d = np.abs(xs - 39.5)
    inside = d <= half
    f = (1 - d / np.maximum(half, 1)) * (1 - 0.45 * t)
    c.dither_mask(inside & (f > 0.25), "#ffe9b8", 0.14)
    c.dither_mask(inside & (f > 0.6), "#fff6dc", 0.14)
    return c


def pool_sprite():
    c = Canvas(64, 12)
    m = c.ellipse_mask(31.5, 6, 31, 5)
    xs, ys = c.grid()
    f = 1 - np.hypot((xs - 31.5) / 32, (ys - 6) / 6)
    c.dither_mask(m & (f > 0.0), "#ffe9b8", 0.30)
    c.dither_mask(m & (f > 0.45), "#fff6dc", 0.30)
    return c


# ------------------------------------------------------------------ phone
def phone(season="haunted", ghost=None, bat=None, foot=0):
    hw = season == "haunted"
    WARM = WARM_H if hw else WARM_C
    c = Canvas(PW, PH, INK)
    xs, ys = c.grid()
    # wall + windows band (tops of tall panes)
    c.rect(0, 0, PW, 218, WALL[3])
    c.rect(0, 0, PW, 3, INK)
    for cx in (30, 75, 120, 165):
        c.rect(cx - 17, 0, 34, 15, STEEL[2])
        c.rect(cx - 15, 1, 30, 13, SKY[0])
        c.shade(c.rect_mask(cx - 15, 1, 30, 13), 0.05 + 0.85 * np.clip((ys - 1) / 12.0, 0, 1), SKY)
        r = rnd(cx)
        for _ in range(4):
            c.px(cx - 14 + r.randint(0, 28), 2 + r.randint(0, 6), CREAM)
        c.hline(cx - 15, cx + 14, 13, STEEL[1])
    pm = c.rect_mask(105, 1, 30, 13)
    c.glow(120, 9, 15, "#27407e", 0.9, 4, pm)
    c.blit(spr("moon"), 109, 2, only_mask=pm)
    if bat is not None:
        b = spr("bat-a" if bat[2] else "bat-b")
        c.blit(b, bat[0], bat[1], only_mask=c.rect_mask(60, 1, 30, 13))
    c.rect(0, 14, PW, 2, STEEL[3])
    c.hline(0, PW - 1, 15, STEEL[0])
    # backdrop flat: a painted school and moon, plywood-dark
    m = c.rect_mask(6, 18, 183, 178)
    c.shade(m, 0.28 - 0.10 * np.clip((ys - 18) / 178.0, 0, 1) + 0.06 * np.cos(xs / 5.0), ["#0a0716", "#120d24", "#1b1432", "#271c44"])
    flat = c.rect_mask(24, 44, 148, 68)
    c.shade(flat, 0.15 + 0.7 * np.clip((ys - 44) / 68.0, 0, 1), SKY)
    c.blit(spr("moon"), 138, 52, only_mask=flat)
    sch = spr("school")
    scm = Canvas(sch.w, sch.h)
    scm.blit(sch, 0, 0)
    c.blit(scm, 18, 56, only_mask=flat)
    c.rect(24, 44, 148, 68, WOOD[1], fill=False)
    c.rect(23, 43, 150, 70, INK, fill=False)
    # lamp cone
    for y in range(40, 196):
        t = (y - 40) / 156.0
        half = int(4 + t * 26)
        row = np.zeros((c.h, c.w), bool)
        row[y, 97 - half : 97 + half + 1] = True
        c.dither_mask(row, WARM[0], 0.12 * (1 - 0.7 * t))
    # lighting bar + three lamps
    c.rect(10, 38, 175, 2, STEEL[1])
    c.hline(10, 184, 38, STEEL[3])
    for cx in (50, 97, 144):
        c.rect(cx - 1, 36, 3, 2, STEEL[0])
        c.rect(cx - 4, 40, 9, 4, STEEL[2])
        c.hline(cx - 4, cx + 4, 40, STEEL[4])
        c.rect(cx - 4, 43, 9, 1, STEEL[0])
        c.rect(cx - 2, 44, 5, 1, WARM[3])
    if ghost is not None and hw:
        c.blit(spr("ghost"), 142, 138 + ghost)
    # curtains
    left = [(6, 22), (50, 22), (44, 60), (36, 100), (30, 128), (24, 140), (32, 170), (40, 196), (6, 196)]
    right = [(PW - 1 - x, y) for x, y in left]
    velvet_p(c, left, 0, 0.0)
    velvet_p(c, right, 3, -0.10)
    for x0, x1 in ((6, 30), (PW - 31, PW - 7)):
        c.hline(x0, x1, 138, BRASS[2])
        c.hline(x0, x1, 139, BRASS[1])
        c.hline(x0, x1, 140, BRASS[0])
    # pillars + lintel
    for px0 in (0, PW - 6):
        c.rect(px0, 16, 6, 182, WALL[4])
        c.vline(px0 + 2, 20, 190, WALL[3])
        c.vline(px0 if px0 == 0 else px0 + 5, 16, 197, WALL[5] if px0 == 0 else WALL[2])
    c.rect(0, 16, PW, 4, WALL[4])
    c.hline(0, PW - 1, 16, WALL[5])
    c.hline(0, PW - 1, 19, BRASS[1])
    # valance
    vm = np.zeros((c.h, c.w), bool)
    for x in range(6, PW - 6):
        bot = 34 + int(round(3 * math.sin(math.pi * ((x - 6) % 14) / 14.0)))
        vm[20 : bot + 1, x] = True
    f = 0.40 + 0.22 * np.cos(xs * 2 * np.pi / 7.0) + 0.14 * (1 - (ys - 20) / 14.0)
    c.shade(vm, np.clip(f, 0, 1), VEL)
    for x in range(6, PW - 6):
        bot = 34 + int(round(3 * math.sin(math.pi * ((x - 6) % 14) / 14.0)))
        c.px(x, bot, BRASS[1])
        if (x - 6) % 14 == 0:
            c.vline(x, bot, bot + 2, BRASS[2])
    c.hline(6, PW - 7, 20, VEL[4])
    banner(c, 16, 18, 163, hw, seed=9)
    # stage
    c.rect(0, 196, PW, 3, WOOD[4])
    c.hline(0, PW - 1, 196, WOOD[5])
    c.hline(0, PW - 1, 198, WOOD[2])
    c.rect(0, 199, PW, 15, "#201528")
    for x in range(8, PW, 12):
        c.vline(x, 200, 212, "#1a1022")
    c.hline(0, PW - 1, 199, "#34224a")
    c.hline(0, PW - 1, 212, "#34224a")
    c.rect(0, 213, PW, 1, METAL[0])
    for i, x in enumerate(range(4, PW - 2, 8)):
        on = True if foot == 0 else (i % 2 == 0)
        c.rect(x, 197, 2, 1, WARM[3] if on else WARM[1])
    c.dither(70, 196, 54, 3, INK, 0.45)
    # floor strip + the calm hall-pass tab rows
    c.rect(0, 214, PW, 4, WOOD[2])
    c.hline(0, PW - 1, 214, WOOD[3])
    c.hline(0, PW - 1, 217, WOOD[0])
    c.rect(0, 218, PW, 34, CALM_FILL)
    c.hline(0, PW - 1, 218, "#2c2142")
    if hw:
        wb = spr("web-corner")
        c.blit(wb, 6, 16)
        c.blit(wb, PW - 22, 16, mirror=True)
        garland_phone(c)
        c.blit(spr("pumpkin"), 12, 184)
        c.blit(spr("pumpkin"), PW - 25, 184)
    return c


def garland_phone(c):
    for xx in range(8, 188):
        t = (xx - 8) / 180.0
        c.px(xx, 38 + int(round(3 * math.sin(math.pi * t))), "#8c8678")
    for bx in (13, 21, 30, 167, 175, 184):
        t = (bx - 8) / 180.0
        yy = 38 + int(round(3 * math.sin(math.pi * t))) + 1
        c.hline(bx - 2, bx + 2, yy, INK)
        c.hline(bx - 3, bx + 3, yy + 1, INK)
        c.px(bx - 3, yy, INK)
        c.px(bx + 3, yy, INK)
        c.px(bx - 1, yy + 2, INK)
        c.px(bx + 1, yy + 2, INK)


def velvet_p(c, pts, ph, bias):
    m = c.poly_mask(pts)
    xs, ys = c.grid()
    f = 0.40 + 0.26 * np.cos((xs + ph) * 2 * np.pi / 6.5) + 0.10 * np.cos((xs + ph * 2) * 2 * np.pi / 15.0 + 1.3)
    f += 0.22 * (1 - (ys - 22) / 174.0) + bias
    c.shade(m, np.clip(f, 0, 1), VEL)
    c.fill_mask(m & ~erode(m), VEL[0])


# ------------------------------------------------------------------ elements, frames, tile
def element(kind):
    if kind == "board":
        c = Canvas(96, 78)
        scoreboard(c, 0, 6, True)
        # transparent chain area keeps its pixels; board calm rect
        return c, {"x": 6, "y": 22, "w": 84, "h": 50}
    if kind == "quest":
        c = Canvas(96, 80)
        noticeboard(c, 0, 0, True, h=80)
        return c, {"x": 8, "y": 62, "w": 80, "h": 12}
    c = Canvas(92, 78)
    tuckshop(c, 0, 0, True)
    c.a[56:, :] = 0
    chalkboard(c, 18, 60)
    return c, {"x": 18, "y": 60, "w": 56, "h": 12}


def frame9(kind):
    c = Canvas(48, 48)
    xs, ys = c.grid()
    if kind == "board":
        fill = "#07070c"
        c.rect(0, 0, 48, 48, fill)
        c.rect(0, 0, 48, 48, INK, fill=False)
        for k, col in enumerate((METAL[1], METAL[2])):
            c.rect(1 + k, 1 + k, 46 - 2 * k, 46 - 2 * k, col, fill=False)
        c.hline(1, 46, 1, METAL[4])
        c.vline(1, 1, 46, METAL[3])
        c.rect(5, 5, 38, 38, METAL[0], fill=False)
        c.rect(6, 6, 36, 36, fill, fill=True)
        for t in range(0, 48):
            if t % 8 == 4:
                for (bx, by) in ((t, 2), (t, 44), (2, t), (44, t)):
                    c.rect(bx, by, 2, 2, WARM_H[2])
                    c.px(bx, by, WARM_H[3])
        for (bx, by) in ((2, 2), (44, 2), (2, 44), (44, 44)):
            c.rect(bx - 1, by - 1, 4, 4, WARM_H[1])
            c.rect(bx, by, 2, 2, WARM_H[3])
        # centre must be flat
        c.rect(16, 16, 16, 16, fill)
    elif kind == "quest":
        fill = "#2a1a18"
        c.rect(0, 0, 48, 48, INK)
        c.rect(1, 1, 46, 46, STEEL[3])
        c.rect(2, 2, 44, 44, RED[2])
        fm = c.rect_mask(2, 2, 44, 44)
        c.dither_mask(fm & (((xs + ys) % 3) == 0), RED[1], 0.5)
        c.rect(6, 6, 36, 36, CORK[1])
        r = rnd(5)
        c.shade(c.rect_mask(6, 6, 36, 36), 0.35 + 0.25 * r.rand(48, 48), CORK)
        c.rect(5, 5, 38, 38, RED[0], fill=False)
        # fade cork into the calm fill toward the middle
        d = np.maximum(np.abs(xs - 23.5), np.abs(ys - 23.5))
        inner = c.rect_mask(6, 6, 36, 36)
        c.dither_mask(inner & (d < 14), fill, 0.6)
        c.dither_mask(inner & (d < 11), fill, 1.0)
        c.rect(16, 16, 16, 16, fill)
        for (px_, py_) in ((8, 8), (38, 8), (8, 38), (38, 38)):
            c.rect(px_, py_, 2, 2, "#d33252")
            c.px(px_, py_, "#ff8f8f")
    elif kind == "prize":
        fill = "#1a1020"
        c.rect(0, 0, 48, 48, INK)
        c.rect(1, 1, 46, 46, GRN[3])
        c.hline(1, 46, 1, GRN[5])
        c.vline(1, 1, 46, GRN[4])
        c.vline(46, 1, 46, GRN[2])
        c.hline(1, 46, 46, GRN[2])
        for x in range(4, 48, 8):
            c.vline(x, 2, 45, GRN[2])
        # shutter edge along the top
        for y in range(2, 9):
            c.hline(2, 45, y, STEEL[3] if y % 3 == 0 else STEEL[2])
        c.hline(2, 45, 9, INK)
        c.rect(8, 11, 32, 30, GRN[1])
        c.rect(8, 11, 32, 30, INK, fill=False)
        c.rect(9, 12, 30, 28, fill)
        c.rect(16, 16, 16, 16, fill)
        for (bx, by) in ((3, 12), (43, 12), (3, 42), (43, 42)):
            c.px(bx, by, STEEL[4])
            c.px(bx + 1, by, STEEL[1])
    else:  # paper: dark exercise-book paper, red margin, tape
        fill = "#1b1830"
        c.rect(0, 0, 48, 48, fill)
        c.rect(0, 0, 48, 48, "#2c2548", fill=False)
        for y in range(5, 48, 8):
            c.hline(1, 46, y, "#262046")
        c.vline(9, 1, 46, "#7a1428")
        c.vline(11, 1, 46, "#7a1428") if False else None
        c.rect(16, 16, 16, 16, fill)
        c.hline(16, 31, 21, fill)
        # lines only on the slices; the centre stays flat
        for (tx, ty) in ((2, 1), (40, 1), (2, 43), (40, 43)):
            c.rect(tx, ty, 6, 4, "#b9b29f")
            c.hline(tx, tx + 5, ty, "#e6dcc4")
    return c, fill


def tile_wall():
    c = Canvas(64, 64)
    r = rnd(33)
    c.rect(0, 0, 64, 64, GRN[0])
    for row in range(8):
        y = row * 8
        off = 8 if row % 2 else 0
        for bi in range(4):
            x = bi * 16 + off
            tone = int(r.choice([1, 1, 1, 2, 2]))
            for dx in (0, -64):
                c.rect(x + dx + 1, y, 15, 7, GRN[tone])
                c.hline(x + dx + 1, x + dx + 15, y, GRN[min(tone + 1, 3)] if r.rand() < 0.5 else GRN[tone])
    return c


# ------------------------------------------------------------------ strips and composites
def strip(frames):
    w, h = frames[0].w, frames[0].h
    s = Canvas(w * len(frames), h)
    for i, f in enumerate(frames):
        s.blit(f, i * w, 0)
    return s


def dust_strip(w=50, h=56, n=3):
    base = [(8, 6), (30, 12), (18, 26), (40, 34), (10, 42), (28, 50), (44, 20), (4, 30), (36, 4), (22, 38)]
    frames = []
    for k in range(n):
        f = Canvas(w, h)
        for i, (x, y) in enumerate(base):
            yy = (y + k * 3 + i * 2) % h
            xx = min(w - 1, x + ((k + i) % 2))
            if (i + k) % 3 != 2:
                f.px(xx, yy, "#cfd8ff" if i % 2 else "#8fa2e8")
        frames.append(f)
    return strip(frames)


def layout_composite(base, cabs, slots, on, spot, pool, scale, path, spot_off, pool_off, zones=None):
    im = base.scaled(scale).image()
    for i, (sx, sy) in enumerate(slots):
        if on[i]:
            pl = pool.scaled(scale).image()
            im.alpha_composite(pl, ((sx + pool_off[0]) * scale, (sy + pool_off[1]) * scale))
    for i, (sx, sy) in enumerate(slots):
        if on[i]:
            sp = spot.scaled(scale).image()
            im.alpha_composite(sp, ((sx + spot_off[0]) * scale, (sy + spot_off[1]) * scale))
    for i, (sx, sy) in enumerate(slots):
        cb = cabs[i].scaled(scale).image()
        im.alpha_composite(cb, (sx * scale, sy * scale))
    if zones:
        d = ImageDraw.Draw(im)
        for (x, y, w, h) in zones:
            d.rectangle([x * scale, y * scale, (x + w) * scale - 1, (y + h) * scale - 1], outline=(0, 255, 255, 255))
    im.convert("RGB").save(path)


def build():
    hw_prot = ["#ffd84a", "#7c2eef", "#ffc700", CALM_FILL, "#07070c", "#17122a", SLATE, "#fff8e7", "#ff7a1a"]
    cal_prot = ["#ffd84a", "#7c2eef", "#ffc700", CALM_FILL, "#07070c", "#17122a", SLATE, "#fff8e7", MOONLT[0]]
    hw_prot.append(MOONLT[0])
    # scenes
    hs = snap(scene("haunted"), 48, hw_prot)
    cs = snap(scene("calm"), 40, cal_prot)
    hs.save(os.path.join(OUT, "desk-haunted.png"))
    cs.save(os.path.join(OUT, "desk-calm.png"))
    ph = snap(phone("haunted"), 48, hw_prot)
    pc = snap(phone("calm"), 40, cal_prot)
    ph.save(os.path.join(OUT, "phone-haunted.png"))
    pc.save(os.path.join(OUT, "phone-calm.png"))
    counts = {"desk-haunted": hs.colours(), "desk-calm": cs.colours(), "phone-haunted": ph.colours(), "phone-calm": pc.colours()}
    # cabinets
    keys = ["lastbell", "shadowcore", "std", "mystery"]
    cabs = {}
    for k in keys:
        for on in (False, True):
            cb = cabinet(k, on, True)
            cb.save(os.path.join(OUT, f"cab-{k}-{'on' if on else 'off'}.png"))
            cabs[(k, on)] = cb
        if k == "mystery":
            strip([cab_body("mystery", True, True, f).crop(7, 14, 34, 32) for f in range(3)]).save(os.path.join(OUT, "scr-mystery.png"))
        else:
            strip([screen(k, f, True) for f in range(3)]).save(os.path.join(OUT, f"scr-{k}.png"))
    cabinet("mystery", True, False).save(os.path.join(OUT, "cab-mystery-on-calm.png"))
    cabs[("mystery", "calm")] = cabinet("mystery", True, False)
    strip([cab_body("mystery", True, False, f).crop(7, 14, 34, 32) for f in range(3)]).save(os.path.join(OUT, "scr-mystery-calm.png"))
    spot = spot_sprite()
    spot.save(os.path.join(OUT, "spot-on.png"))
    spot_phone().save(os.path.join(OUT, "spot-phone.png"))
    pool = pool_sprite()
    pool.save(os.path.join(OUT, "pool-on.png"))
    # elements
    els = {}
    for k in ("board", "quest", "prize"):
        e, calm = element(k)
        e.save(os.path.join(OUT, f"el-{k}.png"))
        els[k] = {"file": f"el-{k}.png", "w": e.w, "h": e.h, "calm": calm}
    frames = {}
    for k in ("board", "quest", "prize", "paper"):
        f, fill = frame9(k)
        f.save(os.path.join(OUT, f"frame-{k}.png"))
        frames[k] = {"file": f"frame-{k}.png", "slice": 16, "fill": fill}
    tile_wall().save(os.path.join(OUT, "tile-wall.png"))
    # animations: opaque tiles cut from re-rendered scenes (so whatever overlaps stays on top)
    ghost_frames = strip([scene("haunted", ghost=dy).crop(294, 100, 14, 24) for dy in (0, -1, -2, -1)])
    ghost_frames.save(os.path.join(OUT, "anim-ghost.png"))
    bat_pos = [(236, 10, True), (244, 13, False), (252, 11, True), None]
    bat_frames = strip([scene("haunted", bat=b).crop(228, 3, 34, 31) for b in bat_pos])
    bat_frames.save(os.path.join(OUT, "anim-bats.png"))
    foot_frames = strip([scene("haunted", foot=k).crop(108, 143, 214, 6) for k in (0, 1)])
    foot_frames.save(os.path.join(OUT, "anim-footlights.png"))
    dust_strip(50, 56).save(os.path.join(OUT, "anim-dust.png"))
    pg = strip([phone("haunted", ghost=dy).crop(138, 134, 16, 20) for dy in (0, -1, -2, -1)])
    pg.save(os.path.join(OUT, "anim-ghost-phone.png"))
    pbat = strip([phone("haunted", bat=b).crop(58, 1, 34, 14) for b in [(60, 3, True), (68, 5, False), (76, 3, True), None]])
    pbat.save(os.path.join(OUT, "anim-bats-phone.png"))
    # composites
    slots = [(140, 62), (193, 62), (246, 62)]
    myst_off = cabs[("mystery", False)]
    layout_composite(hs, [cabs[("lastbell", True)], myst_off, myst_off], slots, [True, False, False], spot, pool, 3, os.path.join(OUT, "composite-desk-haunted.png"), (-8, -6), (-8, 76))
    layout_composite(cs, [cabs[("lastbell", True)], myst_off, myst_off], slots, [True, False, False], spot, pool, 3, os.path.join(OUT, "composite-desk-calm.png"), (-8, -6), (-8, 76))
    layout_composite(hs, [cabs[("lastbell", False)], cabs[("shadowcore", True)], cabs[("std", False)]], slots, [False, True, False], spot, pool, 3, os.path.join(OUT, "composite-desk-all.png"), (-8, -6), (-8, 76))
    zr = [(10, 38, 96, 72), (16, 54, 84, 50), (328, 38, 96, 66), (336, 86, 80, 12), (332, 108, 92, 56), (350, 166, 56, 12),
          (136, 38, 162, 18), (150, 172, 134, 9), (120, 184, 194, 44), (140, 152, 48, 15), (193, 152, 48, 15), (246, 152, 48, 15)]
    layout_composite(hs, [cabs[("lastbell", True)], myst_off, myst_off], slots, [True, False, False], spot, pool, 3, os.path.join(OUT, "composite-desk-zones.png"), (-8, -6), (-8, 76), zones=zr)
    layout_composite(ph, [cabs[("lastbell", True)]], [(73, 112)], [True], spot_phone(), pool, 2, os.path.join(OUT, "composite-phone-haunted.png"), (-16, -70), (-8, 76))
    manifest = {
        "concept": "b",
        "title": "The School Hall",
        "desk": {
            "w": W, "h": H, "scale": 3,
            "files": {"haunted": "desk-haunted.png", "calm": "desk-calm.png"},
            "layers": [],
            "cab": {"w": 48, "h": 84, "screen": {"x": 7, "y": 14, "w": 34, "h": 32}, "button": {"x": 0, "y": 0, "w": 0, "h": 0}},
            "slots": [{"x": 140, "y": 62}, {"x": 193, "y": 62}, {"x": 246, "y": 62}],
            "pool": {"dx": -8, "dy": 76, "file": "pool-on.png"},
            "spot": {"dx": -8, "dy": -6, "file": "spot-on.png"},
            "zones": {
                "board": {"x": 10, "y": 38, "w": 96, "h": 72, "calm": {"x": 16, "y": 54, "w": 84, "h": 50}},
                "quest": {"x": 328, "y": 38, "w": 96, "h": 66, "calm": {"x": 336, "y": 86, "w": 80, "h": 12}},
                "prize": {"x": 332, "y": 108, "w": 92, "h": 56, "calm": {"x": 350, "y": 166, "w": 56, "h": 12}},
                "sign": {"x": 136, "y": 38, "w": 162, "h": 18},
                "ticker": {"x": 150, "y": 172, "w": 134, "h": 9},
                "panel": {"x": 120, "y": 184, "w": 194, "h": 44},
                "tickets": [{"x": 140, "y": 152, "w": 48, "h": 15}, {"x": 193, "y": 152, "w": 48, "h": 15}, {"x": 246, "y": 152, "w": 48, "h": 15}],
            },
            "anims": [
                {"file": "anim-ghost.png", "x": 294, "y": 100, "frames": 4, "fps": 4, "season": "haunted"},
                {"file": "anim-bats.png", "x": 228, "y": 3, "frames": 4, "fps": 5, "season": "haunted"},
                {"file": "anim-footlights.png", "x": 108, "y": 143, "frames": 2, "fps": 3, "season": "haunted"},
                {"file": "anim-dust.png", "x": 30, "y": 174, "frames": 3, "fps": 3, "season": "both", "note": "transparent motes in the left moon shaft"},
            ],
            "eggs": [
                {"name": "ghost", "x": 294, "y": 102, "w": 14, "h": 16, "note": "peeks from behind the right curtain (haunted only)"},
                {"name": "keys", "x": 74, "y": 146, "w": 20, "h": 26, "note": "the caretaker's key ring on the mop bucket (a Last Bell nod)"},
                {"name": "clock", "x": 209, "y": 6, "w": 16, "h": 16, "note": "stopped at 3:15, the last bell"},
                {"name": "room000", "x": 396, "y": 130, "w": 26, "h": 22, "note": "ROOM 000 plaque with an arrow, beside the hatch"},
                {"name": "pumpkin", "x": 299, "y": 136, "w": 13, "h": 12, "note": "pumpkin on the stage lip (haunted only)"},
            ],
        },
        "phone": {
            "w": PW, "h": PH, "scale": 2,
            "files": {"haunted": "phone-haunted.png", "calm": "phone-calm.png"},
            "slot": {"x": 73, "y": 112},
            "spot": {"dx": -16, "dy": -70, "file": "spot-phone.png"},
            "pool": {"dx": -8, "dy": 76, "file": "pool-on.png"},
            "zones": {
                "sign": {"x": 16, "y": 18, "w": 163, "h": 18},
                "front": {"x": 0, "y": 196, "w": 195, "h": 18},
                "tabs": {"x": 0, "y": 218, "w": 195, "h": 34},
            },
            "anims": [
                {"file": "anim-ghost-phone.png", "x": 138, "y": 134, "frames": 4, "fps": 4, "season": "haunted"},
                {"file": "anim-bats-phone.png", "x": 58, "y": 1, "frames": 4, "fps": 5, "season": "haunted"},
            ],
        },
        "elements": els,
        "frames": frames,
        "tile": "tile-wall.png",
        "extra": {"mystery_calm": {"cab": "cab-mystery-on-calm.png", "scr": "scr-mystery-calm.png"}, "calm_fill": CALM_FILL},
        "palette": {"colours": max(counts.values()), "per_scene": counts, "notes": "scene colours only (cabinets are separate sprites)"},
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(counts)


if __name__ == "__main__":
    build()
