"""Concept A — The Arcade Hall (Fright Fest event hall).

The room next door to the Pack Room: same camera, plum dot wallpaper, wood wainscot,
brass and bulb marquee, but a hall: chequered arcade floor, three cabinets in pools of light,
a wall-mounted HIGH SCORES board, a CANDY HUNT cork board, a moon window, and an arched
doorway with a miniature of the prize counter inside.

Run from art/:  python3 hall_a.py     -> out/a/*
Deterministic: no random numbers anywhere.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pxkit import *  # noqa
from PIL import Image

OUT = os.path.join(HERE, "out", "a")
FF = "/Users/ozan/Documents/Projects/HallPass/.claude/worktrees/fright-fest-hall/public/events/fright-fest"

# ------------------------------------------------------------------ palette (shared with the Pack Room)
INK = "#0b0612"
WALL = ["#170b1f", "#22102c", "#2e163a", "#3d1e4a", "#4f285c", "#6a3654", "#8a4a5e"]
WOOD = ["#1f0e0b", "#351910", "#4f2716", "#6e3a1e", "#8f5128", "#b8743a"]
GLASS = ["#141a30", "#1a2440", "#2c3a5e", "#5b6d96", "#fff8e7"]
PUR = ["#2d1466", "#4a1fa8", "#7c2eef", "#8b5cf6"]
BRASS = ["#7a3f00", "#b86e00", "#ffc700", "#ffe066"]
YEL = ["#ffc700", "#ffe066", "#fff8e7"]
BULB_OFF = "#7a3f00"
CREAM = "#fff8e7"
PINK, GREEN, GREEN_DK, TEAL, RED, BLUE = "#ff4fd8", "#7fd16a", "#1f7a3a", "#2bb5c4", "#cc2240", "#21417c"
# haunted extras (max 8)
PUMP = ["#4a1500", "#d9600a", "#ff7a1a", "#ffb347"]
BONE = "#f2e8d5"
WEB = "#b9a7cf"
# floor: black tiles reuse the wall ramp; cream tiles are a night-dimmed bone ramp
FLOOR_L = [WALL[2], WALL[3], WALL[4], WALL[5]]
FLOOR_D = [INK, WALL[0], WALL[1], WALL[2]]

DARKER = {}
for ramp_ in (WALL[:5], WOOD, GLASS[:4], PUR, BRASS):
    for i in range(1, len(ramp_)):
        DARKER[ramp_[i]] = ramp_[i - 1]
DARKER.update({WALL[0]: INK, WOOD[0]: INK, GLASS[0]: INK, WALL[5]: WALL[4], WALL[6]: WALL[5], YEL[1]: YEL[0], YEL[0]: BRASS[1], CREAM: YEL[1], BULB_OFF: WOOD[2]})
LIGHTER = {WALL[0]: WALL[1], WALL[1]: WALL[2], WALL[2]: WALL[3], WALL[3]: WALL[4], WALL[4]: WALL[5], WALL[5]: WALL[6],
           WOOD[0]: WOOD[1], WOOD[1]: WOOD[2], WOOD[2]: WOOD[3], WOOD[3]: WOOD[4], WOOD[4]: WOOD[5],
           PUR[0]: PUR[1], PUR[1]: PUR[2], GLASS[1]: GLASS[2], GLASS[2]: GLASS[3]}


def remap(c, mask, mapping):
    out = c.a.copy()
    for a, b in mapping.items():
        m = mask & c.color_mask(a)
        out[m] = rgba(b)
    c.a = out


def relight(c, field, steps=2, protect=None):
    xs, ys = c.grid()
    t = BAYER4[ys % 4, xs % 4]
    for k in range(steps):
        dark = (-field - k) > t
        light = (field - k) > t
        if protect is not None:
            dark &= ~protect
            light &= ~protect
        remap(c, dark, DARKER)
        remap(c, light, LIGHTER)


SPRITE_PAL = [INK, WALL[1], WALL[2], WALL[4], WEB, BONE, CREAM, PUMP[0], PUMP[1], PUMP[2], PUMP[3], GREEN_DK, YEL[0], BRASS[0], BRASS[1], BRASS[3]]


def sprite(name, pal=SPRITE_PAL):
    c = Canvas.load(os.path.join(FF, name + ".png"))
    p = np.array([rgba(q)[:3] for q in pal], dtype=np.int32)
    a = c.a
    m = a[:, :, 3] > 0
    px = a[m][:, :3].astype(np.int32)
    idx = ((px[:, None, :] - p[None, :, :]) ** 2).sum(-1).argmin(1)
    out = a.copy()
    out[m, :3] = p[idx].astype(np.uint8)
    out[m, 3] = 255
    c.a = out
    return c


def dimmed(c, t=0.58, toward=INK):
    """Darken every colour toward `toward` (a fixed colour map, no new texture): the 'off' state."""
    out = c.copy()
    m = out.a[:, :, 3] > 0
    cache = {}
    for y, x in zip(*np.nonzero(m)):
        k = tuple(int(v) for v in out.a[y, x, :3])
        if k not in cache:
            cache[k] = rgba(mix("#%02x%02x%02x" % k, toward, t))
        out.a[y, x, :3] = cache[k][:3]
    return out


def season_cols(hw):
    if hw:
        return dict(on=PUMP[2], hot=PUMP[3], off=PUMP[0], spill=[PUMP[1], PUMP[2], PUMP[3]], lamp=PUMP[3])
    return dict(on=YEL[0], hot=YEL[1], off=BULB_OFF, spill=[YEL[0], YEL[1], CREAM], lamp=YEL[1])


# ------------------------------------------------------------------ architecture
def wall(c, x, y, w, h, wain_y):
    c.rect(x, y, w, h, WALL[2])
    for yy in range(y + 3, wain_y - 2, 8):
        for xx in range(x + ((yy // 8) % 2) * 4 + 2, x + w, 8):
            c.px(xx, yy, WALL[3]).px(xx + 1, yy, WALL[3]).px(xx, yy + 1, WALL[3]).px(xx + 1, yy + 1, WALL[3])
    for xx in range(x + 7, x + w, 16):
        c.dither(xx, y, 1, wain_y - y, WALL[1], 0.5)
    c.rect(x, wain_y, w, 3, WOOD[3])
    c.hline(x, x + w - 1, wain_y, WOOD[5])
    c.hline(x, x + w - 1, wain_y + 2, WOOD[1])
    c.rect(x, wain_y + 3, w, y + h - wain_y - 3, WOOD[2])
    for xx in range(x, x + w, 9):
        c.vline(xx, wain_y + 3, y + h - 1, WOOD[1])
        c.vline(xx + 1, wain_y + 3, y + h - 1, WOOD[3])
    for xx in range(x + 3, x + w - 6, 18):
        c.rect(xx, wain_y + 8, 14, max(3, y + h - wain_y - 14), WOOD[1], fill=False)
    # skirting
    c.rect(x, y + h - 4, w, 4, WOOD[1])
    c.hline(x, x + w - 1, y + h - 4, WOOD[4])
    c.hline(x, x + w - 1, y + h - 1, WOOD[0])


def ceiling(c, w, h=7):
    c.rect(0, 0, w, h, INK)
    c.hline(0, w - 1, h - 1, WOOD[2])
    c.hline(0, w - 1, h - 2, WOOD[1])
    for xx in range(4, w, 22):
        c.rect(xx, h - 2, 6, 2, WOOD[3])


CARPET = dict(  # all from the shared palette: no new colours
    base=[WALL[0], WALL[1], WALL[2]],
    star=[WALL[2], WALL[3], WALL[4]],
    teal=[GLASS[0], GLASS[1], GLASS[2]],
    gold=[WOOD[1], WOOD[2], WOOD[3]])
WARM = {True: dict(base=[WALL[3], WALL[4], WALL[5]], star=[WALL[5], WALL[6], WOOD[4]],
                   teal=[WOOD[3], WOOD[4], WOOD[5]], gold=[WOOD[3], WOOD[4], WOOD[5]]),
        False: dict(base=[WOOD[1], WOOD[2], WOOD[3]], star=[WOOD[3], WOOD[4], WOOD[5]],
                    teal=[WOOD[3], WOOD[4], WOOD[5]], gold=[WOOD[3], WOOD[4], WOOD[5]])}
MOTIF = {"star": [(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)], "moon": [(0, 0), (1, 0), (0, 1), (0, 2), (1, 2)],
         "teal": [(0, 0), (1, 0), (0, 1), (1, 1)], "gold": [(0, 0), (1, 0), (0, 1), (1, 1)]}
ORDER = ["star", "teal", "moon", "gold"]


def floor(c, seam, cx, slots, spill, flick, hw):
    """Arcade carpet: navy-plum with a sparse star / moon / candy-dot motif on an offset grid;
    motif rows spread apart toward the viewer. Pools and the door light only lift value."""
    xs, ys = c.grid()
    reg = c.rect_mask(0, seam, c.w, c.h - seam)
    kinds = {k: np.zeros(xs.shape, bool) for k in ("star", "teal", "gold")}
    spacing = [11, 13, 15, 17, 19, 21]
    for r, (dy_, sp_) in enumerate(zip([5, 16, 30, 47, 68, 92], spacing)):
        y0 = seam + dy_
        if y0 > c.h - 3:
            break
        n = int(c.w / sp_) + 3
        for k in range(-n, n):
            x0 = int(round(cx + (k + 0.5 * (r % 2)) * sp_))
            kind = ORDER[(k + r) % 4]
            for (mx, my) in MOTIF[kind]:
                px, py = x0 + mx, y0 + my
                if 0 <= px < c.w and 0 <= py < c.h:
                    kinds["star" if kind == "moon" else kind][py, px] = True
    f = np.full(xs.shape, 0.36, np.float32)
    f -= 0.14 * np.clip(1 - (ys - seam) / 6.0, 0, 1)
    f -= 0.25 * np.clip(np.abs(xs - cx) / 230.0 - 0.3, 0, 1) + 0.08 * np.clip((ys - seam) / 74.0, 0, 1)
    for sx in slots:
        dd = np.sqrt(((xs - (sx + 29)) / 44.0) ** 2 + ((ys - (seam + 2)) / 12.0) ** 2)
        f += 0.42 * np.clip(1 - dd, 0, 1)
    anym = kinds["star"] | kinds["teal"] | kinds["gold"]
    c.shade(reg & ~anym, f, CARPET["base"])
    for k in kinds:
        c.shade(reg & kinds[k], f, CARPET[k])
    if spill:
        ox0, ox1 = spill
        t = np.clip((ys - seam) / 56.0, 0, 1)
        left = ox0 - 3 - 22 * t
        right = ox1 + 3 + 24 * t
        inside = (ys >= seam) & (xs >= left) & (xs <= right)
        sp = np.where(inside, (1 - t) ** 0.9, 0.0) * (1.0 - 0.15 * flick)
        # two bands (+ a 1-2 px ordered seam): the carpet itself, lifted and warmed
        fw = np.where(sp > 0.5, np.where(sp > 0.58, 1.0, 0.75), 0.5)
        W = WARM[hw]
        sm = reg & (sp > 0.12)
        c.shade(sm & ~anym, fw, W["base"])
        for k in kinds:
            c.shade(sm & kinds[k], fw, W[k])
    return f


# ------------------------------------------------------------------ signs
def sign(c, x, y, w, h, hw, phase=0, only_bulbs=False, tsize=30, wm_y=5, txt_y=15):
    s = season_cols(hw)
    if not only_bulbs:
        c.rect(x, y, w, h, PUR[0])
        c.rect(x, y, w, h, INK, fill=False)
        c.rect(x + 1, y + 1, w - 2, h - 2, PUR[1], fill=False)
        bx, by, bw, bh = x + 5, y + 5, w - 10, h - 10
        m = c.rect_mask(bx, by, bw, bh)
        xs, ys = c.grid()
        f = 1 - np.sqrt(((xs - (bx + bw / 2)) / (bw / 2)) ** 2 + ((ys - (by + bh / 2)) / (bh / 1.2)) ** 2)
        c.shade(m, np.clip(f, 0, 1) * 0.75 + 0.05, [WALL[1], PUR[0], PUR[1]])
        w1, _ = c.text(x + w // 2 - 3, y + wm_y, "hallpass", CREAM, "Pixelify", 10, 700, "mt")
        dx = x + w // 2 - 3 + w1 // 2 + 1
        c.rect(dx, y + wm_y + 3, 2, 2, YEL[0])
        mk, _ = text_mask(c.w, c.h, x + w // 2, y + txt_y, "FRIGHT FEST", "Jersey10", tsize, None, "mt")
        c.fill_mask(np.roll(np.roll(mk, 2, axis=0), 2, axis=1) & ~mk, INK)
        c.fill_mask(np.roll(np.roll(mk, 1, axis=0), 1, axis=1) & ~mk, PUR[2])
        c.fill_mask(mk, s["on"])
        c.fill_mask(mk & ~np.roll(mk, 2, axis=0), s["hot"])
    pts = []
    for bx in range(x + 2, x + w - 1, 4):
        pts.append((bx, y + 2))
    for by in range(y + 6, y + h - 2, 4):
        pts.append((x + w - 3, by))
    for bx in range(x + w - 3, x + 1, -4):
        pts.append((bx, y + h - 3))
    for by in range(y + h - 7, y + 3, -4):
        pts.append((x + 2, by))
    for i, (bx, by) in enumerate(pts):
        on = (i + phase) % 3 != 0
        c.rect(bx, by, 2, 2, s["on"] if on else s["off"])
        if on:
            c.px(bx, by, s["hot"])


def ticker(c, x, y, w, h):
    c.rect(x, y, w, h, BRASS[1])
    c.hline(x, x + w - 1, y, BRASS[3])
    c.hline(x, x + w - 1, y + h - 1, BRASS[0])
    c.vline(x, y, y + h - 1, BRASS[2])
    c.vline(x + w - 1, y, y + h - 1, BRASS[0])
    c.rect(x + 1, y + 1, w - 2, h - 2, INK)
    xs, ys = c.grid()
    m = c.rect_mask(x + 1, y + 1, w - 2, h - 2) & (xs % 2 == 0) & (ys % 2 == 0)
    c.fill_mask(m, WALL[0])  # LED dot grid, one ramp step above the black
    for bx in (x + 8, x + w - 10):
        c.rect(bx, y - 2, 2, 2, BRASS[0])
        c.px(bx, y - 2, BRASS[2])


def moon_window(c, x, y, w=28, h=44):
    xs, ys = c.grid()
    cxw = x + (w - 1) / 2.0
    rx = (w - 1) / 2.0
    arch = c.rect_mask(x, y + int(rx) + 1, w, h - int(rx) - 1) | c.ellipse_mask(cxw, y + rx + 0.5, rx - 0.5, rx - 0.5)
    outer = arch | dilate(dilate(arch))
    ring = outer & ~arch
    c.fill_mask(ring, WOOD[2])
    lit = ring & (~np.roll(ring, 1, axis=1) | ~np.roll(ring, 1, axis=0))
    c.fill_mask(lit, WOOD[4])
    c.fill_mask(ring & (~np.roll(ring, -1, axis=1) | ~np.roll(ring, -1, axis=0)) & ~lit, WOOD[1])
    c.fill_mask(dilate(arch) & ~arch, BRASS[1])
    sky = c.shade.__self__  # noqa (keep linter quiet)
    g = c.copy()
    g.shade(arch, np.clip(0.15 + (ys - y) / float(h) * 0.9, 0, 1), [WALL[1], PUR[0], PUR[1]])
    c.a[arch] = g.a[arch]
    for sx, sy in [(4, 8), (9, 4), (19, 12), (15, 18), (6, 20), (22, 6)]:
        c.px(x + sx, y + sy + 4, CREAM)
    # yellow moon (the homepage moon, small)
    mx, my = x + 17, y + 12
    m = c.ellipse_mask(mx, my, 4, 4)
    c.shade(m, np.clip(1 - np.sqrt((xs - mx + 1.5) ** 2 + (ys - my + 1.5) ** 2) / 8.0, 0, 1), [BRASS[1], YEL[0], YEL[1], CREAM], dither=False)
    c.dither_mask(dilate(m) & ~m & arch, YEL[0], 0.3)
    # the haunted school across the road: silhouette with a bell tower
    base = y + h - 12
    c.rect(x + 1, base + 5, w - 2, 12, INK)
    c.rect(x + 8, base - 7, 8, 14, INK)
    c.poly([(x + 7, base - 7), (x + 12, base - 13), (x + 17, base - 7)], INK)
    c.px(x + 12, base - 14, INK).px(x + 12, base - 15, INK)
    c.rect(x + 11, base - 4, 2, 3, YEL[0])
    c.rect(x + 19, base + 7, 2, 2, YEL[0]).rect(x + 4, base + 8, 2, 2, YEL[0])
    # mullions + sheen
    c.vline(int(cxw), y + int(rx), y + h - 1, WOOD[1])
    c.hline(x, x + w - 1, y + int(h * 0.62), WOOD[1])
    sh = arch & ((((xs - x) * 2 + (ys - y)) % 23) < 2)
    c.dither_mask(sh, GLASS[3], 0.35)
    return arch


def board(c, x, y, hw, w=94, h=96):
    """The wall-mounted HIGH SCORES board. Calm screen = (7,20,80,68) relative."""
    s = season_cols(hw)
    c.rect(x, y + 6, w, h - 6, GLASS[1])
    c.hline(x, x + w - 1, y + 6, GLASS[3])
    c.hline(x, x + w - 1, y + 7, GLASS[2])
    c.vline(x, y + 6, y + h - 1, GLASS[2])
    c.hline(x, x + w - 1, y + h - 1, GLASS[0])
    c.hline(x, x + w - 1, y + h - 2, GLASS[0])
    c.vline(x + w - 1, y + 6, y + h - 1, GLASS[0])
    c.rect(x, y + 6, w, h - 6, INK, fill=False)
    # header marquee plate
    c.rect(x + 4, y + 8, w - 8, 11, PUR[0])
    c.rect(x + 4, y + 8, w - 8, 11, INK, fill=False)
    mk, _ = text_mask(c.w, c.h, x + w // 2, y + 9, "HIGH SCORES", "Jersey10", 16, None, "mt")
    c.fill_mask(np.roll(np.roll(mk, 1, axis=0), 1, axis=1) & ~mk, INK)
    c.fill_mask(mk, s["on"])
    c.fill_mask(mk & ~np.roll(mk, 1, axis=0), s["hot"])
    # screen bezel and calm screen
    c.rect(x + 6, y + 19, w - 12, 70, INK)
    c.rect(x + 7, y + 20, 80, 68, INK)
    for yy in range(y + 23, y + 88, 4):
        c.hline(x + 7, x + 86, yy, WALL[0])  # faint scanlines, one step up from the black
    c.rect(x + 5, y + 18, w - 10, 72, GLASS[0], fill=False)
    # bottom plate: brass name strip and a corner lamp
    c.rect(x + 28, y + 91, 38, 3, BRASS[1])
    c.hline(x + 28, x + 65, y + 91, BRASS[3])
    c.rect(x + 8, y + 90, 5, 4, s["on"])
    c.px(x + 8, y + 90, s["hot"])
    c.px(x + 7, y + 90, GLASS[3]).px(x + 13, y + 90, GLASS[3]) if False else None
    for bx, by in [(2, 8), (w - 4, 8), (2, h - 5), (w - 4, h - 5)]:
        c.rect(x + bx, y + by, 2, 2, BRASS[2])
        c.px(x + bx + 1, y + by + 1, BRASS[0])
    tx_, ty_ = x + w // 2 - 4, y - 1
    for (a_, b_, yy_, col_) in [(0, 8, 0, INK), (1, 7, 1, BRASS[3]), (1, 7, 2, YEL[0]), (1, 7, 3, YEL[0]), (2, 6, 4, BRASS[1]), (3, 5, 5, BRASS[1]), (4, 4, 6, BRASS[1]), (3, 5, 7, BRASS[2]), (2, 6, 8, BRASS[0])]:
        c.hline(tx_ + a_, tx_ + b_, ty_ + yy_, col_)
    c.px(tx_, ty_ + 2, BRASS[1]).px(tx_ + 8, ty_ + 2, BRASS[1]).px(tx_ + 2, ty_ + 2, CREAM)


def quest(c, x, y, w=92, h=42, hw=True):
    """CANDY HUNT cork noticeboard. Calm felt strip = (6, h-18, w-12, 14) relative."""
    c.rect(x, y, w, h, WOOD[1])
    c.hline(x, x + w - 1, y, WOOD[4])
    c.vline(x, y, y + h - 1, WOOD[3])
    c.hline(x, x + w - 1, y + h - 1, WOOD[0])
    c.vline(x + w - 1, y, y + h - 1, WOOD[0])
    c.rect(x, y, w, h, INK, fill=False)
    c.rect(x + 3, y + 3, w - 6, h - 6, WOOD[3])
    c.dither(x + 3, y + 3, w - 6, h - 6, WOOD[4], 0.25)
    c.dither_mask(c.rect_mask(x + 3, y + 3, w - 6, h - 6), WOOD[2], 0.14, 2, 1)
    c.hline(x + 3, x + w - 4, y + 3, WOOD[2])
    c.vline(x + 3, y + 3, y + h - 4, WOOD[2])
    # header paper
    px_, pw = x + w // 2 - 32, 64
    c.rect(px_ + 1, y + 3, pw, 10, WOOD[1])
    c.rect(px_, y + 2, pw, 10, CREAM)
    c.text(x + w // 2, y + 4, "CANDY HUNT", PUR[0], "Silkscreen", 8, None, "mt")
    c.px(x + w // 2, y + 1, RED).px(x + w // 2 - 1, y + 1, CREAM).px(x + w // 2, y + 2, RED)
    # three blank pinned slips
    fy = h - 18
    top = y + 15
    sh = max(8, (y + fy - 2) - top)
    sw = (w - 12 - 2 * 6) // 3
    pinc = [RED, YEL[0], TEAL]
    for i in range(3):
        sx = x + 6 + i * (sw + 6)
        sy = top + (i % 2)
        c.rect(sx + 1, sy + 1, sw, sh, WOOD[1])
        c.rect(sx, sy, sw, sh, CREAM)
        c.hline(sx + 1, sx + sw - 2, sy + sh - 1, "#dccfbf")
        c.px(sx + sw // 2, sy, pinc[i]).px(sx + sw // 2 - 1, sy, CREAM).px(sx + sw // 2, sy + 1, WOOD[1])
    # calm felt label strip
    c.rect(x + 5, y + fy - 1, w - 10, 16, WOOD[1], fill=False)
    c.rect(x + 6, y + fy, w - 12, 14, WALL[0])
    for bx in (x + 3, x + w - 5):
        c.rect(bx, y + fy + 5, 2, 3, BRASS[2])


def mini_pack(c, x, y, body, hi, emblem):
    c.rect(x, y, 4, 6, body)
    c.hline(x, x + 3, y, hi)
    c.hline(x, x + 3, y + 5, hi)
    c.px(x + 1, y + 2, emblem).px(x + 2, y + 3, emblem)
    c.px(x, y + 1, hi)


MINI = [(WALL[1], PUR[2], YEL[1]), (PUR[2], PUR[3], YEL[0]), (BLUE, TEAL, CREAM), (PINK, PUR[3], GREEN), (RED, CREAM, TEAL)]


def mini_shelf(c, x, y, w, h, seed):
    c.rect(x, y, w, h, WOOD[1])
    c.hline(x, x + w - 1, y, WOOD[4])
    c.vline(x, y, y + h - 1, WOOD[2])
    c.rect(x + 2, y + 2, w - 4, h - 4, WALL[0])
    c.hline(x + 2, x + w - 3, y + 2, YEL[1])
    rows = 3
    rh = (h - 4) // rows
    k = seed
    for r in range(rows):
        sy = y + 2 + (r + 1) * rh - 1
        c.rect(x + 2, sy, w - 4, 1, WOOD[3])
        cx = x + 3
        while cx + 4 <= x + w - 3:
            if (k % 7) == 3:
                c.circle(cx + 2, sy - 3, 2, YEL[0])
                c.px(cx + 1, sy - 4, YEL[1])
                cx += 6
            else:
                b, hi, em = MINI[k % len(MINI)]
                mini_pack(c, cx, sy - 6, b, hi, em)
                cx += 5
            k += 1


def door(c, x, y, hw, flick=0, with_sign=True):
    """Arched doorway to the prize counter. (x, y) = top-left of the 94 x 132 zone.
    Opening = (x+8, y+28, 76, 104). Returns (opening rect, arch mask)."""
    s = season_cols(hw)
    ox, oy, ow, oh = x + 8, y + 28, 76, 104
    rx = (ow - 1) / 2.0
    arch = c.rect_mask(ox, oy + 38, ow, oh - 38) | c.ellipse_mask(ox + rx, oy + rx, rx - 0.5, rx - 0.5)
    xs, ys = c.grid()
    # ---- interior: the Pack Room in miniature
    t = Canvas(c.w, c.h)
    cx = ox + 38
    lampy = oy + 11
    rad = np.sqrt(((xs - cx) / 46.0) ** 2 + ((ys - (oy + 40)) / 62.0) ** 2)
    t.shade(arch, np.clip(1 - rad, 0, 1) * 0.9 + 0.1, [WALL[2], WALL[3], WALL[4], WALL[5], WALL[6]])
    for yy in range(oy + 6, oy + 90, 8):
        for xx in range(ox + ((yy // 8) % 2) * 4 + 2, ox + ow, 8):
            if not (0 <= xx < t.w and 0 <= yy < t.h):
                continue
            cur = t.get(xx, yy)
            col = "#%02x%02x%02x" % cur[:3]
            if cur[3] and col in LIGHTER:
                t.px(xx, yy, LIGHTER[col])
    # little marquee on the back wall
    t.rect(cx - 15, oy + 28, 30, 9, PUR[0])
    t.rect(cx - 15, oy + 28, 30, 9, INK, fill=False)
    t.text(cx, oy + 30, "PACKS", s["on"], "Micro5", 10, None, "mt")
    mini_shelf(t, ox + 2, oy + 42, 24, 44, 0)
    mini_shelf(t, ox + ow - 26, oy + 42, 24, 44, 3)
    # pendant lamp
    t.vline(cx, oy, lampy - 1, INK)
    t.rect(cx - 1, lampy - 1, 3, 2, BRASS[1])
    t.poly([(cx - 3, lampy + 1), (cx + 3, lampy + 1), (cx + 7, lampy + 6), (cx - 7, lampy + 6)], PUR[1])
    t.line(cx - 3, lampy + 1, cx - 7, lampy + 6, PUR[3])
    t.hline(cx - 6, cx + 6, lampy + 7, s["lamp"] if not flick else s["on"])
    t.rect(cx - 2, lampy + 7, 5, 2, CREAM if not flick else s["hot"])
    # counter
    ct = oy + 86
    t.rect(ox, ct, ow, 4, WOOD[4])
    t.hline(ox, ox + ow - 1, ct, WOOD[5])
    t.rect(ox, ct + 4, ow, 3, WOOD[3])
    t.hline(ox, ox + ow - 1, ct + 4, WOOD[5])
    t.rect(ox, ct + 7, ow, oh - 7 - 86 + 0, GLASS[1])
    t.rect(ox, ct + 7, ow, oy + oh - ct - 7, GLASS[1])
    for gx in range(ox + 3, ox + ow - 12, 22):
        t.rect(gx, ct + 9, 18, oy + oh - ct - 14, GLASS[2], fill=False)
        t.hline(gx + 1, gx + 8, ct + 10, GLASS[3])
    t.rect(ox, oy + oh - 3, ow, 3, WOOD[1])
    # riser + the featured pack, a bell
    t.rect(cx - 9, ct - 3, 18, 3, PUR[0])
    t.hline(cx - 9, cx + 8, ct - 3, PUR[3])
    t.rect(cx - 4, ct - 17, 8, 14, WALL[1])
    t.rect(cx - 4, ct - 17, 8, 14, PUR[2], fill=False)
    t.circle(cx, ct - 10, 2, YEL[1])
    t.rect(ox + ow - 14, ct - 3, 6, 3, BRASS[2])
    t.rect(ox + ow - 13, ct - 5, 4, 2, BRASS[3])
    # warm cone from the lamp
    cone = np.zeros(xs.shape, bool)
    tt = np.clip((ys - (lampy + 8)) / float(ct - lampy - 8), 0, 1)
    half = 4 + tt * 30
    inside = (ys >= lampy + 8) & (ys <= ct) & (np.abs(xs - cx) <= half)
    edge = 1 - np.abs(xs - cx) / np.maximum(half, 1)
    fld = np.where(inside, np.clip(edge * 1.5, 0, 1) * (2.0 - 0.5 * flick) * (1 - 0.3 * tt), 0.0)
    relight(t, fld, steps=2)
    t.a[~arch] = 0
    c.blit(t, 0, 0)
    # ---- frame
    outer = arch | dilate(dilate(dilate(dilate(arch))))
    ring = outer & ~arch
    c.fill_mask(ring, WOOD[3])
    lit = ring & (~np.roll(ring, 1, axis=1) | ~np.roll(ring, 1, axis=0))
    shd = ring & (~np.roll(ring, -1, axis=1) | ~np.roll(ring, -1, axis=0))
    c.fill_mask(shd, WOOD[1])
    c.fill_mask(lit, WOOD[5])
    c.fill_mask(dilate(arch) & ~arch, BRASS[2])
    c.fill_mask(dilate(arch) & ~arch & ~np.roll(arch, 1, axis=1) & ~np.roll(arch, 1, axis=0), BRASS[3])
    c.rect(cx - 3, oy - 5, 7, 6, BRASS[1])
    c.rect(cx - 3, oy - 5, 7, 6, BRASS[3], fill=False)
    c.px(cx, oy - 3, BRASS[0]).px(cx, oy - 2, BRASS[0])
    for sy in (oy + 50, oy + 70, oy + 90):
        c.px(ox - 3, sy, BRASS[2]).px(ox + ow + 2, sy, BRASS[2])
    # sill
    c.rect(x + 2, y + 130, 90, 2, WOOD[1])
    c.hline(x + 2, x + 91, y + 130, WOOD[3])
    if with_sign:
        sx, sy, sw, sh = x, y + 2, 94, 22
        c.rect(sx, sy, sw, sh, PUR[0])
        c.rect(sx, sy, sw, sh, INK, fill=False)
        c.rect(sx + 1, sy + 1, sw - 2, sh - 2, PUR[1], fill=False)
        c.rect(sx + 4, sy + 4, sw - 8, sh - 8, WALL[1])
        mk, _ = text_mask(c.w, c.h, sx + sw // 2, sy + 7, "PRIZE COUNTER", "Jersey10", 13, None, "mt")
        c.fill_mask(np.roll(np.roll(mk, 1, axis=0), 1, axis=1) & ~mk, INK)
        c.fill_mask(mk, s["on"])
        c.fill_mask(mk & ~np.roll(mk, 1, axis=0), s["hot"])
        for ax in (sx + 7, sx + sw - 12):
            for i in range(3):
                c.hline(ax + i, ax + 4 - i, sy + 7 + i, s["hot"])
        i = 0
        for bx in range(sx + 2, sx + sw - 3, 4):
            for by in (sy + 1, sy + sh - 3):
                c.rect(bx, by, 2, 2, s["on"] if (i % 3) else s["off"])
            i += 1
        for by in (sy + 5, sy + 9, sy + 13, sy + 17):
            for bx in (sx + 1, sx + sw - 3):
                c.rect(bx, by, 2, 2, s["on"] if (by % 3) else s["off"])
    return (ox, oy, ow, oh), arch


# ------------------------------------------------------------------ Halloween props
def candy_corn_bunting(c, x0, x1, y):
    c.line(x0, y, x1, y + 1, INK)
    for xx in range(x0 + 2, x1 - 5, 8):
        sag = 1 if ((xx - x0) // 8) % 2 else 0
        yy = y + sag
        c.hline(xx, xx + 5, yy + 1, CREAM)
        c.hline(xx + 1, xx + 4, yy + 2, PUMP[2])
        c.hline(xx + 1, xx + 4, yy + 3, PUMP[2])
        c.hline(xx + 2, xx + 3, yy + 4, YEL[0])
        c.px(xx + 2, yy + 5, YEL[0])


def hanging_spider(c, x, top, bottom):
    c.vline(x + 4, top, bottom, WEB)
    c.blit(sprite("spider"), x, bottom)


def plaque000(c, x, y):
    c.rect(x, y, 18, 10, INK)
    c.rect(x + 1, y + 1, 16, 8, BRASS[1])
    c.hline(x + 1, x + 16, y + 1, BRASS[3])
    c.rect(x + 2, y + 2, 14, 6, INK)
    for i in range(3):  # three slashed zeros, 3 x 4 each
        zx = x + 4 + i * 4
        c.rect(zx, y + 3, 3, 4, CREAM, fill=False)
        c.px(zx + 1, y + 5, CREAM)
    c.px(x + 1, y + 1, BRASS[0]).px(x + 16, y + 8, BRASS[0])


# ------------------------------------------------------------------ scenes
DESK = dict(W=434, H=230, seam=156, rail=112, cx=217,
            sign=(142, 4, 150, 38), ticker=(156, 44, 122, 10),
            slots=[(118, 60), (188, 60), (258, 60)],
            board=(8, 10), quest=(10, 110), door=(334, 24), window=(108, 8),
            panel=(112, 166, 210, 58))
PHONE = dict(W=195, H=236, seam=192, rail=150, cx=97,
             sign=(22, 4, 150, 30), ticker=(34, 36, 126, 9),
             slots=[(68, 96)],
             board=(-72, 90), quest=None, door=(170, 60), window=(3, 40),
             panel=(0, 198, 195, 38))


def build(kind, hw, flick=0, ghost=0):
    L = DESK if kind == "desk" else PHONE
    W, H, seam = L["W"], L["H"], L["seam"]
    c = Canvas(W, H, INK)
    xs, ys = c.grid()
    wall(c, 0, 0, W, seam, L["rail"])
    ceiling(c, W)
    dx, dy = L["door"]
    sx, sy, sw, sh = L["sign"]
    wxx, wyy = L["window"]
    # ---- light story on the wall: cool night ambient, orange sign glow, amber doorway
    fld = np.full(xs.shape, -0.55, np.float32)
    fld += 1.7 * np.clip(1 - np.sqrt(((xs - (dx + 47)) / 120.0) ** 2 + ((ys - (dy + 70)) / 95.0) ** 2), 0, 1) * (1 - 0.1 * flick)
    fld += 0.9 * np.clip(1 - np.sqrt(((xs - (sx + sw / 2)) / 105.0) ** 2 + ((ys - (sy + 20)) / 48.0) ** 2), 0, 1)
    relight(c, fld, steps=2)
    wallm = c.rect_mask(0, 8, W, seam - 8)
    c.glow(wxx + 14, wyy + 20, 26, GLASS[2], 0.55, 3, m=wallm)  # the moon's cold light
    if hw:
        c.glow(sx + sw / 2, sy + 20, 70, PUMP[0], 0.30, 3, m=wallm)
    # ---- fittings
    moon_window(c, wxx, wyy)
    bx, by = L["board"]
    board(c, bx, by, hw)
    if L["quest"]:
        qx, qy = L["quest"]
        quest(c, qx, qy, hw=hw)
    door(c, dx, dy, hw, flick)
    sign(c, sx, sy, sw, sh, hw, 0, tsize=30 if kind == "desk" else 20, wm_y=5 if kind == "desk" else 4, txt_y=15 if kind == "desk" else 13)
    tx, ty, tw, th = L["ticker"]
    ticker(c, tx, ty, tw, th)
    if kind == "desk":
        plaque000(c, 317, 127)
    # ---- floor
    spill = (dx + 8, dx + 84)
    floor(c, seam, L["cx"], [s_[0] for s_ in L["slots"]], spill, flick, hw)
    # cabinet foot shadows (light from the top-left: shadow falls to the right)
    for (sxx, _) in L["slots"]:
        m = c.ellipse_mask(sxx + 34, seam + 2, 33, 3)
        c.dither_mask(m & (ys >= seam), INK, 0.55)
        m2 = c.ellipse_mask(sxx + 36, seam + 3, 26, 2)
        c.dither_mask(m2 & (ys >= seam), INK, 0.4)
    # calm dark rug (the panel) and doormat
    px_, py_, pw_, ph_ = L["panel"]
    if kind == "desk":
        c.rect(px_ - 2, py_ - 2, pw_ + 4, ph_ + 4, WALL[2])
        for xx in range(px_ - 2, px_ + pw_ + 2):
            if xx % 4 < 2:
                c.px(xx, py_ - 2, WALL[1]).px(xx, py_ + ph_ + 1, WALL[1])
        c.rect(px_, py_, pw_, ph_, WALL[0])
        mx, my, mw, mh = dx + 12, seam + 4, 70, 14
        c.rect(mx - 1, my - 1, mw + 2, mh + 2, WALL[2])
        c.rect(mx, my, mw, mh, WALL[0])
    else:
        c.rect(0, 196, W, 2, WALL[2])
        for xx in range(W):
            if xx % 4 < 2:
                c.px(xx, 196, WALL[1])
        c.rect(0, 198, W, H - 198, WALL[0])
    # ---- haunted overlay props (8): 2 webs, spider, ghost, 2 pumpkins, bunting, bat
    if hw:
        webs = [(0, 8, False), (W - 16, 8, True)] if kind == "desk" else [(0, 8, False), (W - 16, 8, True)]
        for wx, wy, fl in webs:
            c.blit(sprite("web-corner"), wx, wy, mirror=fl)
        if kind == "desk":
            hanging_spider(c, 284, 42, 47)
            c.blit(sprite("ghost"), 313, 90 + ghost)
            c.blit(sprite("pumpkin"), 104, 145)
            c.blit(sprite("pumpkin-sm"), 322, 147)
            candy_corn_bunting(c, 322, 430, 9)
            c.blit(sprite("bat-perch"), 300, 7)
        else:
            hanging_spider(c, 168, 34, 40)
            c.blit(sprite("pumpkin"), 30, 179)
    return c


# ------------------------------------------------------------------ cabinets
CAB_W, CAB_H = 58, 96
SCR = (8, 18, 42, 32)
BTN = (5, 68, 48, 15)

SPEC = {
    "lastbell": dict(body=["#161614", "#2e332d", "#4a5448", "#6f7a68"], bezel="#1b1d1a", edge="#44503f", panel=["#2e332d", "#4a5448", "#6f7a68"],
                     stick=RED, btn=[CREAM, RED, YEL[0]], glow="#9ab090", rim="#9aa690", plate="#2e332d"),
    "shadowcore": dict(body=["#050308", "#0b0713", "#150f22", "#2a2140"], bezel="#050308", edge="#f43f5e", panel=["#0b0713", "#1a1424", "#2e2540"],
                       stick="#ff4f8b", btn=["#ff4f8b", "#f43f5e", CREAM], glow="#ff4f8b", rim="#ff4f8b", plate="#150f22"),
    "std": dict(body=["#2a0a14", "#4a0f20", "#6e1428", "#8f1d33"], bezel="#1c0a0e", edge="#8f1530", panel=["#3a1418", "#5e2a1c", "#8f5128"],
                stick="#ffb347", btn=["#ff5470", "#ffb347", "#ff5470"], glow="#ef4b5c", rim="#ff5470", plate="#2a0a14"),
    "mystery": dict(body=["#1b1026", "#2a1a45", "#3a2a5e", "#52407a"], bezel="#0f0817", edge="#3a2a5e", panel=["#2a1a45", "#3a2a5e", "#52407a"],
                    stick=YEL[0], btn=[PUR[3], YEL[0], "#00cfd6"], glow=None, rim=WEB, plate="#1b1026"),
}


def pic_lastbell(f):
    c = Canvas(42, 32, "#161614")
    for x in range(0, 17):
        top, bot = int(9 * x / 16), int(31 - 13 * x / 16)
        k = [0, 5, 9, 12, 14, 16]
        idx = max(i for i in range(len(k)) if x >= k[i])
        base = ["#7a8a74", "#697763", "#7a8a74", "#697763", "#566352", "#44503f"][idx]
        if x in k:
            base = "#161614"
        for xx in (x, 41 - x):
            c.vline(xx, top, bot, base)
            if x not in k and x - k[idx] >= 1 and x + 1 < (k[idx + 1] if idx + 1 < len(k) else 17):
                c.px(xx, top + 2 + (idx % 2), "#2e332d")
        # lit stripe on the lockers
    # ceiling / floor
    for x in range(16, 26):
        c.vline(x, 0, 8, "#1f221e")
    for x in range(0, 17):
        c.vline(x, 0, int(9 * x / 16) - 1, "#1f221e") if int(9 * x / 16) > 0 else None
        c.vline(41 - x, 0, int(9 * x / 16) - 1, "#1f221e") if int(9 * x / 16) > 0 else None
    c.rect(16, 9, 10, 9, "#2e332d")
    c.rect(17, 10, 8, 8, "#aab49c")
    # floor: perspective chequer
    for y in range(18, 32):
        d = y - 14
        z = 24.0 / d
        for x in range(0, 42):
            top = int(9 * min(x, 41 - x) / 16)
            bot = int(31 - 13 * min(x, 41 - x) / 16)
            if y > bot or (x < 16 and y > 31):
                continue
            if (x < 16 and y <= bot) or (x > 25 and y <= bot):
                continue
            u = (x - 20.5) / (0.5 * d)
            c.px(x, y, "#8d9786" if (int(z) + int(np.floor(u))) % 2 == 0 else "#1b1d1a")
    for y in range(18, 32):
        d = y - 14
        z = 24.0 / d
        for x in range(0, 16):
            bot = int(31 - 13 * x / 16)
            if y > bot:
                c.px(x, y, "#1b1d1a")
        # keep the floor trapezoid only
    # figure + red light + ceiling tube
    fx = 20 + (1 if f == 2 else 0)
    c.rect(fx, 12, 2, 2, "#0b0d0a")
    c.rect(fx, 14, 2, 4, "#0b0d0a")
    c.px(fx - 1, 14, "#0b0d0a").px(fx + 2, 14, "#0b0d0a")
    red = "#ff2a2a" if f != 1 else "#5a1010"
    c.rect(26, 11, 2, 2, red)
    if f != 1:
        c.px(25, 11, "#7a1010").px(28, 12, "#7a1010").px(26, 10, "#7a1010").px(27, 13, "#7a1010")
    tube = "#e8efe0" if f != 2 else "#7a8470"
    c.hline(15, 26, 2, tube)
    c.hline(16, 25, 3, "#aab49c")
    return c


def pic_shadowcore(f):
    c = Canvas(42, 32, "#07050b")
    c.vgrad(0, 0, 42, 32, ["#07050b", "#0e0a16", "#150f22"])
    xs, ys = c.grid()
    mx, my = 29, 12
    m = c.ellipse_mask(mx, my, 10, 10)
    c.shade(m, np.clip(1 - np.sqrt((xs - mx + 4) ** 2 + (ys - my + 4) ** 2) / 20.0, 0, 1) * 1.2, ["#9aa5c4", "#b9c3dc", "#dfe6f5", "#f2f5fc"], dither=True)
    for cx_, cy_ in [(33, 8), (25, 15), (31, 17)]:
        c.px(cx_, cy_, "#9aa5c4").px(cx_ + 1, cy_, "#9aa5c4")
    # ground and neon spikes
    c.rect(0, 28, 42, 4, "#150f22")
    c.hline(0, 41, 28, "#2e2540")
    for sx_ in (22, 28, 34):
        for i in range(6):
            c.hline(sx_ + 2 - (i + 1) // 2 - 0, sx_ + 2 + (i + 1) // 2, 22 + i, "#2a0714")
        c.line(sx_, 27, sx_ + 2, 21, "#ff4f8b")
        c.line(sx_ + 4, 27, sx_ + 2, 21, "#ff4f8b")
        c.hline(sx_, sx_ + 4, 27, "#f43f5e")
        c.px(sx_ + 2, 21, "#ffd0e0")
    # the black blob mid-jump
    bx_, by_ = [(12, 18), (14, 12), (16, 15)][f]
    c.ellipse(bx_, by_, 3, 3, "#000000")
    c.hline(bx_ - 2, bx_ + 1, by_ - 3, "#2e2540")
    c.px(bx_ - 1, by_ - 1, "#fff").px(bx_ + 2, by_ - 1, "#fff")
    c.px(bx_ - 1, by_, "#fff").px(bx_ + 2, by_, "#fff")
    return c


def pic_std(f, tint=None):
    c = Canvas(42, 32, "#2a0a14")
    c.vgrad(0, 0, 42, 32, ["#3a0f1c", "#5a1226", "#8f1530"])
    xs, ys = c.grid()
    mx, my = 30, 9
    c.dither_mask(c.ellipse_mask(mx, my, 9, 9), "#5a1226", 0.5)
    m = c.ellipse_mask(mx, my, 6, 6)
    c.shade(m, np.clip(1 - np.sqrt((xs - mx + 2) ** 2 + (ys - my + 2) ** 2) / 10.0, 0, 1), ["#8f1530", "#c8213f", "#ef4b5c", "#ff8f8f"], dither=True)
    # far trees then near trees
    for (x_, h_, col) in [(4, 14, "#5a1226"), (13, 18, "#5a1226"), (26, 16, "#5a1226"), (37, 17, "#5a1226"), (0, 20, "#1d0a10"), (9, 24, "#12060a"), (19, 22, "#12060a"), (31, 25, "#12060a"), (40, 21, "#1d0a10")]:
        base_y = 28
        for i in range(h_):
            half = 1 + int(i * 0.28)
            c.hline(x_ - half, x_ + half, base_y - h_ + i, col)
        c.vline(x_, base_y, base_y + 3, "#12060a")
    c.rect(0, 28, 42, 4, "#12060a")
    # ranger
    rx_, ry_ = 18, 20
    c.rect(rx_ - 1, ry_, 5, 2, "#6e3a1e")
    c.rect(rx_, ry_ + 2, 3, 2, "#f2c9a0")
    c.rect(rx_ - 1, ry_ + 4, 5, 3, "#b8743a")
    c.hline(rx_ + (1 if f == 1 else 0), rx_ + 1 + (1 if f == 1 else 0), ry_ + 7, "#3a2a5e")
    c.px(rx_ + (0 if f == 1 else 2), ry_ + 8, "#3a2a5e")
    c.px(rx_ + 4, ry_ + 5, "#959fb8")
    # eyes between the trees
    eyes = ["#ffb347"] if tint is None else [tint]
    for i, (ex, ey) in enumerate([(6, 22), (34, 23), (26, 20)]):
        if (f == 1 and i == 0) or (f == 2 and i == 2):
            continue
        c.px(ex, ey, eyes[0]).px(ex + 2, ey, eyes[0])
    return c


def pic_mystery(f, hw=True):
    c = Canvas(42, 32, INK)
    c.rect(0, 0, 42, 32, "#1d1230", fill=False)
    col = [PUMP[1], PUMP[2], PUMP[3]] if hw else [BRASS[1], YEL[0], YEL[1]]
    for ex in (10, 26):
        h = 1 if f == 2 else 3
        c.dither(ex - 2, 11, 8, 8, col[0] if True else col[0], 0.18) if False else None
        c.rect(ex, 13, 5, h, col[1])
        c.px(ex, 13, col[2])
        if h == 3:
            c.rect(ex + 1, 14, 3, 1, col[2]) if False else None
        c.dither_mask(c.rect_mask(ex - 2, 11, 9, 7) & ~c.rect_mask(ex, 13, 5, h), WALL[1] if hw else WALL[1], 0.5)
    return c


def pics(key, hw=True):
    if key == "lastbell":
        return [pic_lastbell(i) for i in range(3)]
    if key == "shadowcore":
        return [pic_shadowcore(i) for i in range(3)]
    if key == "std":
        return [pic_std(i) for i in range(3)]
    return [pic_mystery(i, hw) for i in range(3)]


def strip(frames):
    w, h = frames[0].w, frames[0].h
    s = Canvas(w * len(frames), h)
    for i, f in enumerate(frames):
        s.blit(f, i * w, 0)
    return s


def cabinet(key, on, hw=True):
    sp = SPEC[key]
    body = sp["body"]
    c = Canvas(CAB_W, CAB_H)
    xs, ys = c.grid()
    M = np.zeros((CAB_H, CAB_W), bool)
    dead = lambda col: mix(col, INK, 0.5)  # noqa

    # ---------------- silhouettes + extras drawn first
    if key == "lastbell":
        M[6:96, 2:56] = True
    elif key == "shadowcore":
        M[8:16, 6:52] = True
        M[16:96, 2:56] = True
        M |= c.poly_mask([(29, 0), (34, 9), (24, 9)])
        for k in range(3):  # chamfered base
            M[93 + k, 2:2 + 2 - k + 0] = False
            M[93 + k, 56 - (2 - k):56] = False
    elif key == "std":
        M[16:96, 2:56] = True
        M |= c.poly_mask([(29, 0), (35, 2), (43, 5), (57, 15), (0, 15), (14, 5), (22, 2)])
        M[1:8, 44:49] = True
    else:
        M[1:14, 9:49] = True
        M[14:16, 4:54] = True
        M[16:96, 2:56] = True
    f = 0.85 - 0.7 * (xs - 2) / 54.0 + 0.05 * (1 - ys / 96.0)
    c.shade(M, f, body)
    if key == "shadowcore":  # gloss streaks
        c.dither_mask(M & ((xs + ys) % 11 == 0) & (ys > 20), body[3], 0.5)
    if key == "std":
        for yy in range(18, 94, 4):
            c.hline(2, 55, yy, body[0]) if False else None
        c.dither_mask(M & (xs % 6 == 0) & (ys > 16), body[0], 0.7)
    if key == "lastbell":
        # locker vent grille down both sides + a locker door at the base
        for yy in range(20, 92, 3):
            c.hline(2, 3, yy, body[0])
            c.hline(54, 55, yy, body[0])
        for xx in (14, 22, 30, 38):
            pass
    # ---------------- marquee
    mq = sp
    if key == "lastbell":
        c.rect(6, 7, 46, 8, INK)
        c.rect(6, 7, 46, 8, "#44503f" if on else "#2e332d", fill=False)
        c.text(29, 8, "LAST BELL", "#ece8d8" if on else "#6f7a68", "Jersey10", 12, None, "mt")
        # school bell on top
        for (x0, x1, yy, col) in [(29, 29, 0, BRASS[1]), (27, 31, 1, BRASS[2]), (26, 32, 2, BRASS[2]), (26, 32, 3, BRASS[2]), (25, 33, 4, BRASS[1]), (29, 29, 5, BRASS[0])]:
            c.hline(x0, x1, yy, col)
        c.px(27, 2, BRASS[3]).px(27, 3, BRASS[3])
    elif key == "shadowcore":
        c.rect(6, 8, 46, 8, "#050308")
        c.hline(6, 51, 8, "#ff4f8b" if on else "#6a2a40")
        c.text(29, 10, "SHADOW CORE", "#f4f4ff" if on else "#6b6478", "Micro5", 10, None, "mt")
        c.line(24, 9, 29, 0, "#ff4f8b" if on else "#6a2a40")
        c.line(34, 9, 29, 0, "#ff4f8b" if on else "#6a2a40")
    elif key == "std":
        tc = "#ff5470" if on else "#8f1530"
        c.dither_mask(M & (ys < 15) & (ys % 3 == 0), "#12060a", 0.8)
        c.rect(15, 5, 28, 5, "#12060a")
        c.rect(12, 10, 34, 5, "#12060a")
        c.text(29, 5, "SURVIVE", tc, "Micro5", 10, None, "mt")
        c.text(29, 10, "TILL DAWN", tc, "Micro5", 10, None, "mt")
        c.rect(44, 1, 5, 7, "#5a1226")
        c.hline(44, 48, 1, "#8f1d33")
        c.hline(2, 55, 15, "#12060a")
        # thorny twigs at the top corners
        for sgn in (1, -1):
            x0 = 3 if sgn == 1 else 54
            pts = [(x0, 14), (x0 + sgn * -1, 11), (x0 + sgn * -2, 8), (x0 + sgn * -1, 5)]
            for (px1, py1), (px2, py2) in zip(pts, pts[1:]):
                c.line(px1, py1, px2, py2, "#12060a")
            c.px(x0 + sgn * -3, 10, "#ef4b5c" if on else "#8f1530").px(x0 + sgn * 0, 7, "#ef4b5c" if on else "#8f1530").px(x0 + sgn * -2, 4, "#ef4b5c" if on else "#8f1530")
    else:
        face = WEB if on else "#6e6288"
        c.rect(9, 2, 40, 11, INK)
        c.rect(10, 3, 38, 9, face)
        c.text(29, 5, "???", "#2a1a45", "Micro5", 10, None, "mt")
        c.hline(10, 47, 3, mix(face, "#ffffff", 0.2))
    # ---------------- bezel + screen
    c.rect(4, 16, 50, 39, sp["bezel"])
    c.rect(4, 16, 50, 39, sp["edge"], fill=False) if key != "lastbell" else c.rect(4, 16, 50, 39, "#44503f", fill=False)
    c.rect(7, 17, 44, 34, INK)
    pic = pics(key, hw)[0]
    pic = pic if on else dimmed(pic, 0.62)
    c.blit(pic, SCR[0], SCR[1])
    if on:
        for i in range(5):
            c.px(9 + i, 19, mix("#ffffff", "#000000", 0.1) if i < 3 else "#ffffff") if False else None
        c.dither_mask(c.rect_mask(8, 18, 12, 6) & ((xs + ys) % 5 == 0), CREAM, 0.3)
    # small lamps under the screen
    for lx, lc in [(12, sp["btn"][0]), (46, sp["btn"][2])]:
        c.rect(lx, 52, 2, 2, lc if on else dead(lc))
    # ---------------- control panel (slanted deck) rows 56..66
    for yy in range(56, 67):
        t_ = (yy - 56) / 10.0
        x0, x1 = int(round(4 - 3 * t_)), int(round(53 + 3 * t_))
        col = sp["panel"][2] if yy == 56 else (sp["panel"][1] if yy < 65 else sp["panel"][0])
        c.hline(x0, x1, yy, col)
    c.hline(1, 56, 66, INK)
    # stick and buttons
    c.rect(13, 59, 1, 4, "#959fb8")
    c.circle(13, 58, 2, sp["stick"] if on else dead(sp["stick"]))
    c.px(12, 57, CREAM) if on else None
    for i, bx in enumerate((30, 36, 42)):
        col = sp["btn"][i]
        c.rect(bx, 60, 3, 3, col if on else dead(col))
        c.px(bx, 60, CREAM) if on else None
        c.hline(bx, bx + 2, 63, INK)
    # ---------------- start strip (HTML PLAY button sits here): flat near-black
    c.rect(BTN[0] - 1, BTN[1] - 1, BTN[2] + 2, BTN[3] + 2, sp["edge"] if key != "lastbell" else "#44503f")
    c.rect(*BTN, INK)
    # ---------------- coin door
    c.rect(14, 86, 30, 9, sp["plate"])
    c.rect(14, 86, 30, 9, INK, fill=False)
    coin = YEL[0] if on else BRASS[0]
    for cx_ in (19, 36):
        c.rect(cx_, 88, 3, 5, INK)
        c.rect(cx_, 88, 3, 2, coin)
    c.rect(27, 89, 6, 3, INK)
    if key == "lastbell":
        for vx in (16, 18, 20):
            pass
        for vx in range(25, 33, 2):
            c.vline(vx, 87, 88, "#161614") if False else None
    c.hline(2, 55, 95, INK)
    # ---------------- outline
    c.outline(INK)
    # ---------------- lit state: rim light + glow
    if on:
        left = M & ~np.roll(M, 1, axis=1)
        top = M & ~np.roll(M, 1, axis=0)
        c.fill_mask((left | top) & (c.alpha_mask()) & (ys > 1), sp["rim"] if key != "mystery" else WEB)
        c.fill_mask(M & ~np.roll(M, -1, axis=1) & (ys > 17), mix(sp["rim"], INK, 0.55))
        gcol = sp["glow"] or (PUMP[2] if hw else YEL[0])
        ring = M & ~c.rect_mask(4, 16, 50, 39) & ~c.rect_mask(4, 56, 50, 12) & (ys >= 17)
        d = np.sqrt(((xs - 29) / 30.0) ** 2 + ((ys - 34) / 28.0) ** 2)
        c.dither_mask(ring & (d < 1.0) & (ys < 86), gcol, 0.22)
        c.dither_mask(ring & (d < 0.8) & (ys < 86), gcol, 0.14)
        c.dither_mask(c.rect_mask(3, 17, 52, 39) & ~c.rect_mask(4, 16, 50, 39), gcol, 0.5)
    return c


def pool_on():
    c = Canvas(80, 10)
    xs, ys = c.grid()
    d = np.sqrt(((xs - 40) / 40.0) ** 2 + ((ys - 1) / 9.5) ** 2)
    f = np.clip(1 - d, 0, 1)
    c.dither_mask(f > 0.0, "#2e2550", 0.45)
    c.dither_mask(f > 0.3, "#4a3d78", 0.45)
    c.dither_mask(f > 0.62, "#7a68aa", 0.3)
    return c


# ------------------------------------------------------------------ elements, frames, tile
def element(fn, w, h):
    c = Canvas(w, h)
    fn(c)
    return c


def frame48(kind):
    c = Canvas(48, 48)
    xs, ys = c.grid()
    if kind == "board":
        fill = INK
        c.rect(0, 0, 48, 48, GLASS[1])
        c.hline(0, 47, 0, GLASS[3]); c.hline(0, 47, 1, GLASS[2]); c.vline(0, 0, 47, GLASS[2])
        c.hline(0, 47, 47, GLASS[0]); c.vline(47, 0, 47, GLASS[0]); c.vline(46, 2, 47, GLASS[0])
        c.rect(0, 0, 48, 48, INK, fill=False)
        c.rect(7, 7, 34, 34, GLASS[0])
        c.rect(8, 8, 32, 32, fill)
        for k in range(20, 29, 8):
            for (px_, py_) in [(k, 3), (k, 43), (3, k), (43, k)]:
                c.rect(px_, py_, 2, 2, BRASS[2]); c.px(px_ + 1, py_ + 1, BRASS[0])
        for (px_, py_) in [(3, 3), (43, 3), (3, 43), (43, 43)]:
            c.rect(px_, py_, 2, 2, BRASS[2]); c.px(px_ + 1, py_ + 1, BRASS[0])
        c.rect(9, 9, 4, 4, YEL[0]); c.px(9, 9, CREAM); c.rect(8, 8, 6, 6, BRASS[0], fill=False)
        return c, fill
    if kind == "quest":
        fill = WALL[0]
        c.rect(0, 0, 48, 48, WOOD[1])
        c.hline(0, 47, 0, WOOD[4]); c.vline(0, 0, 47, WOOD[3]); c.hline(0, 47, 47, WOOD[0]); c.vline(47, 0, 47, WOOD[0])
        c.rect(0, 0, 48, 48, INK, fill=False)
        c.rect(3, 3, 42, 42, WOOD[3])
        c.dither(3, 3, 42, 42, WOOD[4], 0.25)
        c.dither_mask(c.rect_mask(3, 3, 42, 42), WOOD[2], 0.14, 2, 1)
        c.rect(8, 8, 32, 32, WOOD[1])
        c.rect(9, 9, 30, 30, fill)
        for (px_, py_) in [(5, 5), (41, 5), (5, 41), (41, 41)]:
            c.px(px_, py_, RED); c.px(px_ - 1, py_ - 1, CREAM); c.px(px_ + 1, py_ + 1, WOOD[1])
        for k in (20, 28):
            c.px(k, 5, YEL[0]); c.px(k, 42, YEL[0]) if False else None
        return c, fill
    if kind == "prize":
        fill = WALL[0]
        c.rect(0, 0, 48, 48, BRASS[1])
        c.rect(0, 0, 48, 48, INK, fill=False)
        c.rect(1, 1, 46, 46, BRASS[2], fill=False)
        c.hline(1, 46, 1, BRASS[3]); c.vline(1, 1, 46, BRASS[3]); c.hline(2, 46, 46, BRASS[0]); c.vline(46, 2, 46, BRASS[0])
        c.rect(3, 3, 42, 42, BRASS[0])
        c.rect(4, 4, 40, 40, GLASS[1])
        c.rect(4, 4, 40, 40, GLASS[3], fill=False)
        c.rect(7, 7, 34, 34, GLASS[0])
        c.rect(8, 8, 32, 32, fill)
        for k in range(8, 40, 8):  # glass glints on the pane band (period 8, tiles cleanly)
            c.px(k + 1, 5, GLASS[4]); c.px(5, k + 1, GLASS[4])
        for (px_, py_) in [(2, 2), (44, 2), (2, 44), (44, 44)]:
            c.rect(px_, py_, 2, 2, BRASS[3]); c.px(px_ + 1, py_ + 1, BRASS[0])
        return c, fill
    fill = CREAM  # paper
    c.rect(0, 0, 48, 48, "#dccfbf")
    c.rect(2, 2, 44, 44, CREAM)
    for k in range(0, 48, 4):
        c.px(k, 0, CREAM); c.px(k + 2, 47, CREAM); c.px(0, k + 2, CREAM); c.px(47, k, CREAM)
    for (px_, py_, dx_, dy_) in [(0, 0, 1, 1), (47, 0, -1, 1), (0, 47, 1, -1), (47, 47, -1, -1)]:
        for i in range(10):
            for j in range(4):
                xx = px_ + dx_ * (i + j - 2 if dx_ > 0 else i + j - 2)
                yy = py_ + dy_ * (j + 1)
        # tape: a diagonal strip over each corner
    tape = "#e0c27a"
    for (cx_, cy_, sgn) in [(5, 5, 1), (42, 5, -1), (5, 42, -1), (42, 42, 1)]:
        for i in range(-6, 7):
            for j in range(-2, 3):
                xx, yy = cx_ + i, cy_ + j * sgn + (i * sgn if False else 0)
                xx2, yy2 = cx_ + i + j * 0, cy_ + sgn * i // 1 * 0 + j
                px_, py_ = cx_ + (i + j) * 1, cy_ + (i - j) * sgn
                if 0 <= px_ < 48 and 0 <= py_ < 48 and abs(i) < 5:
                    c.px(px_, py_, tape)
    c.rect(16, 16, 16, 16, fill)
    return c, fill


def tile_wall():
    c = Canvas(64, 64, WALL[0])
    for yy in range(0, 64, 8):
        for xx in range(((yy // 8) % 2) * 4 + 2, 64, 8):
            c.px(xx, yy, WALL[1]).px(xx + 1, yy, WALL[1]).px(xx, yy + 1, WALL[1]).px(xx + 1, yy + 1, WALL[1])
    for xx in range(7, 64, 16):
        c.dither(xx, 0, 1, 64, INK, 0.5)
    return c


# ------------------------------------------------------------------ previews
def compose(scene, L, cabs, scale, path, zones=None):
    big = scene.scaled(scale).image()
    cache = {}

    def load(n):
        if n not in cache:
            cache[n] = Image.open(os.path.join(OUT, n)).convert("RGBA")
        return cache[n]

    for slot_i, key, on in cabs:
        sx, sy = L["slots"][slot_i]
        if on:
            p = load("pool-on.png")
            big.alpha_composite(p.resize((p.width * scale, p.height * scale), Image.NEAREST), ((sx - 11) * scale, (sy + 96) * scale))
        calm = "calm" in path and key == "mystery"
        im = load("cab-%s-%s%s.png" % (key, "on" if on else "off", "-calm" if calm else ""))
        big.alpha_composite(im.resize((im.width * scale, im.height * scale), Image.NEAREST), (sx * scale, sy * scale))
    if zones:
        from PIL import ImageDraw
        d = ImageDraw.Draw(big)
        for r in zones:
            d.rectangle([r[0] * scale, r[1] * scale, (r[0] + r[2]) * scale - 1, (r[1] + r[3]) * scale - 1], outline=(0, 255, 255, 255))
    big.convert("RGB").save(path)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    counts = {}
    for kind in ("desk", "phone"):
        for hw, tag in ((True, "haunted"), (False, "calm")):
            sc = build(kind, hw)
            sc.save(os.path.join(OUT, "%s-%s.png" % (kind, tag)))
            counts["%s-%s" % (kind, tag)] = sc.colours()
    # cabinets
    for key in SPEC:
        for on in (False, True):
            cabinet(key, on).save(os.path.join(OUT, "cab-%s-%s.png" % (key, "on" if on else "off")))
        strip(pics(key, True)).save(os.path.join(OUT, "scr-%s.png" % key))
    for on in (False, True):
        cabinet("mystery", on, hw=False).save(os.path.join(OUT, "cab-mystery-%s-calm.png" % ("on" if on else "off")))
    strip(pics("mystery", False)).save(os.path.join(OUT, "scr-mystery-calm.png"))
    pool_on().save(os.path.join(OUT, "pool-on.png"))
    print("colours", counts)
    for key in SPEC:
        print(key, cabinet(key, True).colours())
    # previews
    L = DESK
    d_h, d_c = build("desk", True), build("desk", False)
    compose(d_h, L, [(0, "lastbell", True), (1, "mystery", False), (2, "mystery", False)], 3, os.path.join(OUT, "composite-desk-haunted.png"))
    compose(d_c, L, [(0, "lastbell", True), (1, "mystery", False), (2, "mystery", False)], 3, os.path.join(OUT, "composite-desk-calm.png"))
    compose(d_h, L, [(0, "lastbell", False), (1, "shadowcore", True), (2, "std", False)], 3, os.path.join(OUT, "composite-desk-all.png"))
    compose(build("phone", True), PHONE, [(0, "lastbell", True)], 2, os.path.join(OUT, "composite-phone-haunted.png"))
    compose(build("phone", False), PHONE, [(0, "mystery", False)], 2, os.path.join(OUT, "composite-phone-calm.png"))
    zr = [(15, 30, 80, 68), (16, 134, 80, 14), (346, 160, 70, 14), (156, 44, 122, 10), (112, 166, 210, 58)]
    for sl in L["slots"]:
        zr.append((sl[0] + 5, sl[1] + 68, 48, 15))
    compose(d_h, L, [(0, "lastbell", True), (1, "mystery", False), (2, "mystery", False)], 3, os.path.join(OUT, "composite-desk-zones.png"), zones=zr)

    # ---- standalone elements (haunted + calm)
    for hw, sfx in ((True, ""), (False, "-calm")):
        element(lambda c: board(c, 0, 0, hw), 94, 96).save(os.path.join(OUT, "el-board%s.png" % sfx))
        element(lambda c: quest(c, 0, 0, 96, 72, hw), 96, 72).save(os.path.join(OUT, "el-quest%s.png" % sfx))

        def _prize(c, hw=hw):
            door(c, 0, 0, hw)
            c.rect(2, 132, 90, 18, WALL[1])
            c.rect(12, 136, 70, 14, WALL[0])
            c.rect(11, 135, 72, 16, WALL[2], fill=False)
        element(_prize, 94, 150).save(os.path.join(OUT, "el-prize%s.png" % sfx))
    fills = {}
    for k in ("board", "quest", "prize", "paper"):
        fr, fill = frame48(k)
        fr.save(os.path.join(OUT, "frame-%s.png" % k))
        fills[k] = fill
    tile_wall().save(os.path.join(OUT, "tile-wall.png"))

    # ---- animation strips
    def marquee_strip(w, h, tsz, wy, ty):
        fr = []
        for ph in range(3):
            t = Canvas(w, h)
            sign(t, 0, 0, w, h, True, ph, only_bulbs=True)
            fr.append(t)
        return strip(fr)

    def marquee_strip_s(w, h, hw):
        fr = []
        for ph in range(3):
            t = Canvas(w, h)
            sign(t, 0, 0, w, h, hw, ph, only_bulbs=True)
            fr.append(t)
        return strip(fr)

    marquee_strip_s(150, 38, True).save(os.path.join(OUT, "anim-marquee-haunted.png"))
    marquee_strip_s(150, 38, False).save(os.path.join(OUT, "anim-marquee-calm.png"))
    marquee_strip_s(150, 30, True).save(os.path.join(OUT, "anim-marquee-phone-haunted.png"))
    marquee_strip_s(150, 30, False).save(os.path.join(OUT, "anim-marquee-phone-calm.png"))
    strip([build("desk", True, ghost=dy).crop(311, 86, 14, 18) for dy in (0, -1, -2, -1)]).save(os.path.join(OUT, "anim-ghost.png"))
    strip([build("desk", True, flick=k).crop(326, 52, 108, 154) for k in (0, 1)]).save(os.path.join(OUT, "anim-doorlight.png"))
    base_pts = [(10, 12), (40, 20), (25, 44), (60, 58), (14, 70), (33, 80), (66, 33), (8, 50), (54, 8), (50, 64)]
    dust = []
    for k in range(3):
        t = Canvas(84, 96)
        for i, (x_, y_) in enumerate(base_pts):
            if (i + k) % 3 != 2:
                t.px(x_ + ((k + i) % 2), (y_ - k * 3 - i) % 96, YEL[1] if i % 2 else CREAM)
        dust.append(t)
    strip(dust).save(os.path.join(OUT, "anim-dust.png"))

    # ---- manifest
    def R(x, y, w, h):
        return {"x": x, "y": y, "w": w, "h": h}

    anims_desk = [
        {"file": "anim-marquee-haunted.png", "x": 142, "y": 4, "frames": 3, "fps": 4, "season": "haunted"},
        {"file": "anim-marquee-calm.png", "x": 142, "y": 4, "frames": 3, "fps": 4, "season": "calm"},
        {"file": "anim-doorlight.png", "x": 326, "y": 52, "frames": 2, "fps": 3, "season": "haunted", "note": "opaque tiles cut from the scene; replaces the doorway interior and spill"},
        {"file": "anim-ghost.png", "x": 311, "y": 86, "frames": 4, "fps": 4, "season": "haunted", "note": "opaque tiles; sits BEHIND the slot-3 cabinet sprite"},
        {"file": "anim-dust.png", "x": 338, "y": 60, "frames": 3, "fps": 4, "season": "both", "note": "transparent motes in the door light"},
    ]
    manifest = {
        "concept": "a",
        "title": "The Arcade Hall",
        "desk": {
            "w": 434, "h": 230, "scale": 3,
            "files": {"haunted": "desk-haunted.png", "calm": "desk-calm.png"},
            "layers": [],
            "cab": {"w": 58, "h": 96, "screen": R(8, 18, 42, 32), "button": R(5, 68, 48, 15)},
            "cab_files": {"pattern": "cab-<key>-<off|on>.png", "scr": "scr-<key>.png", "mystery_calm": ["cab-mystery-off-calm.png", "cab-mystery-on-calm.png", "scr-mystery-calm.png"],
                          "note": "the mystery cabinet has orange eyes in the haunted season; use the -calm files (yellow eyes) when haunted is off"},
            "slots": [{"x": 118, "y": 60}, {"x": 188, "y": 60}, {"x": 258, "y": 60}],
            "pool": {"dx": -11, "dy": 96, "w": 80, "h": 10, "file": "pool-on.png"},
            "zones": {
                "board": dict(R(8, 10, 94, 96), calm=R(15, 30, 80, 68)),
                "quest": dict(R(10, 110, 92, 42), calm=R(16, 134, 80, 14)),
                "prize": dict(R(334, 24, 94, 132), calm=R(346, 160, 70, 14)),
                "sign": R(142, 4, 150, 38),
                "ticker": R(156, 44, 122, 10),
                "panel": R(112, 166, 210, 58),
            },
            "anims": anims_desk,
            "eggs": [
                {"name": "ghost", "x": 313, "y": 88, "w": 12, "h": 15, "season": "haunted", "note": "peeking from behind slot 3"},
                {"name": "pumpkin", "x": 322, "y": 147, "w": 10, "h": 9, "season": "haunted", "note": "by the prize door"},
                {"name": "room000", "x": 317, "y": 127, "w": 18, "h": 10, "season": "both", "note": "tiny brass ROOM 000 plate on the wainscot"},
            ],
        },
        "phone": {
            "w": 195, "h": 236, "scale": 2,
            "files": {"haunted": "phone-haunted.png", "calm": "phone-calm.png"},
            "slot": {"x": 68, "y": 96},
            "pool": {"dx": -11, "dy": 96},
            "zones": {
                "sign": R(22, 4, 150, 30),
                "ticker": R(34, 36, 126, 9),
                "panel": R(0, 198, 195, 38),
                "board_glimpse": R(0, 96, 22, 90),
                "prize_glimpse": R(170, 60, 25, 132),
                "window": R(3, 40, 28, 44),
            },
            "anims": [
                {"file": "anim-marquee-phone-haunted.png", "x": 22, "y": 4, "frames": 3, "fps": 4, "season": "haunted"},
                {"file": "anim-marquee-phone-calm.png", "x": 22, "y": 4, "frames": 3, "fps": 4, "season": "calm"},
            ],
        },
        "elements": {
            "board": {"file": "el-board.png", "calm_file": "el-board-calm.png", "w": 94, "h": 96, "calm": R(7, 20, 80, 68)},
            "quest": {"file": "el-quest.png", "calm_file": "el-quest-calm.png", "w": 96, "h": 72, "calm": R(6, 54, 84, 14)},
            "prize": {"file": "el-prize.png", "calm_file": "el-prize-calm.png", "w": 94, "h": 150, "calm": R(12, 136, 70, 14)},
        },
        "frames": {k: {"file": "frame-%s.png" % k, "slice": 16, "fill": fills[k]} for k in fills},
        "tile": "tile-wall.png",
        "palette": {"colours": max(counts.values()), "notes": "per-scene counts in NOTES.md: " + json.dumps(counts)},
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print("ok")
