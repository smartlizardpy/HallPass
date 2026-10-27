"""Concept C - The Possessed Arcade (HallPass Fright Fest event hall).

One-point perspective down a foggy aisle of dead cabinets to the HI-SCORE shrine.
Layers: bg (walls, floor, dead cabs, shrine, booth, door), fg (dark edge silhouettes, neon sign),
fog (seamless strip). Deterministic (fixed seeds). Run:  python3 hall_c.py
Perspective rule: every receding line is a clean stair-step (1:1 cab-row base, 1:2 wall base,
1:3 cab tops, 1:4 wall trim). Floor in front of a plane at depth z is  y = VY + A / z.
"""
import sys, os, json, math, random
ART = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, ART)
from pxkit import *
from PIL import Image

OUT = os.path.join(ART, "out", "c"); os.makedirs(OUT, exist_ok=True)
PUB = os.path.normpath(os.path.join(ART, "..", "..", "..", "public", "events", "fright-fest"))

C = dict(
    d0="#07030d", d1="#0b0612", d2="#130a22", d3="#1b1030", d4="#261a44", d5="#34265e",
    d6="#473a7a", d7="#5f5190", d8="#7d70a8", d9="#a498c4",
    m1="#c98d00", m2="#ffd84a", m3="#ffe98a", m4="#fff7cf", w3="#ffc700",
    bm1="#4a4426", bm2="#8a7d3c",
    o1="#8a2e00", o2="#d9600a", o3="#ff7a1a", o4="#ffa04d",
    p0="#3d0c26", p1="#8f1f4f", p2="#ff4f8b", p3="#ffa0c0",
    g0="#161614", g1="#2b302a", g2="#4a5448", g3="#6f7a68", g4="#9aa592",
    r0="#2a0a14", r1="#5a0c1f", r2="#8f1530", r3="#c8213f", r4="#ff5470", am="#ffb347",
    b1="#7d6c7a", b2="#b3a29e", b3="#dccfbf", b4="#f2e8d5",
    u1="#4a1fa8", u2="#7c2eef", u3="#b49cff",
    bt1="#2b2a3a", bt2="#4a4658", bt3="#7a7458", bt4="#b0a470",
    sp1="#3a1a1c", sp2="#5a2410", sc1="#2b2a1e", sc2="#5a4a10", sc3="#8a6a10",
)
PAL = sorted(set(C.values()))
PALRGB = np.array([rgba(h)[:3] for h in PAL], dtype=np.int32)
RAMP_BG = [C[k] for k in ("d1", "d2", "d3", "d4", "d5", "d6", "d7")]
RAMP_FLOOR = [C[k] for k in ("d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8")]


def snap(cv):
    a = cv.a
    flat = a[:, :, :3].reshape(-1, 3)
    uniq, inv = np.unique(flat, axis=0, return_inverse=True)
    d = ((uniq[:, None, :].astype(np.int32) - PALRGB[None]) ** 2).sum(2)
    nn = d.argmin(1)
    out = PALRGB[nn][inv.reshape(-1)].reshape(a.shape[0], a.shape[1], 3)
    a[:, :, :3] = out.astype(np.uint8)
    return cv


def save(cv, name):
    snap(cv)
    p = os.path.join(OUT, name)
    cv.image().save(p, optimize=True)
    return p


def dth(c, m, field, col):
    """Place col where field > Bayer threshold (field scalar or array) inside mask m."""
    xs, ys = c.grid()
    t = BAYER4[ys % 4, xs % 4]
    c.a[m & (np.asarray(field) > t)] = rgba(col)


def lift(c, m, level):
    """Solid light: raise the value of what is behind (cool-yellow tint). level 1 = beam edge band, 2 = core.
    Edge pixels get a 2 px ordered-dither seam back to the original."""
    old = c.a.copy()
    sub = c.a[:, :, :3].astype(int).mean(axis=2)
    outs = [("bt1", "bt2", "bt3"), ("bt2", "bt3", "bt4")][level - 1]
    cols = np.array([rgba(C[k]) for k in outs], dtype=np.uint8)
    idx = np.where(sub < 30, 0, np.where(sub < 70, 1, 2))
    c.a[m] = cols[idx[m]]
    seam = m & ~erode(erode(m))
    xs, ys = c.grid()
    sel = seam & (BAYER4[ys % 4, xs % 4] < 0.5)
    c.a[sel] = old[sel]


def solid_band(c, m, col):
    old = c.a.copy()
    c.a[m] = rgba(col)
    xs, ys = c.grid()
    sel = (m & ~erode(m)) & (BAYER4[ys % 4, xs % 4] < 0.5)
    c.a[sel] = old[sel]


def pick(ramp, f, x, y):
    f = min(max(f, 0), 0.9999) * (len(ramp) - 1)
    i = int(f)
    return ramp[min(i + (1 if f - i > BAYER4[y % 4, x % 4] else 0), len(ramp) - 1)]


def rr_mask(c, x, y, w, h, r):
    m = c.rect_mask(x, y, w, h)
    xs, ys = c.grid()
    for cx, cy, sx, sy in ((x + r, y + r, -1, -1), (x + w - 1 - r, y + r, 1, -1), (x + r, y + h - 1 - r, -1, 1), (x + w - 1 - r, y + h - 1 - r, 1, 1)):
        reg = ((xs - cx) * sx > 0) & ((ys - cy) * sy > 0)
        m &= ~(reg & (((xs - cx) ** 2 + (ys - cy) ** 2) > r * r + 0.5))
    return m


def fit_mask(W, H, box, s, fonts, spacing=0, weight=None):
    bx, by, bw, bh = box
    for font, size in fonts:
        m, _ = text_mask(400, 120, 20, 20, s, font, size, weight, "la", spacing)
        ys, xs = np.nonzero(m)
        if len(xs) == 0:
            continue
        w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        if w <= bw and h <= bh:
            ox = bx + (bw - w) // 2 - (xs.min() - 20)
            oy = by + (bh - h) // 2 - (ys.min() - 20)
            m2, _ = text_mask(W, H, ox, oy, s, font, size, weight, "la", spacing)
            return m2
    raise ValueError("no fit " + s)


def jer(a=26, b=7, f="Jersey10"):
    ok = {"Jersey10": (30, 20, 16, 15, 12, 10, 8), "Jersey15": (30, 15, 10)}[f]
    return [(f, s) for s in ok if b < s <= a]


def sprite(name):
    return Canvas.load(os.path.join(PUB, name))


# ------------------------------------------------------------------ perspective
DESK = dict(w=434, h=230, vx=217, vy=96, A=130, hz=240)
PHONE = dict(w=195, h=300, vx=97, vy=92, A=84, hz=170)


def floor_mask(c, P):
    xs, ys = c.grid()
    return ys >= P["vy"] + (np.abs(xs - P["vx"]) + 1) // 2


def draw_room(c, P):
    """Walls and floor in perspective: haze toward the vanishing point, seams, wainscot, tile grid."""
    vx, vy, W, H = P["vx"], P["vy"], c.w, c.h
    xs, ys = c.grid()
    dx = np.abs(xs - vx)
    fl = floor_mask(c, P)
    wall = ~fl
    dist = np.sqrt((xs - vx) ** 2 + ((ys - vy) * 1.3) ** 2)
    f = np.clip(1 - dist / P["hz"], 0, 1) ** 1.5 * 0.95
    wain = vy + dx // 4
    f = np.where(wall & (ys > wain), f - 0.07, f)
    f = np.where(wall & (ys == wain), f + 0.12, f)
    f = np.where(wall & (ys == vy - dx // 4), f + 0.08, f)
    ceil = wall & (ys < vy - dx // 2)
    f = np.where(ceil, f - 0.1, f)
    for m in (1, 2, 4):
        f = np.where(ceil & (ys == vy - m * dx), f + 0.2, f)
        f = np.where(ceil & (ys == vy - m * dx + 1), f - 0.22, f)
    for z in (1.5, 2.2, 3.4, 5.5, 9.0):
        yy = vy - int(round(P["A"] * 1.15 / z))
        if 0 <= yy < H - 1:
            f[yy, :] = np.where(ceil[yy, :], f[yy, :] + 0.18, f[yy, :])
            f[yy + 1, :] = np.where(ceil[yy + 1, :], f[yy + 1, :] - 0.22, f[yy + 1, :])
    A2 = P["A"] * 2
    for z in (1.15, 1.6, 2.2, 3.1, 4.4, 6.5, 10, 16):
        for sg in (-1, 1):
            xx = int(round(vx + sg * A2 / z))
            if 0 <= xx < W:
                f[:, xx] = np.where(wall[:, xx], f[:, xx] - 0.1, f[:, xx])
    c.shade(wall, f, RAMP_BG)
    ff = (1 - np.clip((ys - vy) / max(1, H - vy), 0, 1)) ** 1.25 * 0.88
    ff = ff * (0.9 + 0.1 * (1 - np.clip(dx / 200.0, 0, 1)))
    for k in range(3, 30):
        yy = int(round(vy + P["A"] / (0.4 * k)))
        if vy + 1 < yy < H:
            ff[yy, :] += 0.07
    for k in range(-9, 10):
        for y in range(vy + 1, H):
            xx = vx + (k * (y - vy)) // 4
            if 0 <= xx < W:
                ff[y, xx] += 0.07
    c.shade(fl, ff, RAMP_FLOOR)


def haze_glow(c, P):
    xs, ys = c.grid()
    d = np.sqrt(((xs - P["vx"]) / 1.6) ** 2 + (ys - P["vy"] + 6) ** 2)
    dth(c, d < 70, np.clip(1 - d / 70, 0, 1) * 0.8, C["d7"])
    dth(c, d < 40, np.clip(1 - d / 40, 0, 1) * 0.9, C["d8"])


# ------------------------------------------------------------------ dead cabinets
def dead_cab(c, P, side, z0, glow=False, pl=1, tint=0.04):
    vx, vy, A = P["vx"], P["vy"], P["A"]
    z1 = z0 + 0.75
    dxn, dxf = A * pl / z0, A * pl / z1
    fo = lambda d: (d + pl - 1) // pl
    ftop, fbot = vy - fo(int(dxn)) // 3, vy + fo(int(dxn))
    fw = int(round(0.5 * A * pl / z0))
    depth = min(max(((z0 - 1) / 15.0) ** 0.7, 0.06), 0.95)
    for d in range(int(dxn) + 1, int(dxn) + fw + 1):
        x = vx + side * d
        for y in range(ftop, fbot + 1):
            c.px(x, y, pick([C["d0"], C["d1"], C["d2"], C["d3"]], 0.08 + 0.55 * depth, x, y))
    for d in range(int(math.ceil(dxf)), int(dxn) + 1):
        x = vx + side * d
        fy, ty = vy + fo(d), vy - fo(d) // 3
        Hh = fy - ty
        s = (dxn - d) / max(dxn - dxf, 1)
        for y in range(ty, fy + 1):
            t = (fy - y) / Hh
            fld = depth * 0.86 + 0.04 + tint
            col = None
            if t > 0.86:
                fld += 0.1
                if dxn - dxf > 6 and 0.12 < s < 0.88 and 0.9 < t < 0.97:
                    col = pick([C["d2"], C["p1"] if pl == 1 else C["d3"], C["d4"]], 0.3 + 0.5 * depth, x, y) if (side < 0) ^ (int(z0) % 2 == 0) else pick([C["d2"], C["u1"] if pl == 1 else C["d3"], C["d4"]], 0.3 + 0.5 * depth, x, y)
            elif 0.42 < t <= 0.84 and 0.12 < s < 0.88 and dxn - dxf > 5:
                edge = abs(t - 0.42) < 0.03 or abs(t - 0.84) < 0.03 or s < 0.15 or s > 0.85
                col = pick([C["d0"], C["d1"], C["d2"], C["d3"]], (0.18 if not glow else 0.5) * (0.4 + depth) + (0.12 if edge else 0), x, y)
                if glow and (y + x) % 2 == 0 and not edge:
                    col = C["d4"]
                if 0.8 < t < 0.84 and (x + y) % 3 == 0 and not edge:
                    col = C["d3"]
            elif 0.34 < t <= 0.42:
                fld += 0.1
            elif t < 0.2:
                fld -= 0.08
            elif t <= 0.34:
                fld -= 0.04
                if abs(s - 0.3) < 0.07 and abs(t - 0.27) < 0.04 and dxn - dxf > 7:
                    col = C["p1"]
                if abs(s - 0.62) < 0.07 and abs(t - 0.27) < 0.04 and dxn - dxf > 7:
                    col = C["u1"]
            if s < 0.07:
                fld += 0.12
            if y == ty:
                fld += 0.14
            c.px(x, y, col or pick(RAMP_BG, fld, x, y))


def dead_rows(c, P, haunted, track, lz0=2.1, rz0=2.6, outer=True, eyes_l=(1,), eyes_r=(0,), n=20, blink=None):
    glow_L = {2, 9}; glow_R = {5}
    cabs = [(lz0 + i, -1, i, 1) for i in range(n)] + [(rz0 + i, 1, i, 1) for i in range(n)]
    if outer:
        cabs += [(1.2 + i, -1, i, 2) for i in range(5)] + [(1.5 + i, 1, i, 2) for i in range(5)]
    cabs.sort(key=lambda t: (-t[0], -t[3]))
    for z, side, i, pl in cabs:
        glow = pl == 1 and ((i in glow_L) if side < 0 else (i in glow_R))
        dead_cab(c, P, side, z, glow=glow, pl=pl, tint=0.0 if pl == 1 else 0.11)
    if haunted:
        for z, side, i, pl in cabs:
            if pl == 1 and (((i in eyes_l) and side < 0) or ((i in eyes_r) and side > 0)):
                st, tr = 0, None
                if blink and side == blink["side"] and i == blink["i"]:
                    st, tr = blink["state"], blink["tr"]
                eye_draw(c, P, side, z, st, tr)


def eye_draw(c, P, side, z0, state, tr=None):
    """Two eyes on the dead cab screen. state 0 open, 1 half, 2 closed."""
    vx, vy, A = P["vx"], P["vy"], P["A"]
    dxn, dxf = A / z0, A / (z0 + 0.75)
    if dxn - dxf <= 3:
        return
    big = dxn > 40
    pts = []
    for sgn in (0.33, 0.67):
        d = int(round(dxn - sgn * (dxn - dxf)))
        x = vx + side * d
        fy, ty = vy + d, vy - d // 3
        y = int(round(fy - 0.63 * (fy - ty)))
        pts.append((x, y))
    for (x, y) in pts:
        if big:
            if state == 0:
                c.rect(x, y, 2, 2, C["m1"])
            elif state == 1:
                c.rect(x, y + 1, 2, 1, C["m1"])
            else:
                c.rect(x, y + 1, 2, 1, C["bm1"])
        else:
            c.px(x, y, C["m1"] if state < 2 else C["bm1"])
    if tr is not None:
        xs_ = [p[0] for p in pts]; ys_ = [p[1] for p in pts]
        tr["bbox"] = (min(xs_) - 2, min(ys_) - 2, max(xs_) - min(xs_) + 6, 6)


# ------------------------------------------------------------------ posters (sheared on the wall plane)
def poster(c, x0, y0, w, h, kind, side):
    t = Canvas(w, h)
    t.rect(0, 0, w, h, C["d3"])
    t.rect(0, 0, w, h, C["d6"], fill=False)
    if kind == "moon":
        t.circle(w // 2, h // 2 - 2, 3, C["m2"]); t.px(w // 2 - 1, h // 2 - 3, C["m4"])
        t.hline(2, w - 3, h - 4, C["u2"])
    elif kind == "eyes":
        t.hline(2, 3, h // 2 - 1, C["u3"]); t.hline(w - 4, w - 3, h // 2 - 1, C["u3"]); t.hline(3, w - 4, h - 4, C["p1"])
    elif kind == "q":
        t.text(w // 2, 2, "?", C["u3"], "Micro5", 10, None, "mt"); t.hline(2, w - 3, h - 3, C["p1"])
    else:
        t.rect(2, 2, w - 4, 4, C["p1"]); t.hline(2, w - 3, h - 4, C["g3"])
    for i in range(w):
        i2 = i if side < 0 else w - 1 - i
        sh = (i2 // 4)
        for j in range(h):
            c.px(x0 + i, y0 + j + (sh if side < 0 else (w // 4 - sh)), tuple(int(v) for v in t.a[j, i]))


# ------------------------------------------------------------------ cables ("roots")
def bez(p0, p1, p2, n=80):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in [i / n for i in range(n + 1)]]


def cable(c, pts, th=2, col=None, hi=None):
    col = col or C["d0"]; hi = hi or C["d3"]
    prev = None
    for (x, y) in pts:
        xi, yi = int(round(x)), int(round(y))
        if (xi, yi) == prev:
            continue
        prev = (xi, yi)
        c.px(xi, yi - 1, hi)
        t2 = th + (1 if (th > 1 and yi > 150) else 0) + (1 if (th > 1 and yi > 195) else 0)
        for k in range(t2):
            c.px(xi, yi + k, col)


# ------------------------------------------------------------------ the HI-SCORE shrine
def shrine(season, w=124, h=82, sh=58, ml=12, mt=12):
    H = season == "haunted"
    c = Canvas(w, h)
    top = 8
    xs, ys = c.grid()
    hm = rr_mask(c, 2, top, w - 4, h - top, 6)
    fld = 0.98 - 0.38 * (ys - top) / (h - top) - 0.2 * (xs / w)
    left = hm & (xs < ml + 2); right = hm & (xs >= w - ml - 2); mid = hm & ~left & ~right
    G = [C[k] for k in ("g0", "g1", "g2", "g3", "g4")]
    R = [C[k] for k in ("r0", "r1", "r2", "r3", "r4")]
    U = [C[k] for k in ("d3", "d4", "d5", "d6", "d7")]
    f2 = np.where(hm & (ys == top + 1), fld + 0.2, fld)
    f2 = np.where(hm & (xs == 3), f2 + 0.15, f2)
    f2 = np.where(hm & (ys == h - 2), f2 - 0.2, f2)
    c.shade(left, f2, G); c.shade(right, f2, R); c.shade(mid, f2, U)
    for bx in (ml + 1, w - ml - 2):
        c.vline(bx, top + 6, h - 8, C["d0"])
        for by in range(top + 8, h - 8, 12):
            c.px(bx - 1, by, C["b2"]); c.px(bx - 1, by - 1, C["d0"])
    c.hline(ml + 3, w - ml - 4, top + 3, C["p1"])
    scr = c.rect_mask(ml, mt, w - 2 * ml, sh)
    ring = dilate(scr) & ~scr
    r2 = dilate(ring) & ~ring & hm
    c.fill_mask(r2, C["p1"])
    dth(c, dilate(r2) & ~r2 & ~ring & hm, 0.5, C["p0"])
    c.fill_mask(r2 & (xs < w // 2) & (ys < mt + 3), C["p2"])
    c.fill_mask(ring, C["d0"])
    c.fill_mask(scr, C["d0"])
    for y in range(mt, mt + sh):
        if y % 3 == 0:
            c.hline(ml + 2, w - ml - 3, y, C["d1"])
    c.rect(20, 0, w - 40, mt, C["d1"]); c.rect(20, 0, w - 40, mt, C["d0"], fill=False)
    c.hline(21, w - 22, 1, C["m1"])
    tm = fit_mask(w, h, (23, 2, w - 46, mt - 3), "HI-SCORE", jer(20, 5))
    c.fill_mask(np.roll(tm, 1, axis=0) & ~tm, C["m1"])
    c.fill_mask(tm, C["m3"])
    cr = [(w // 2 + 2, 1), (w // 2, 3), (w // 2 + 3, 5), (w // 2, 7), (w // 2 + 2, mt - 1)]
    for a, b in zip(cr, cr[1:]):
        c.line(*a, *b, C["d0"])
    for p in cr[1:4]:
        c.px(p[0] - 1, p[1], C["b2"])
    for (x, y) in [(w - 25, 1), (w - 24, 1), (w - 25, 2), (w - 24, 2), (w - 23, 2), (w - 24, 3), (w - 23, 3), (w - 22, 3)]:
        c.a[y, x] = 0
    for ex_, mir in ((3, False), (w - 10, True)):
        ey = 30
        if H:
            c.rect(ex_, ey, 7, 5, C["d0"]); c.rect(ex_ + 1, ey + 1, 5, 3, C["m1"])
            c.rect(ex_ + (3 if not mir else 2), ey + 1, 2, 3, C["d0"])
            pass
            for i in range(7):
                c.px(ex_ + (i if not mir else 6 - i), ey - 2 + (i * 2 // 6), C["d0"])
        else:
            c.hline(ex_, ex_ + 6, ey + 2, C["d0"]); c.hline(ex_ + 1, ex_ + 5, ey + 3, C["d1"])
    py = mt + sh + 3
    c.rect(16, py, 20, 6, C["d0"])
    c.rect(19, py + 1, 6, 4, C["d1"]); c.rect(27, py + 1, 6, 4, C["d1"])
    c.rect(21, py + 2, 2, 1, C["m2"]); c.rect(29, py + 2, 2, 1, C["p2"])
    for i, dy in enumerate([-2, -1, 0, 0, 0, -1, -2]):
        c.rect(46 + i * 4, py + 1 + dy, 2, 5, C["d0"])
    for i, bc in enumerate(("p2", "m2", "u3")):
        bx = w - 36 + i * 8
        c.circle(bx + 1, py + 3, 2, C["d0"]); c.circle(bx + 1, py + 3, 1, C[bc]); c.px(bx, py + 2, C["b4"])
    for (a, b) in (((w - 4, h - 16), (w - 12, h - 22)), ((w - 12, h - 22), (w - 9, h - 28)), ((6, 14), (10, 20)), ((10, 20), (8, 25))):
        c.line(*a, *b, C["d0"])
    if H:
        wb = sprite("web-corner.png").crop(0, 0, ml - 3, 12)
        c.blit(wb, 3, top + 1); c.blit(wb, w - ml, top + 1, mirror=True)
    c.outline(C["d0"], diagonal=True)
    return c


def shrine_aura(c, haunted):
    xs, ys = c.grid()
    d = np.sqrt(((xs - 217) / 100.0) ** 2 + ((ys - 52) / 66.0) ** 2)
    dth(c, d < 1, (1 - d) * 0.5, C["d6"]); dth(c, d < 0.8, (0.8 - d) * 0.5, C["d7"])
    # fused cabinet wings leaning on the shrine
    for pts, side in (([(141, 32), (157, 25), (157, 86), (141, 94)], -1), ([(277, 25), (293, 32), (293, 94), (277, 86)], 1)):
        m = c.poly_mask(pts)
        c.shade(m, 0.55 - 0.15 * ((xs - 141) / 16.0), [C["d2"], C["d3"], C["d4"], C["d5"]])
        c.poly(pts, C["d0"], fill=False)
        sx = 144 if side < 0 else 281
        c.rect(sx, 44, 9, 22, C["d0"]); c.rect(sx, 44, 9, 22, C["d4"], fill=False)
        c.hline(sx, sx + 8, 38, C["p1"])
    for (a, b, cc) in (((176, 9), (170, 2), (166, 0)), ((258, 9), (264, 2), (270, 0))):
        cable(c, bez(a, b, cc, 10), 1, C["d0"], C["d4"])


def pedestal(c, haunted, x0=178, x1=256, ya=84):
    for k, (y0, y1) in enumerate(((ya, ya + 16), (ya + 16, ya + 39))):
        xs_ = x0 + (3 if k else 0); xe = x1 - (3 if k else 0)
        for y in range(y0, y1):
            for x in range(xs_, xe):
                c.px(x, y, pick(RAMP_BG, 0.5 - 0.25 * (y - ya) / 40 - 0.2 * (x - x0) / 80, x, y))
        c.rect(xs_, y0, xe - xs_, y1 - y0, C["d0"], fill=False)
        for sx in range(xs_ + 6, xe - 14, 24):
            c.rect(sx, y0 + 3, 18, y1 - y0 - 8, C["d0"])
            c.rect(sx, y0 + 3, 18, y1 - y0 - 8, C["d2"], fill=False)
            pass


# ------------------------------------------------------------------ season ramps
def warm(season):
    return [C[k] for k in (("d3", "o1", "o2", "o3", "o4", "m4") if season == "haunted" else ("d3", "m1", "w3", "m2", "m3", "m4"))]


def neon_core(season):
    return dict(core=C["o3"], hi=C["o4"], halo=C["o1"]) if season == "haunted" else dict(core=C["m3"], hi=C["m4"], halo=C["m1"])


def neon_draw(c, m, core, hi, halo, ring=None):
    """A neon tube letter: a lit core, a bright inner line, a solid halo, a dithered outer ring."""
    outer = dilate(dilate(m, True), True) & ~dilate(m, True) & ~m
    if ring:
        xs, ys = c.grid()
        c.a[outer & (BAYER4[ys % 4, xs % 4] < 0.45)] = rgba(ring)
    c.fill_mask(dilate(m, True) & ~m, halo)
    c.fill_mask(m, core)
    c.fill_mask(m & erode(m) & ~erode(erode(m)) if False else erode(m), hi)


# ------------------------------------------------------------------ fortune booth (MADAME MOON)
def booth(season):
    H = season == "haunted"
    c = Canvas(46, 88)
    xs, ys = c.grid()
    WOODR = [C[k] for k in ("d1", "d2", "d3", "d4", "d5", "d6")]
    body = c.rect_mask(0, 12, 46, 76) | rr_mask(c, 0, 0, 46, 20, 7)
    c.shade(body, 0.62 - 0.4 * xs / 46 - 0.1 * ys / 88, WOODR)
    c.hline(2, 43, 17, C["m1"])
    c.rect(4, 3, 38, 12, C["d0"]); c.rect(4, 3, 38, 12, C["m1"], fill=False)
    tm = fit_mask(46, 88, (6, 4, 34, 5), "MADAME", [("Micro5", 10)]) | fit_mask(46, 88, (6, 10, 34, 5), "MOON", [("Micro5", 10)], spacing=2)
    c.fill_mask(tm, C["m3"])
    # glass window
    gx, gy, gw, gh = 5, 19, 36, 48
    glass = c.rect_mask(gx, gy, gw, gh)
    bx, by = 23, 58
    d = np.sqrt((xs - bx) ** 2 + ((ys - by) * 1.1) ** 2)
    g = 0.2 + 0.5 * np.clip(1 - d / 30, 0, 1)
    c.shade(glass, g * 0.9, [C[k] for k in ("d1", "d2", "d3", "u1", "d5")])
    fig = Canvas(46, 88)
    robe = fig.poly_mask([(15, 40), (31, 40), (36, 66), (10, 66)])
    fig.shade(robe, 0.35 + 0.4 * (1 - xs / 46) - 0.15 * (ys - 40) / 26, [C["d4"], C["u1"], C["u2"], C["u3"]])
    head = fig.ellipse_mask(23, 33, 4, 5)
    fig.shade(head, 0.5 + 0.4 * (1 - (xs - 19) / 9), [C["b1"], C["b2"], C["b3"], C["b4"]])
    hat = fig.ellipse_mask(23, 27, 6, 3) & (ys <= 29)
    fig.shade(hat, 0.5 + 0.1 * (1 - xs / 46), [C["u1"], C["u2"], C["u3"]])
    fig.hline(18, 28, 29, C["m1"]); fig.px(23, 24, C["m3"]); fig.px(22, 25, C["m2"]); fig.px(24, 25, C["m2"])
    fig.px(21, 33, C["m3"] if H else C["d1"]); fig.px(25, 33, C["m3"] if H else C["d1"])
    fig.rect(17, 54, 3, 2, C["b3"]); fig.rect(27, 54, 3, 2, C["b3"])
    fa = fig.alpha_mask() & glass
    face = fig.ellipse_mask(23, 33, 4, 5)
    if H:
        dth(c, fa, 0.66, C["b3"])
        c.a[fa & (BAYER4[ys % 4, xs % 4] < 0.66)] = fig.a[fa & (BAYER4[ys % 4, xs % 4] < 0.66)]
        c.a[fa & face] = fig.a[fa & face]
        # re-dither: show the figure's own colour where drawn
    else:
        c.a[fa] = fig.a[fa]
    c.rect(6, 62, 34, 5, C["d4"]); c.hline(6, 39, 62, C["m1"])
    for sx in (10, 17, 29, 35):
        c.px(sx, 64, C["m3"])
    # crystal ball = tiny yellow moon
    c.glow(bx, by - 1, 9, C["m1"], 0.9, 3, m=glass)
    c.circle(bx, by - 1, 4, C["m1"]); c.circle(bx, by - 1, 3, C["m2"])
    c.px(bx - 2, by - 3, C["m4"]); c.px(bx - 1, by - 3, C["m4"]); c.px(bx - 2, by - 2, C["m3"])
    c.hline(bx - 3, bx + 3, by + 3, C["m1"])
    # glass frame and reflections
    c.rect(gx - 1, gy - 1, gw + 2, gh + 2, C["d0"], fill=False)
    c.hline(gx, gx + gw - 1, gy, C["d6"]); c.vline(gx, gy, gy + gh - 1, C["d6"])
    for k in range(14):
        dth(c, c.rect_mask(gx + 4 + k, gy + 2 + k, 1, 1) & glass, 0.8, C["b4"])
    for k in range(9):
        dth(c, c.rect_mask(gx + 11 + k, gy + 2 + k, 1, 1) & glass, 0.6, C["b4"])
    # base: calm plate and the card slot
    c.hline(1, 44, 68, C["m1"]); c.hline(1, 44, 87, C["m1"])
    c.rect(3, 69, 40, 14, C["m1"], fill=False)
    c.rect(4, 70, 38, 12, C["d1"])
    c.rect(17, 84, 12, 2, C["d0"]); c.rect(22, 83, 3, 2, C["b4"])
    c.vline(1, 20, 66, C["d6"])
    c.outline(C["d0"], diagonal=True)
    return c


# ------------------------------------------------------------------ the prize doorway
def prize_el(season):
    """50 x 96: neon PRIZES sign (0..11) and the warm doorway (12..95)."""
    H = season == "haunted"
    nc = neon_core(season)
    W = warm(season)
    c = Canvas(50, 96)
    xs, ys = c.grid()
    c.rect(0, 0, 50, 12, C["d1"])
    c.rect(0, 0, 50, 12, nc["halo"], fill=False)
    c.px(0, 0, None); c.px(49, 0, None); c.px(0, 11, None); c.px(49, 11, None)
    tm = fit_mask(50, 96, (4, 1, 42, 10), "PRIZES", jer(16, 5), spacing=1)
    neon_draw(c, tm, nc["core"], nc["hi"], C["d3"] if False else nc["halo"])
    # chains up to the wall
    for x in (6, 43):
        pass
    DX, DY = 2, 12
    d = Canvas(46, 84)
    dxs, dys = d.grid()
    WOODR = [C[k] for k in ("d1", "d2", "d3", "d4", "d5")]
    d.shade(d.rect_mask(0, 0, 46, 84), 0.55 - 0.3 * dxs / 46, WOODR)
    ix, iy, iw, ih = 5, 6, 36, 78
    inner = d.rect_mask(ix, iy, iw, ih)
    f = 0.3 + 0.62 * (dys / 80.0) ** 1.1
    f = f * (0.85 + 0.15 * (1 - np.abs(dxs - 23) / 18))
    d.shade(inner, np.clip(f, 0, 1), W)
    packs = [C[k] for k in ("p2", "u2", "m2", "u3", "g3", "p3", "b3")]
    rng = random.Random(7)
    for bi, by_ in enumerate((22, 40, 58)):
        d.rect(ix, by_, iw, 2, C["d4"]); d.hline(ix, ix + iw - 1, by_, C["d6"])
        for k in range(7):
            col = packs[(k * 3 + bi * 2 + rng.randint(0, 2)) % len(packs)]
            px_ = ix + 1 + k * 5
            d.rect(px_, by_ - 8, 4, 8, col)
            d.hline(px_, px_ + 3, by_ - 8, C["b4"] if bi != 1 else C["m4"])
            d.vline(px_ + 3, by_ - 7, by_ - 1, C["d3"])
            d.px(px_ + 1, by_ - 4, C["d1"]); d.px(px_ + 2, by_ - 4, C["d1"])
    # counter and light on the floor
    d.rect(ix, 70, iw, 2, W[4]); d.hline(ix, ix + iw - 1, 69, W[5])
    d.rect(ix + 0, 72, iw, 12, W[3])
    dth(d, d.rect_mask(ix, 72, iw, 12), 0.5, W[4])
    # lamp
    d.rect(22, 6, 2, 3, C["d0"]); d.circle(23, 11, 2, W[5])
    d.glow(23, 11, 8, W[4], 0.9, 3, m=inner)
    # frame (jambs, lintel, bulbs)
    d.rect(0, 0, 46, 84, C["d0"], fill=False)
    d.rect(4, 5, 38, 80, C["d0"], fill=False)
    d.hline(1, 44, 1, C["d6"])
    for bx in range(6, 42, 7):
        d.rect(bx, 2, 2, 2, W[5]); d.px(bx, 4, W[2])
    # the calm doormat
    d.rect(4, 71, 38, 12, W[1]) if False else None
    d.rect(ix, 72, iw, 10, C["d1"])
    d.rect(ix - 1, 71, iw + 2, 12, W[2], fill=False)
    c.blit(d, DX, DY)
    c.outline(C["d0"], diagonal=True)
    return c


# ------------------------------------------------------------------ the crooked neon sign (fg)
def sign_img(season, state=0):
    """118 x 30. state of the flickering letter: 0 lit, 1 off, 2 dim. Returns (canvas, flicker_bbox)."""
    nc = neon_core(season)
    H = season == "haunted"
    T = Canvas(118, 30)
    T.fill_mask(rr_mask(T, 1, 5, 116, 23, 2), C["d1"])
    T.rect(1, 5, 116, 23, C["d0"], fill=False)
    T.hline(3, 114, 6, C["d4"])
    m = fit_mask(118, 30, (6, 8, 106, 9), "FRIGHT FEST", jer(22, 8), spacing=1)
    ys_, xs_ = np.nonzero(m)
    cols = np.zeros(118, dtype=bool); cols[np.unique(xs_)] = True
    runs = []; x = 0
    while x < 118:
        if cols[x]:
            x0 = x
            while x < 118 and cols[x]:
                x += 1
            runs.append((x0, x - 1))
        else:
            x += 1
    gaps = [(runs[i + 1][0] - runs[i][1], i) for i in range(len(runs) - 1)]
    split = max(gaps)[1]
    left = m.copy(); left[:, runs[split][1] + 1:] = False
    right = m & ~left
    fl_run = runs[split + 1]
    fm = m.copy(); fm[:, :fl_run[0]] = False; fm[:, fl_run[1] + 1:] = False
    rest_r = right & ~fm
    pk = dict(core=C["p2"], hi=C["p3"], halo=C["p1"]) if H else nc
    neon_draw(T, left, pk["core"], pk["hi"], pk["halo"], ring=C["p0"] if H else C["bm1"])
    neon_draw(T, rest_r, nc["core"], nc["hi"], nc["halo"], ring=C["o1"] if H else C["bm1"])
    if state == 0:
        neon_draw(T, fm, nc["core"], nc["hi"], nc["halo"], ring=C["o1"] if H else C["bm1"])
    elif state == 2:
        neon_draw(T, fm, nc["halo"], nc["halo"], C["d3"], ring=None)
    else:
        T.fill_mask(fm, C["d3"]); T.fill_mask(fm & erode(fm), C["d2"])
    # wordmark with the raised yellow dot
    wm = fit_mask(118, 30, (66, 21, 32, 6), "hallpass", [("Micro5", 10)])
    ys2, xs2 = np.nonzero(wm)
    T.fill_mask(wm, C["b4"])
    T.rect(int(xs2.max()) + 2, int(ys2.min()) + 1, 2, 2, C["w3"])
    # crooked: the right end sags (1 px per 30 columns), left chain short
    S = Canvas(118, 30)
    for i in range(118):
        sh = i // 30
        S.a[sh:, i] = T.a[: 30 - sh, i]
    for cx, top in ((12, 0), (104, 0)):
        by = 5 + cx // 30
        for y in range(top, by):
            S.px(cx, y, C["b1"] if (y % 2 == 0) else C["d5"])
            S.px(cx + 1, y, C["d3"])
    fb = (int(fl_run[0]) - 1, int(ys_.min()) + fl_run[0] // 30 - 1, int(fl_run[1] - fl_run[0]) + 3, int(ys_.max() - ys_.min()) + 4)
    return S, fb


# ------------------------------------------------------------------ the bg layer
SLOTS = [(40, 96), (185, 90), (330, 96)]
BEAM = [(98, 0), (132, 0), (184, 178), (136, 178)]
BEAM_CORE = [(108, 0), (122, 0), (166, 178), (150, 178)]


def sky_window(c, season, bats=True):
    pts = [(94, 0), (138, 0), (135, 6), (130, 3), (125, 8), (119, 5), (113, 8), (107, 4), (101, 7), (96, 4)]
    m = c.poly_mask(pts)
    xs, ys = c.grid()
    c.fill_mask(m, C["bm1"])
    dth(c, m, 0.6, C["bm2"]); dth(c, m & (ys < 4), 0.5, C["m3"])
    c.line(113, 0, 111, 6, C["d0"]); c.line(125, 0, 126, 7, C["d0"])
    c.hline(92, 140, 0, C["d0"])
    for (a, b) in ((95, 4), (101, 7), (107, 4)):
        c.px(a, b + 1, C["d1"])


def silhouette(name, col):
    s = sprite(name)
    s.a[s.a[:, :, 3] > 0, :3] = rgba(col)[:3]
    return s


def build_bg(season, eye_state=0, track=None, anim_eyes=None):
    H = season == "haunted"
    P = DESK
    c = Canvas(434, 230)
    draw_room(c, P)
    haze_glow(c, P)
    xs, ys = c.grid()
    sky_window(c, season)
    if H:
        c.blit(silhouette("bat-a.png", C["d0"]), 106, 1); c.blit(silhouette("bat-b.png", C["d0"]), 122, 3)
    # shrine behind everything
    shrine_aura(c, H)
    pedestal(c, H)
    c.blit(shrine(season), 155, 8)
    # roots: cables from the shrine pedestal across floor and walls
    for (p0, p1, p2, th) in (((200, 118), (170, 150), (92, 210), 3), ((236, 118), (270, 150), (350, 214), 3), ((190, 112), (120, 120), (84, 70), 2),
                            ((246, 112), (310, 118), (352, 60), 2), ((212, 122), (205, 170), (150, 225), 2), ((224, 122), (240, 175), (300, 226), 2)):
        cable(c, bez(p0, p1, p2), th, C["d0"], C["d3"])
    # wall posters on the long walls
    for (x0, y0, w, h, k, side) in ((52, 46, 14, 20, "moon", -1), (68, 52, 12, 18, "q", -1), (84, 56, 12, 17, "eyes", -1), (354, 50, 14, 20, "q", 1), (338, 54, 13, 18, "moon", 1)):
        poster(c, x0, y0, w, h, k, side)
    # dead rows
    blink = dict(side=-1, i=1, state=eye_state, tr=track) if track is not None else dict(side=-1, i=1, state=eye_state, tr=None)
    dead_rows(c, P, H, {}, blink=blink)
    # floor guide lights leading to the shrine, and two puddles
    for k in range(14):
        z = 1.7 * (1.28 ** k)
        dxg = P["A"] * 0.8 / z
        yy = P["vy"] + int(round(P["A"] / z))
        if yy >= c.h:
            continue
        sz = 2 if z < 3.2 else 1
        for side, (c1, c2) in ((-1, ("p1", "p2")), (1, ("m1", "m2"))):
            xx = P["vx"] + side * int(round(dxg))
            c.rect(xx, yy, sz + 1, sz, C[c1]); c.px(xx, yy, C[c2])
    for (px_, py_, rx, ry) in ((62, 214, 30, 4), (376, 216, 32, 4)):
        dd = np.sqrt(((xs - px_) / float(rx)) ** 2 + ((ys - py_) / float(ry)) ** 2)
        dth(c, dd < 1, (1 - dd) * 0.9, C["d6"]); dth(c, dd < 0.6, (0.6 - dd) * 0.8, C["d8"])
    # moon shaft from the broken skylight
    lift(c, c.poly_mask(BEAM), 1)
    lift(c, c.poly_mask(BEAM_CORE), 2)
    dd = np.sqrt(((xs - 160) / 46.0) ** 2 + ((ys - 180) / 7.5) ** 2)
    pool = (dd < 1) & floor_mask(c, P)
    lift(c, pool, 1); lift(c, pool & (dd < 0.55), 2)
    # slot reflections and the warm doorway spill
    for (sx, sy) in SLOTS:
        dd = np.sqrt(((xs - (sx + 32)) / 36.0) ** 2 + ((ys - (sy + 101)) / 7.0) ** 2)
        dth(c, dd < 1, (1 - dd) * 0.7, C["d4"]); dth(c, dd < 0.6, (0.6 - dd) * 0.8, C["d5"])
    fm = floor_mask(c, P)
    cols = ("sp1", "sp2", "o1") if H else ("sc1", "sc2", "sc3")
    for (y1, col) in ((176, cols[0]), (166, cols[1]), (156, cols[2])):
        pts = [(272, 146), (318, 146), (318 + y1 - 146, y1), (272 - (y1 - 146), y1)]
        solid_band(c, c.poly_mask(pts) & fm, C[col])
    # plaque (egg), pumpkin (haunted)
    c.blit(sprite("plaque-000.png"), 326, 100)
    if H:
        c.blit(sprite("pumpkin-sm.png"), 256, 80)
    # the booth and the doorway stand in front of the rows
    c.blit(booth(season), 118, 84)
    c.blit(prize_el(season), 270, 50)
    return c


# ------------------------------------------------------------------ competition cabinets (64 x 104)
KEYS = ["lastbell", "shadowcore", "std", "mystery"]
SCR = (9, 18, 46, 42)
BTN = (8, 72, 48, 15)


def dim(cv, k):
    a = cv.a
    base = np.array(rgba(C["d1"])[:3], dtype=np.float32)
    rgb = a[:, :, :3].astype(np.float32)
    a[:, :, :3] = np.clip(rgb * (1 - k) + base * k, 0, 255).astype(np.uint8)
    return cv


def scr_lastbell(f):
    s = Canvas(46, 42); xs, ys = s.grid()
    s.rect(0, 0, 46, 42, C["g0"])
    L = s.poly_mask([(0, 0), (19, 14), (19, 22), (0, 41)]); R = s.poly_mask([(45, 0), (26, 14), (26, 22), (45, 41)])
    CE = s.poly_mask([(0, 0), (45, 0), (26, 14), (19, 14)]); FL = s.poly_mask([(0, 41), (19, 22), (26, 22), (45, 41)])
    wf = 1 - np.abs(xs - 22.5) / 23.0
    s.shade(L | R, wf * 0.9 + 0.05, [C["g0"], C["g1"], C["g2"], C["g3"]])
    s.shade(CE, 0.25 + 0.3 * (ys / 14.0), [C["g0"], C["g1"], C["g2"]])
    yy = np.maximum(ys - 17, 1)
    uu = (xs - 22.5) / yy
    tile = (np.floor(uu * 2.4).astype(int) + np.floor(34.0 / yy).astype(int)) % 2
    s.shade(FL, np.where(tile == 0, 0.2 + 0.35 * (1 - ys / 41.0), 0.04 + 0.1 * (1 - ys / 41.0)), [C["g0"], C["g1"], C["g2"], C["g3"]], dither=False)
    for x in (3, 7, 11, 14, 16, 17):
        for sx in (x, 45 - x):
            for y in range(46):
                if (L | R)[y, sx] if 0 <= y < 42 else False:
                    s.px(sx, y, C["g0"])
            yt = int(14 * sx / 19.0) if sx < 22 else int(14 * (45 - sx) / 19.0)
            s.px(sx + (1 if sx < 22 else -1), yt + 6 + (3 if x < 8 else 1), C["g0"])
    s.rect(19, 14, 7, 8, C["g4"])
    figx = 22 + (1 if f == 2 else 0)
    s.rect(figx, 16, 2, 2, C["d0"]); s.rect(figx, 18, 2, 4, C["d0"])
    s.rect(33, 11, 3, 14, C["g1"]); s.rect(33, 11, 3, 14, C["g0"], fill=False); s.px(34, 18, C["g3"])
    s.rect(33, 7, 2, 2, C["r4"] if f != 1 else C["r1"])
    if f != 1:
        dth(s, dilate(s.rect_mask(33, 7, 2, 2)) & ~s.rect_mask(33, 7, 2, 2), 0.6, C["r2"])
    s.hline(20, 24, 2, C["b4"] if f != 1 else C["g3"])
    return s


def scr_shadowcore(f):
    s = Canvas(46, 42); xs, ys = s.grid()
    s.shade(s.rect_mask(0, 0, 46, 42), 0.25 + 0.25 * (ys / 42.0), [C["d1"], C["d2"], C["d3"], C["d4"]])
    m = s.ellipse_mask(31, 14, 11, 11)
    s.shade(m, 0.55 + 0.45 * (1 - (xs - 20) / 22.0) - 0.2 * (ys - 3) / 22.0, [C["b1"], C["b2"], C["b3"], C["b4"]])
    for (cx, cy, r) in ((35, 18, 2), (28, 10, 1), (33, 8, 1)):
        s.circle(cx, cy, r, C["b2"])
    s.rect(0, 35, 46, 7, C["d0"]); s.hline(0, 45, 35, C["p2"])
    for i, sx in enumerate((26, 31, 36, 41)):
        for k in range(5):
            s.hline(sx + k // 2 - 0, sx + 4 - k // 2, 34 - k, C["p2"] if k != 0 else C["p3"])
            s.hline(sx + 1 + k // 2, sx + 3 - k // 2, 34 - k, C["p0"]) if k < 2 else None
    by = (27, 23, 27)[f]
    s.circle(11, by, 4, C["d0"])
    s.rect(7, by - 1, 1, 1, C["d0"])
    s.px(9, by - 1, C["b4"]); s.px(9, by, C["b4"]); s.px(12, by - 1, C["b4"]); s.px(12, by, C["b4"])
    s.hline(2, 8, 35, C["p3"])
    return s


def scr_std(f):
    s = Canvas(46, 42); xs, ys = s.grid()
    s.shade(s.rect_mask(0, 0, 46, 42), 0.1 + 0.45 * (ys / 42.0), [C["r0"], C["r1"], C["r2"]])
    m = s.ellipse_mask(31, 13, 7, 7)
    s.shade(m, 0.45 + 0.55 * (1 - (xs - 24) / 14.0), [C["r3"], C["r4"], C["am"]])
    s.px(29, 11, C["am"]); s.px(30, 10, C["am"])
    def pine(cx, base, h, col):
        for k in range(h):
            s.hline(cx - k // 3 - 1 + 0, cx + k // 3 + 1, base - h + k, col)
        s.rect(cx, base, 1, 2, col)
    for cx, b, h, col in ((4, 36, 18, C["r0"]), (11, 38, 14, C["r0"]), (38, 36, 20, C["r0"]), (43, 38, 14, C["r0"]), (17, 34, 9, C["r1"]), (31, 33, 8, C["r1"])):
        pine(cx, b, h, col)
    s.rect(0, 37, 46, 5, C["r0"])
    s.rect(22, 29, 3, 3, C["b3"]); s.rect(21, 28, 5, 1, C["am"]); s.rect(22, 32, 3, 4, C["g2"]); s.rect(22, 36, 1, 2, C["d1"]); s.rect(24, 36, 1, 2, C["d1"])
    s.px(27, 33, C["d1"]); s.px(28, 32, C["d1"])
    on = [(0, 1), (1, 1), (0, 0)][f]
    for (ex, ey, vis) in ((9, 27, on[0]), (14, 30, on[1]), (36, 26, 1 - on[0] if f == 2 else 1)):
        if vis:
            s.px(ex, ey, C["am"]); s.px(ex + 2, ey, C["am"])
    return s


def scr_mystery(f, season, eyes_open=True):
    H = season == "haunted"
    ec, eh = (C["o3"], C["o4"]) if H else (C["m2"], C["m4"])
    s = Canvas(46, 42); xs, ys = s.grid()
    s.rect(0, 0, 46, 42, C["d0"])
    dth(s, s.rect_mask(0, 0, 46, 42), 0.1, C["d2"])
    for (ex, ey) in ((10, 17), (28, 17)):
        if not eyes_open:
            ec2 = C["o1"] if H else C["m1"]
            s.rect(ex, ey + 2, 8, 2, ec2); s.px(ex + 1, ey + 4, ec2); s.px(ex + 6, ey + 4, ec2); s.px(ex + 3, ey + 4, ec2); s.px(ex + 4, ey + 4, ec2)
            dth(s, dilate(s.rect_mask(ex, ey + 2, 8, 2)) & ~s.rect_mask(ex, ey + 2, 8, 2), 0.3, C["d3"])
            continue
        if f == 1:
            s.rect(ex, ey + 2, 8, 2, ec)
        else:
            s.rect(ex + 1, ey, 6, 5, ec); s.rect(ex, ey + 1, 8, 3, ec); s.rect(ex + 3, ey + 1, 2, 3, C["d0"]); s.px(ex + 1, ey + 1, eh)
        d = dilate(dilate(s.rect_mask(ex, ey, 8, 5))) & ~s.rect_mask(ex, ey, 8, 5)
        dth(s, d, 0.35, C["o1"] if H else C["m1"])
    return s


KEYSPEC = dict(
    lastbell=dict(body=["g0", "g1", "g2", "g3"], trim="g3", rim="g4", text="LAST BELL", tcol="b4", board="g0", glow="g3"),
    shadowcore=dict(body=["d0", "d1", "d2", "d4"], trim="p2", rim="p2", text="SHADOW CORE", tcol="b4", board="d0", glow="p2"),
    std=dict(body=["r0", "r1", "r2", "r3"], trim="am", rim="r4", text="SURVIVE|TILL DAWN", tcol="r4", board="r0", glow="r4"),
    mystery=dict(body=["d2", "d4", "u1", "u2", "u3"], trim="u3", rim="u3", text="???", tcol="u3", board="d1", glow="o3"),
)


def cab_masks(key, c):
    if key == "lastbell":
        marq = c.rect_mask(6, 6, 52, 11) | c.poly_mask([(28, 5), (29, 2), (31, 0), (33, 0), (35, 2), (36, 5)])
        body = c.poly_mask([(4, 17), (59, 17), (59, 91), (61, 103), (2, 103), (4, 91)])
    elif key == "shadowcore":
        marq = c.poly_mask([(6, 16), (3, 0), (14, 7), (49, 7), (60, 0), (58, 16)])
        body = c.poly_mask([(5, 17), (58, 17), (58, 92), (61, 103), (2, 103), (5, 92)])
    elif key == "std":
        marq = c.poly_mask([(5, 16), (5, 9), (14, 4), (32, 0), (50, 4), (59, 9), (59, 16)])
        body = c.poly_mask([(4, 17), (59, 17), (59, 91), (61, 103), (2, 103), (4, 91)])
    else:
        marq = rr_mask(c, 3, 3, 58, 14, 5)
        body = c.poly_mask([(4, 17), (59, 17), (60, 45), (59, 75), (61, 103), (3, 103), (4, 75), (2, 45)])
    return marq, body


def cab_sprite(key, on, season="haunted"):
    sp = KEYSPEC[key]
    c = Canvas(64, 104); xs, ys = c.grid()
    marq, body = cab_masks(key, c)
    ramp = [C[k] for k in sp["body"]]
    sil = marq | body
    f = 0.82 - 0.38 * (xs / 64.0) - 0.22 * (ys / 104.0)
    f = np.where(sil & ~erode(sil) & ((xs < 8) | (ys < 4)), f + 0.2, f)
    c.shade(sil, f, ramp)
    trim = C[sp["trim"]]
    # side art on the rails
    for y in range(20, 88):
        if key == "lastbell":
            if y % 5 == 0:
                c.hline(5, 8, y, C["g0"]); c.hline(55, 58, y, C["g0"]); c.hline(5, 8, y + 1, C["g3"]); c.hline(55, 58, y + 1, C["g3"])
        elif key == "shadowcore":
            c.px(6, y, C["p2"] if on else C["p1"]); c.px(57, y, C["p2"] if on else C["p1"])
        elif key == "std":
            if y % 8 == 0:
                c.hline(4, 8, y, C["r0"]); c.hline(55, 59, y, C["r0"])
            if y % 16 == 3:
                c.px(6, y, C["am"]); c.px(57, y, C["am"])
        else:
            if (y * 7) % 11 == 0:
                c.px(5 + (y % 3), y, C["u3"]); c.px(58 - (y % 3), y, C["u3"])
    # screen bezel + picture
    c.rect(7, 16, 50, 46, C["d0"]); c.rect(7, 16, 50, 46, trim if on else mix(trim, C["d1"], 0.5), fill=False)
    fr = {"lastbell": scr_lastbell, "shadowcore": scr_shadowcore, "std": scr_std}.get(key)
    pic = fr(0) if fr else scr_mystery(0, season, eyes_open=on)
    if not on:
        pic = dim(pic, 0.5)
    c.blit(pic, SCR[0], SCR[1])
    if on:
        ring = dilate(dilate(c.rect_mask(7, 16, 50, 46))) & ~c.rect_mask(7, 16, 50, 46) & body
        dth(c, ring, 0.5, C[sp["glow"]] if key != "mystery" or season == "haunted" else C["m2"])
        dth(c, dilate(ring) & ~ring & body, 0.25, C[sp["glow"]] if key != "mystery" or season == "haunted" else C["m2"])
    # marquee board with lettering and eyelids
    bm = marq & erode(marq) & erode(erode(marq)) if key != "lastbell" else c.rect_mask(8, 8, 48, 8)
    if key == "lastbell":
        c.rect(8, 7, 48, 10, C["g0"]); c.rect(8, 7, 48, 10, C["g2"], fill=False); bm = c.rect_mask(10, 9, 44, 6)
    else:
        c.fill_mask(bm, C[sp["board"]])
    tcol = C[sp["tcol"]]
    tdim = rgba(tcol)
    if not on:
        tcol = mix(tcol, C[sp["board"]], 0.5)
    ys_b, xs_b = np.nonzero(bm)
    bx0, by0, bx1, by1 = xs_b.min(), ys_b.min(), xs_b.max(), ys_b.max()
    if key == "std":
        a = fit_mask(64, 104, (bx0 + 3, by0 + 1, bx1 - bx0 - 5, 5), "SURVIVE", [("Micro5", 10), ("Micro5", 9)])
        b = fit_mask(64, 104, (bx0 + 3, by0 + 7, bx1 - bx0 - 5, 5), "TILL DAWN", [("Micro5", 10), ("Micro5", 9)])
        tm = a | b
    elif key == "lastbell":
        tm = fit_mask(64, 104, (11, 9, 42, 6), "LAST BELL", jer(12, 5))
    elif key == "shadowcore":
        tm = fit_mask(64, 104, (9, 8, 46, 7), "SHADOW CORE", jer(30, 5, "Jersey15") + [("Micro5", 10)])
    else:
        tm = fit_mask(64, 104, (bx0 + 8, by0 + 2, bx1 - bx0 - 14, 7), "???", jer(12, 5), spacing=2)
    if key == "shadowcore":
        c.fill_mask(np.roll(tm, 1, axis=0) & ~tm, C["p1"] if on else C["p0"])
    c.fill_mask(tm & bm, tcol)
    # eyelids: closed when off (heavy), open when on (thin)
    lid_col = ramp[0] if key != "shadowcore" else C["d1"]
    cx = (bx0 + bx1) / 2.0; hw = (bx1 - bx0) / 2.0 + 1
    ty_, tx_ = np.nonzero(tm & bm)
    tt0, tt1 = (ty_.min(), ty_.max()) if len(ty_) else (by0 + 3, by1 - 3)
    th = 1 if on else 6
    for x in range(bx0, bx1 + 1):
        k = 1 - ((x - cx) / hw) ** 2
        top = min(int(round(th * k)), max(tt0 - by0 - 1, 0))
        bot = min(int(round(th * k)), max(by1 - tt1 - 1, 0))
        for y in range(by0, by0 + top):
            if bm[y, x]:
                c.px(x, y, lid_col)
        for y in range(by1 - bot + 1, by1 + 1):
            if bm[y, x]:
                c.px(x, y, lid_col)
    if not on:
        for x in range(bx0 + 4, bx1 - 2, 6):
            c.px(x, by1 + 1, C["d0"])
    # control panel
    c.rect(7, 62, 50, 9, ramp[1]); c.hline(7, 56, 62, ramp[-1] if on else ramp[2])
    c.circle(16, 66, 2, C["d0"]); c.px(16, 64, C["p2"] if on else C["p1"]); c.px(15, 63, C["b2"]); c.vline(16, 67, 69, C["d0"])
    for i, bc in enumerate(("p2", "m2", "u3", "w3")):
        c.circle(30 + i * 6, 67, 1, C[bc] if on else C["d4"]); c.px(30 + i * 6, 66, C["b4"] if on else C["d5"])
    # PLAY strip: flat and calm
    c.rect(BTN[0] - 1, BTN[1] - 1, BTN[2] + 2, BTN[3] + 2, trim if on else C["d4"], fill=False)
    c.rect(*BTN, C["d1"])
    # base with root cables
    for (p0, p1, p2) in (((14, 90), (8, 100), (3, 103)), ((50, 90), (58, 100), (61, 103)), ((26, 92), (24, 100), (14, 103)), ((38, 92), (40, 100), (50, 103))):
        cable(c, bez(p0, p1, p2, 24), 2, C["d0"], ramp[2])
    c.hline(4, 59, 88, ramp[2]); c.hline(4, 59, 89, ramp[0])
    c.outline(C["d0"], diagonal=True)
    if on:
        edge = dilate(sil, True) & ~sil
        inner = sil & ~erode(sil) & ((xs < 10) | (ys < 6))
        c.fill_mask(inner, C[sp["rim"]])
    return c


def build_cabs(season="haunted"):
    for k in KEYS:
        for on in (False, True):
            save(cab_sprite(k, on, "haunted"), f"cab-{k}-{'on' if on else 'off'}.png")
        fr = {"lastbell": scr_lastbell, "shadowcore": scr_shadowcore, "std": scr_std}.get(k)
        strip = Canvas(138, 42)
        for i in range(3):
            strip.blit(fr(i) if fr else scr_mystery(i, "haunted"), 46 * i, 0)
        save(strip, f"scr-{k}.png")
    for on in (False, True):
        save(cab_sprite("mystery", on, "calm"), f"cab-mystery-{'on' if on else 'off'}-calm.png")
    strip = Canvas(138, 42)
    for i in range(3):
        strip.blit(scr_mystery(i, "calm"), 46 * i, 0)
    save(strip, "scr-mystery-calm.png")
    p = Canvas(80, 28); xs, ys = p.grid()
    d = np.sqrt(((xs - 40) / 40.0) ** 2 + ((ys - 14) / 13.0) ** 2)
    dth(p, d < 1, (1 - d) * 0.9, C["d7"]); dth(p, d < 0.75, (0.75 - d) * 0.9, C["d8"]); dth(p, d < 0.4, (0.4 - d) * 0.9, C["d9"])
    save(p, "pool-on.png")


# ------------------------------------------------------------------ fog strip
def build_fog():
    """Three solid, low-contrast haze bands with wavy edges; seamless in x (integer sine cycles)."""
    W, Hh = 434, 40
    c = Canvas(W, Hh)
    tp = 2 * math.pi
    xs = np.arange(W)
    for (y0, th, col, k1, k2, p1, p2) in ((3, 8, "d4", 2, 5, 0.3, 1.1), (15, 9, "d5", 3, 7, 1.9, 0.4), (28, 8, "d4", 2, 6, 4.0, 2.2)):
        top = y0 + 2.2 * np.sin(tp * k1 * xs / W + p1) + 1.2 * np.sin(tp * k2 * xs / W + p2)
        bot = top + th + 1.8 * np.sin(tp * (k1 + 1) * xs / W + p2)
        for x in range(W):
            for y in range(int(round(top[x])), int(round(bot[x]))):
                if 0 <= y < Hh:
                    c.a[y, x] = (*rgba(C["d8"])[:3], 34 if col == "d4" else 46)
    return c


# ------------------------------------------------------------------ the foreground layer
def build_fg(season, ghost_frame=0, sign_state=0):
    H = season == "haunted"
    c = Canvas(434, 230)
    rng = random.Random(11)
    if H:
        c.blit(sprite("web-corner.png"), 0, 0)
        c.blit(sprite("web-corner.png"), 418, 0, mirror=True)
        g = sprite(["ghost.png", "ghost-wave.png", "ghost.png"][ghost_frame])
        c.blit(g, 401 - (1 if ghost_frame == 1 else 0), 66 + (1 if ghost_frame == 2 else 0))
    # cabinet slabs at the edges (nearest, darkest)
    xs, ys = c.grid()
    left = c.poly_mask([(0, 34), (22, 45), (26, 230), (0, 230)])
    right = c.poly_mask([(433, 24), (412, 35), (408, 230), (433, 230)])
    c.fill_mask(left | right, C["d0"])
    for m, x0, sg in ((left, 0, 1), (right, 433, -1)):
        e = m & ~erode(m)
        c.fill_mask(e & ((xs > 18) if sg > 0 else (xs < 416)) & ((ys > 46)), C["d4"] if sg > 0 else C["d3"])
        dth(c, m & (xs > (14 if sg > 0 else 419)) & (xs < (22 if sg > 0 else 411 + 0)) & (ys > 46), 0.2, C["d2"])
        for y in range(60, 226, 22):
            c.hline(2 if sg > 0 else 412, 12 if sg > 0 else 431, y, C["d1"])
    c.rect(13, 72, 8, 30, C["d1"]); c.rect(13, 72, 8, 30, C["d2"], fill=False)
    c.rect(413, 70, 8, 30, C["d1"]); c.rect(413, 70, 8, 30, C["d2"], fill=False)
    # hanging cables and the broken neon tube
    for (x, dy, sag) in ((286, 18, 4), (296, 28, -3), (322, 12, 3), (344, 24, -4), (372, 16, 3), (396, 30, 5), (142, 22, 3), (148, 14, -2)):
        cable(c, bez((x, 0), (x + sag, dy * 1.2), (x + sag * 2, dy), 40), 1 if dy < 20 else 2, C["d0"], C["d3"])
    cable(c, bez((300, 6), (336, 20), (374, 14), 60), 3, C["d3"], C["d6"])
    c.line(300, 0, 300, 6, C["d1"]); c.line(374, 0, 376, 13, C["d1"])
    for x in (310, 340, 362):
        c.vline(x, 0, 10 + (x - 300) // 8, C["d2"])
    if H:
        dth(c, c.rect_mask(374, 12, 8, 6), 0.6, C["p1"]); c.px(376, 15, C["p2"]); c.px(378, 17, C["p3"])
        s = sprite("spider.png"); c.vline(143, 0, 24, C["d6"]); c.blit(s, 139, 24)
    # floor cables
    for k, (y0, amp, ph, th) in enumerate(((223, 3.0, 0.0, 3), (227, 2.0, 2.0, 3), (219, 2.5, 4.1, 2))):
        pts = [(x, y0 + amp * math.sin(x / 17.0 + ph)) for x in range(0, 434)]
        cable(c, pts, th, C["d0"], C["d3"])
    for x in (62, 150, 266, 352):
        c.rect(x, 225, 6, 5, C["d1"]); c.rect(x, 225, 6, 5, C["d4"], fill=False)
    # the crooked neon sign on chains and its ticker
    sg, _ = sign_img(season, sign_state)
    c.blit(sg, 16, 4)
    for cx in (28, 120):
        c.vline(cx, 0, 4, C["b1"])
    c.rect(22, 35, 106, 12, C["d2"]); c.rect(22, 35, 106, 12, C["d0"], fill=False)
    c.rect(24, 36, 102, 9, C["d1"])
    c.vline(30, 33, 35, C["b1"]); c.vline(118, 33, 35, C["b1"])
    for x in range(26, 126, 6):
        c.px(x, 35, C["d5"] if H else C["d6"])
    return c


def composite(season, states, scale=3, layers=True, slots=SLOTS, cabsel=None):
    bg = Canvas.load(os.path.join(OUT, f"desk-bg-{season}.png"))
    for (sx, sy), (k, on) in zip(slots, states):
        if on:
            bg.blit(Canvas.load(os.path.join(OUT, "pool-on.png")), sx - 8, sy + 88)
    for (sx, sy), (k, on) in zip(slots, states):
        name = f"cab-{k}-{'on' if on else 'off'}" + ("-calm" if (k == "mystery" and season == "calm") else "") + ".png"
        bg.blit(Canvas.load(os.path.join(OUT, name)), sx, sy)
    if layers == "fg":
        bg.blit(Canvas.load(os.path.join(OUT, f"desk-fg-{season}.png")), 0, 0)
    elif layers:
        fg_ = Canvas.load(os.path.join(OUT, "fog.png"))
        bg.blit(fg_, 0, 150)
        bg.blit(Canvas.load(os.path.join(OUT, f"desk-fg-{season}.png")), 0, 0)
    return bg


# ------------------------------------------------------------------ phone scene (195 x 300)
BEAM_P = [(8, 0), (36, 0), (92, 238), (52, 238)]


def build_phone(season):
    H = season == "haunted"
    P = PHONE
    c = Canvas(195, 300); xs, ys = c.grid()
    draw_room(c, P); haze_glow(c, P)
    m = c.poly_mask([(10, 0), (46, 0), (43, 5), (36, 3), (30, 7), (24, 4), (17, 7), (13, 4)])
    c.fill_mask(m, C["bm1"]); dth(c, m, 0.6, C["bm2"]); dth(c, m, 0.4, C["m3"])
    if H:
        c.blit(silhouette("bat-a.png", C["d0"]), 20, 1)
    lift(c, c.poly_mask(BEAM_P), 1)
    lift(c, c.poly_mask([(17, 0), (27, 0), (76, 238), (64, 238)]), 2)
    pedestal(c, H, 66, 128, 74)
    for (p0, p1, p2, th) in (((80, 96), (62, 120), (20, 170), 2), ((114, 96), (134, 120), (176, 172), 2), ((90, 100), (92, 140), (60, 200), 2), ((104, 100), (108, 140), (140, 204), 2)):
        cable(c, bez(p0, p1, p2), th, C["d0"], C["d3"])
    c.blit(shrine(season, 110, 72, 50, 10, 10), 43, 10)
    dead_rows(c, P, H, {}, lz0=1.7, rz0=1.7, outer=False, eyes_l=(3,), eyes_r=())
    sx, sy = 65, 150
    dd = np.sqrt(((xs - (sx + 32)) / 38.0) ** 2 + ((ys - 252) / 8.0) ** 2)
    dth(c, dd < 1, (1 - dd) * 0.7, C["d4"]); dth(c, dd < 0.6, (0.6 - dd) * 0.8, C["d5"])
    if H:
        c.blit(sprite("ghost.png"), 181, 112)
    fog = build_fog()
    c.blit(fog.crop(120, 0, 195, 40), 0, 112); c.blit(fog.crop(300, 0, 195, 40), 0, 176)
    # rows 258..300 calm: flat dark floor
    c.rect(0, 258, 195, 42, C["d1"])
    dth(c, c.rect_mask(0, 250, 195, 8), 0.5, C["d1"])
    return c


# ------------------------------------------------------------------ frames and tile
def _flip(a, h=False, v=False):
    if h:
        a = a[:, ::-1]
    if v:
        a = a[::-1, :]
    return a


def frame_img(kind):
    prof = dict(
        board=[C[k] for k in ("d0", "d5", "d4", "d4", "d3", "d3", "d2", "d0")],
        quest=[C[k] for k in ("d0", "m1", "m3", "m2", "m1", "d0")],
        prize=[C[k] for k in ("d1", "d1", "d1", "o1" if False else "m1", "m3", "m3", "m1", "d1")],
        paper=[C[k] for k in ("b2", "b3", "b3", "b3", "b3", "b3", "b3", "b3")],
    )[kind]
    fill = dict(board="d1", quest="d3", prize="d1", paper="b3")[kind]
    cn = Canvas(16, 16); et = Canvas(16, 16)
    for cv in (cn, et):
        cv.rect(0, 0, 16, 16, C[fill])
    for y in range(16):
        for x in range(16):
            e = min(x, y)
            ee = y
            if e < len(prof):
                cn.px(x, y, prof[e])
            if ee < len(prof):
                et.px(x, y, prof[ee])
    for x in range(16):
        if kind == "board":
            if x % 8 == 3:
                et.px(x, 3, C["d0"]); et.px(x, 4, C["d2"])
            if x % 8 in (1, 2):
                et.px(x, 6, C["d1"])
        elif kind == "quest":
            if x % 4 == 1:
                et.px(x, 2, C["m1"])
            if x % 4 == 3:
                et.px(x, 6, C["d4"])
        elif kind == "prize":
            if x % 8 == 3 or x % 8 == 4:
                et.px(x, 4, C["m4"]); et.px(x, 5, C["m4"])
            dth(et, et.rect_mask(x, 2, 1, 1), 0.5, C["m1"]); dth(et, et.rect_mask(x, 7, 1, 1), 0.5, C["m1"])
        else:
            if x % 4 == 1:
                et.px(x, 3, C["d1"])
            et.px(x, 8, C["b1"]) if x % 4 < 3 else None
    if kind == "board":
        cn.circle(5, 5, 2, C["b2"]); cn.px(4, 4, C["b4"]); cn.px(5, 6, C["d0"]); cn.px(6, 5, C["d0"])
        cn.line(10, 8, 11, 12, C["d0"]); cn.line(11, 12, 9, 15, C["d0"])
        cable(cn, bez((15, 9), (11, 12), (8, 13), 12), 1, C["d0"], C["d4"])
    elif kind == "quest":
        cn.circle(8, 8, 3, C["m3"]); cn.circle(10, 7, 3, C["d3"]); cn.px(5, 8, C["m4"]); cn.px(12, 11, C["m2"]); cn.px(12, 12, C["m2"]); cn.px(13, 12, C["m2"])
    elif kind == "prize":
        cn.rect(3, 3, 4, 4, C["m4"]); cn.rect(3, 3, 4, 4, C["m1"], fill=False); cn.px(4, 4, C["m4"])
        for k in range(10):
            cn.px(4 + k, 4, C["m3"]) if k > 2 else None
    else:
        cn.circle(0, 0, 5, C["d3"]); cn.circle(0, 0, 3, C["d1"])
        cn.px(7, 8, C["b1"]) if False else None
    a = np.zeros((48, 48, 4), dtype=np.uint8)
    cc = cn.a; ee = et.a
    a[0:16, 0:16] = cc; a[0:16, 32:48] = _flip(cc, h=True); a[32:48, 0:16] = _flip(cc, v=True); a[32:48, 32:48] = _flip(cc, True, True)
    a[0:16, 16:32] = ee; a[32:48, 16:32] = _flip(ee, v=True)
    t = ee.transpose(1, 0, 2)
    a[16:32, 0:16] = t; a[16:32, 32:48] = _flip(t, h=True)
    a[16:32, 16:32] = rgba(C[fill])
    return Canvas.from_array(a)


def build_tile():
    c = Canvas(64, 64); xs, ys = c.grid()
    c.rect(0, 0, 64, 64, C["d2"])
    dth(c, c.rect_mask(0, 0, 64, 64), 0.12, C["d3"])
    for x in range(0, 64, 16):
        c.vline(x, 0, 63, C["d1"]); c.vline(x + 1, 0, 63, C["d3"])
    c.hline(0, 63, 0, C["d1"]); c.hline(0, 63, 31, C["d1"]); c.hline(0, 63, 32, C["d3"])
    for k, (y0, amp, per, col) in enumerate(((16, 4, 1, "d4"), (47, 3, 2, "d4"))):
        for x in range(64):
            y = int(round(y0 + amp * math.sin(2 * math.pi * per * x / 64.0 + k)))
            c.px(x, y, C[col]); c.px(x, y + 1, C["d1"])
    for (x, y) in ((8, 8), (24, 40), (40, 8), (56, 40)):
        c.px(x, y, C["d4"]); c.px(x + 1, y, C["d1"])
    return c


# ------------------------------------------------------------------ animations
def build_anims():
    anims = []
    # neon flicker (haunted): one letter of FEST
    sg0, fb = sign_img("haunted", 0)
    frames = [sign_img("haunted", s)[0].crop(fb[0], fb[1], fb[2], fb[3]) for s in (0, 1, 2)]
    seq = [frames[0]] * 10 + [frames[1], frames[2]]
    strip = Canvas(fb[2] * 12, fb[3])
    for i, f in enumerate(seq):
        strip.blit(f, i * fb[2], 0)
    save(strip, "anim-neon.png")
    anims.append(dict(file="anim-neon.png", x=16 + fb[0], y=4 + fb[1], w=fb[2], h=fb[3], frames=12, fps=6, season="haunted", layer="fg", note="one letter of FEST: lit for 10 frames, then off, then dim (one short stutter every 2 s)"))
    # dead-cabinet eyes blink (haunted)
    tr = {}
    bgs = [build_bg("haunted", eye_state=s, track=tr) for s in (0, 1, 2)]
    bx, by, bw, bh = tr["bbox"]
    strip = Canvas(bw * 3, bh)
    for i, b in enumerate(bgs):
        strip.blit(b.crop(bx, by, bw, bh), i * bw, 0)
    save(strip, "anim-eyes.png")
    anims.append(dict(file="anim-eyes.png", x=bx, y=by, w=bw, h=bh, frames=3, fps=3, season="haunted", layer="bg", note="eyes on a dead cabinet blink"))
    # ghost peek (haunted, in the fg layer)
    gx, gy, gw, gh = 396, 62, 18, 22
    strip = Canvas(gw * 3, gh)
    for i in range(3):
        strip.blit(build_fg("haunted", ghost_frame=i).crop(gx, gy, gw, gh), i * gw, 0)
    save(strip, "anim-ghost.png")
    anims.append(dict(file="anim-ghost.png", x=gx, y=gy, w=gw, h=gh, frames=3, fps=3, season="haunted", layer="fg", note="the ghost bobs and waves from behind the right cabinet"))
    # shrine edge shimmer (both): glints sliding down the side bezels
    sw, sh_ = 124, 82
    strip = Canvas(sw * 3, sh_)
    for i in range(3):
        for (x, y0) in ((157 - 155, 24 + 14 * i), (277 - 155, 62 - 14 * i)):
            strip.rect(i * sw + x, y0, 1, 5, C["d9"]); strip.px(i * sw + x, y0 + 2, C["b4"])
    save(strip, "anim-shimmer.png")
    anims.append(dict(file="anim-shimmer.png", x=155, y=8, w=sw, h=sh_, frames=3, fps=4, season="both", layer="bg", note="glints slide along the shrine's side bezels, outside the calm screen"))
    # dust in the moon shaft (both)
    dx0, dy0, dw, dh = 98, 0, 92, 180
    strip = Canvas(dw * 3, dh)
    rng = random.Random(5)
    bm = Canvas(434, 230).poly_mask([(98, 0), (132, 0), (184, 178), (136, 178)])
    pts = []
    while len(pts) < 30:
        x, y = rng.randint(100, 182), rng.randint(4, 174)
        if bm[y, x]:
            pts.append((x, y, rng.choice((0, 1))))
    for i in range(3):
        for (x, y, k) in pts:
            xx, yy = x - dx0 + (i * (1 if k else -1)), y - dy0 + i * 2
            if 0 <= xx < dw and 0 <= yy < dh:
                strip.px(i * dw + xx, yy, C["m4"] if k else C["m3"])
    save(strip, "anim-dust.png")
    anims.append(dict(file="anim-dust.png", x=dx0, y=dy0, w=dw, h=dh, frames=3, fps=3, season="both", layer="bg", note="dust motes drift in the moon shaft"))
    return anims


# ------------------------------------------------------------------ contrast
def lum(rgb):
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb[:3]
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def min_contrast(cv, rect):
    x, y, w, h = rect
    reg = cv.a[y:y + h, x:x + w, :3].reshape(-1, 3)
    lb = lum(rgba(C["b4"]))
    worst = min((lb + 0.05) / (lum(p) + 0.05) for p in {tuple(int(v) for v in p) for p in reg})
    return worst


ZONES = dict(
    sign=dict(x=16, y=4, w=118, h=30),
    ticker=dict(x=24, y=36, w=102, h=9),
    board=dict(x=155, y=8, w=124, h=82, calm=dict(x=167, y=20, w=100, h=58)),
    quest=dict(x=118, y=84, w=46, h=88, calm=dict(x=122, y=154, w=38, h=12)),
    prize=dict(x=272, y=62, w=46, h=84, calm=dict(x=277, y=134, w=36, h=10), neon=dict(x=270, y=50, w=50, h=12)),
    panel=dict(x=120, y=182, w=194, h=42),
)


def cyan_rects(img, rects, scale):
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    for (x, y, w, h) in rects:
        d.rectangle([x * scale, y * scale, (x + w) * scale - 1, (y + h) * scale - 1], outline=(0, 255, 255))
    return img


def to3(cv, k=3):
    return cv.scaled(k).image().convert("RGB")


def count_colours(cv):
    a = cv.a[cv.a[:, :, 3] > 0]
    return len({tuple(int(v) for v in p[:3]) for p in a})


# ------------------------------------------------------------------ main
def main():
    res = {}
    for season in ("haunted", "calm"):
        bg = build_bg(season); save(bg, f"desk-bg-{season}.png")
        fg = build_fg(season); save(fg, f"desk-fg-{season}.png")
    save(build_fog(), "fog.png")
    build_cabs()
    for season in ("haunted", "calm"):
        flat = Canvas.load(os.path.join(OUT, f"desk-bg-{season}.png"))
        flat.blit(Canvas.load(os.path.join(OUT, f"desk-fg-{season}.png")), 0, 0)
        save(flat, f"desk-{season}.png")
        p = build_phone(season); save(p, f"phone-{season}.png")
    anims = build_anims()
    # elements and frames
    els = {}
    for season, suf in (("haunted", ""), ("calm", "-calm")):
        save(shrine(season), f"el-board{suf}.png"); save(booth(season), f"el-quest{suf}.png"); save(prize_el(season), f"el-prize{suf}.png")
    for k in ("board", "quest", "prize", "paper"):
        save(frame_img(k), f"frame-{k}.png")
    save(build_tile(), "tile-wall.png")
    # composites
    D = [("lastbell", True), ("mystery", False), ("mystery", False)]
    for season in ("haunted", "calm"):
        cp = composite(season, D)
        to3(cp).save(os.path.join(OUT, f"composite-desk-{season}.png"))
        res[season] = cp
    to3(composite("haunted", [("lastbell", False), ("shadowcore", True), ("std", False)])).save(os.path.join(OUT, "composite-desk-all.png"))
    to3(composite("haunted", [("lastbell", True), ("mystery", False), ("mystery", False)], layers=False)).save(os.path.join(OUT, "composite-desk-nolayers.png"))
    zi = to3(res["haunted"])
    rects = [(ZONES["board"]["calm"][k] for k in "xywh"), (ZONES["quest"]["calm"][k] for k in "xywh"), (ZONES["prize"]["calm"][k] for k in "xywh"),
             (ZONES["ticker"][k] for k in "xywh"), (ZONES["panel"][k] for k in "xywh")]
    rects = [tuple(r) for r in rects] + [(sx + BTN[0], sy + BTN[1], BTN[2], BTN[3]) for (sx, sy) in SLOTS]
    cyan_rects(zi, rects, 3).save(os.path.join(OUT, "composite-desk-zones.png"))
    # phone composite 2x with lastbell ON
    ph = Canvas.load(os.path.join(OUT, "phone-haunted.png"))
    ph.blit(Canvas.load(os.path.join(OUT, "pool-on.png")), 65 - 8, 150 + 88)
    ph.blit(Canvas.load(os.path.join(OUT, "cab-lastbell-on.png")), 65, 150)
    to3(ph, 2).save(os.path.join(OUT, "composite-phone-haunted.png"))
    ph = Canvas.load(os.path.join(OUT, "phone-calm.png"))
    ph.blit(Canvas.load(os.path.join(OUT, "cab-mystery-off-calm.png")), 65, 150)
    to3(ph, 2).save(os.path.join(OUT, "composite-phone-calm.png"))
    # contrast checks on calm zones (on the default composites, no fog drift)
    chk = {}
    for season in ("haunted", "calm"):
        cp = composite(season, D, layers="fg")
        for name, r in (("board", ZONES["board"]["calm"]), ("quest", ZONES["quest"]["calm"]), ("prize", ZONES["prize"]["calm"]), ("ticker", ZONES["ticker"])):
            chk[f"{season}/{name}"] = round(min_contrast(cp, (r["x"], r["y"], r["w"], r["h"])), 1)
        for i, (sx, sy) in enumerate(SLOTS):
            chk[f"{season}/button{i + 1}"] = round(min_contrast(cp, (sx + BTN[0], sy + BTN[1], BTN[2], BTN[3])), 1)
    ph = Canvas.load(os.path.join(OUT, "phone-haunted.png"))
    chk["phone/board"] = round(min_contrast(ph, (53, 20, 90, 50)), 1)
    print("contrast vs bone", chk)
    cols = {}
    for season in ("haunted", "calm"):
        cols[season] = count_colours(composite(season, D))
        cols[season + "-bg-only"] = count_colours(Canvas.load(os.path.join(OUT, f"desk-bg-{season}.png")))
    cols["all-3-named"] = count_colours(composite("haunted", [("lastbell", False), ("shadowcore", True), ("std", False)]))
    print("colours", cols)
    write_manifest(anims, chk, cols)


def write_manifest(anims, chk, cols):
    sl = [dict(x=a, y=b) for (a, b) in SLOTS]
    eggs = [
        dict(name="ghost", x=396, y=62, w=18, h=22, note="peeks out from behind the right foreground cabinet (haunted only)"),
        dict(name="moon-cab", x=165, y=89, w=8, h=35, note="the nearest dead cabinet on the left row (partly behind the booth); the page may flash a yellow moon on its dark screen"),
        dict(name="room-000", x=326, y=100, w=26, h=12, note="ROOM 000 plaque on the right wall, beside the prize doorway"),
        dict(name="pumpkin", x=256, y=80, w=10, h=9, note="pumpkin on a dead cabinet (haunted only)"),
    ]
    man = dict(
        concept="c", title="The Possessed Arcade",
        desk=dict(
            w=434, h=230, scale=3, bgDepth=-0.5,
            files=dict(haunted="desk-bg-haunted.png", calm="desk-bg-calm.png"),
            flat=dict(haunted="desk-haunted.png", calm="desk-calm.png"),
            layers=[dict(name="fg", haunted="desk-fg-haunted.png", calm="desk-fg-calm.png", depth=1), dict(name="fog", file="fog.png", y=150, depth=0.5)],
            cab=dict(w=64, h=104, screen=dict(x=SCR[0], y=SCR[1], w=SCR[2], h=SCR[3]), button=dict(x=BTN[0], y=BTN[1], w=BTN[2], h=BTN[3])),
            slots=sl, pool=dict(dx=-8, dy=88, w=80, h=28, file="pool-on.png"),
            zones=ZONES, anims=anims, eggs=eggs,
            variants=dict(mystery_calm=dict(off="cab-mystery-off-calm.png", on="cab-mystery-on-calm.png", scr="scr-mystery-calm.png")),
        ),
        phone=dict(
            w=195, h=300, scale=2, files=dict(haunted="phone-haunted.png", calm="phone-calm.png"), slot=dict(x=65, y=150),
            zones=dict(board=dict(x=43, y=10, w=110, h=72, calm=dict(x=53, y=20, w=90, h=50)), navL=dict(x=0, y=180, w=40, h=50), navR=dict(x=155, y=180, w=40, h=50), footer=dict(x=0, y=258, w=195, h=42)),
            anims=[],
        ),
        elements=dict(
            board=dict(file="el-board.png", calmFile="el-board-calm.png", w=124, h=82, calm=dict(x=12, y=12, w=100, h=58)),
            quest=dict(file="el-quest.png", calmFile="el-quest-calm.png", w=46, h=88, calm=dict(x=4, y=70, w=38, h=12)),
            prize=dict(file="el-prize.png", calmFile="el-prize-calm.png", w=50, h=96, calm=dict(x=7, y=84, w=36, h=10)),
        ),
        frames=dict(board=dict(file="frame-board.png", slice=16, fill=C["d1"]), quest=dict(file="frame-quest.png", slice=16, fill=C["d3"]),
                    prize=dict(file="frame-prize.png", slice=16, fill=C["d1"]), paper=dict(file="frame-paper.png", slice=16, fill=C["b3"], textInk=C["d1"])),
        tile="tile-wall.png",
        palette=dict(colours=cols.get("haunted"), calmColours=cols.get("calm"), notes="fixed palette of %d colours; haunted-only extras: orange (4), pink neon (4)" % len(PAL), contrast=chk),
    )
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(man, f, indent=2)


if __name__ == "__main__":
    main()
