/**
 * The print on a pack: every collection is the same crimped foil booster
 * (docs/collectibles-opening.md §4.1), printed with its own colours, pixel
 * emblem, motif and name. Drawn once with Canvas 2D into two images of the same
 * size, which both the WebGL pack and the DOM fallback use:
 *
 *   colour    RGBA: the print, with the silhouette in alpha (pinked crimp edges
 *             top and bottom, a tear notch on each side at the seam)
 *   material  R = metalness (foil 0.8-1, white-ink label 0), G = roughness,
 *             B = clear-coat gloss
 *
 * Layout, as fractions of the pack's height (v, top → bottom):
 *   0 → CRIMP_TOP    the top crimp seal (ridged, pinked edge)
 *   ≈ 0.12           the tear line (see `tear.ts`, TEAR.seamV); a notch marks it
 *   1-CRIMP_BOTTOM → 1  the bottom crimp seal
 * The pixel emblem is drawn at a whole-number scale, never smoothed.
 */

import { getCollection, getPack, packEmblemSrc, collectionSymbolSrc } from "@/app/lib/collectibles/catalogue";
import { TEAR } from "../tear";

/** Height ÷ width of every pack. */
export const PACK_ASPECT = 1.46;
export const CRIMP_TOP = 0.072;
export const CRIMP_BOTTOM = 0.058;

export interface PackArt {
  colour: HTMLCanvasElement;
  material: HTMLCanvasElement;
  width: number;
  height: number;
}

interface Print {
  base: string;
  base2: string;
  crimp: string;
  ink: string;
  accent: string;
  label: string;
  labelInk: string;
  motif: (g: Painter) => void;
}

/** Draws into colour and material at once, in pack units (x 0..1 across, y 0..PACK_ASPECT down). */
class Painter {
  constructor(
    readonly c: CanvasRenderingContext2D,
    readonly m: CanvasRenderingContext2D,
    readonly px: number,
  ) {}
  /** Pack units → canvas px. */
  s(x: number) {
    return x * this.px;
  }
  /** A material: metal, roughness, coat (0..1). */
  mat(metal: number, rough: number, coat = 0.6) {
    return `rgb(${Math.round(metal * 255)},${Math.round(rough * 255)},${Math.round(coat * 255)})`;
  }
  fill(path: (ctx: CanvasRenderingContext2D) => void, colour: string | CanvasGradient | CanvasPattern, material: string | null) {
    for (const [ctx, style] of [[this.c, colour], [this.m, material]] as const) {
      if (style === null) continue;
      ctx.beginPath();
      path(ctx);
      ctx.fillStyle = style;
      ctx.fill();
    }
  }
  rect(x: number, y: number, w: number, h: number, colour: string | CanvasGradient, material: string | null) {
    this.fill((ctx) => ctx.rect(this.s(x), this.s(y), this.s(w), this.s(h)), colour, material);
  }
  circle(x: number, y: number, r: number, colour: string | CanvasGradient, material: string | null) {
    this.fill((ctx) => ctx.arc(this.s(x), this.s(y), this.s(r), 0, Math.PI * 2), colour, material);
  }
  round(x: number, y: number, w: number, h: number, r: number, colour: string, material: string | null) {
    this.fill((ctx) => ctx.roundRect(this.s(x), this.s(y), this.s(w), this.s(h), this.s(r)), colour, material);
  }
  linear(x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
    const g = this.c.createLinearGradient(this.s(x0), this.s(y0), this.s(x1), this.s(y1));
    for (const [o, col] of stops) g.addColorStop(o, col);
    return g;
  }
  radial(x: number, y: number, r: number, stops: [number, string][]) {
    const g = this.c.createRadialGradient(this.s(x), this.s(y), 0, this.s(x), this.s(y), this.s(r));
    for (const [o, col] of stops) g.addColorStop(o, col);
    return g;
  }
}

const H = PACK_ASPECT;
const FIELD_TOP = CRIMP_TOP * H;
const FIELD_BOTTOM = (1 - CRIMP_BOTTOM) * H;

const PRINTS: Record<string, Print> = {
  // Fright Fest: the prize bag at night, a big yellow moon behind the emblem.
  "prize-bag": {
    base: "#1d0f30",
    base2: "#0f0719",
    crimp: "#2a1745",
    ink: "#fff8e7",
    accent: "#ffd84a",
    label: "#fff8e7",
    labelInk: "#23153a",
    motif: (g) => {
      g.circle(0.5, 0.58, 0.33, g.radial(0.5, 0.58, 0.33, [[0, "rgba(255,216,74,0.30)"], [1, "rgba(255,216,74,0)"]]), null);
      g.circle(0.5, 0.58, 0.255, "#ffd84a", g.mat(1, 0.16, 0.7));
      g.circle(0.43, 0.5, 0.05, "#f1c23a", null);
      g.circle(0.6, 0.69, 0.035, "#f1c23a", null);
      for (const [x, y, r] of [[0.14, 0.3, 0.008], [0.86, 0.36, 0.006], [0.2, 0.86, 0.006], [0.82, 0.92, 0.009], [0.1, 1.05, 0.005], [0.92, 0.7, 0.005]]) {
        g.circle(x, y, r, "#fff8e7", g.mat(1, 0.1, 0.8));
      }
      g.rect(0, 1.17, 1, 0.012, "#ff7a1a", g.mat(1, 0.2));
    },
  },
  // HallPass Originals: navy hall-pass card stock with the yellow stripe and a printed punch hole.
  "hall-pass-tag": {
    base: "#1f3156",
    base2: "#14213d",
    crimp: "#273d68",
    ink: "#fff8e7",
    accent: "#ffd84a",
    label: "#fff8e7",
    labelInk: "#1b2a4a",
    motif: (g) => {
      g.rect(0, 0.98, 1, 0.07, "#ffd84a", g.mat(1, 0.18, 0.7));
      g.rect(0, 1.055, 1, 0.012, "#7c2eef", g.mat(0.9, 0.25));
      g.circle(0.5, 0.29, 0.03, "#0d1528", g.mat(0.2, 0.6));
      g.fill((ctx) => {
        ctx.arc(g.s(0.5), g.s(0.29), g.s(0.045), 0, Math.PI * 2);
        ctx.arc(g.s(0.5), g.s(0.29), g.s(0.033), 0, Math.PI * 2, true);
      }, "#c9d3e6", g.mat(1, 0.12, 0.8));
      for (let i = 0; i < 9; i++) g.rect(0.08 + i * 0.1, 0.34, 0.05, 0.006, "rgba(255,248,231,0.25)", null);
    },
  },
  // Internet Culture: a browser window, title bar and all.
  "browser-sleeve": {
    base: "#21417c",
    base2: "#162c57",
    crimp: "#2b4f8f",
    ink: "#ffffff",
    accent: "#7fd1ff",
    label: "#ffffff",
    labelInk: "#1f3b73",
    motif: (g) => {
      for (let y = FIELD_TOP; y < FIELD_BOTTOM; y += 0.05) g.rect(0, y, 1, 0.003, "rgba(255,255,255,0.07)", null);
      g.round(0.07, 0.31, 0.86, 0.075, 0.02, "#7fd1ff", g.mat(1, 0.18, 0.7));
      for (const [i, col] of ["#ff6b6b", "#ffd84a", "#6be37a"].entries()) g.circle(0.12 + i * 0.045, 0.3475, 0.013, col, g.mat(0.6, 0.3));
      g.round(0.27, 0.332, 0.62, 0.031, 0.015, "#ffffff", g.mat(0, 0.7, 0.3));
      g.round(0.07, 0.385, 0.86, 0.52, 0.0, "rgba(127,209,255,0.10)", null);
    },
  },
  // Brainrot: a loud snack sachet, pink with a green band and a starburst.
  "snack-sachet": {
    base: "#ff4fd8",
    base2: "#d9259f",
    crimp: "#e13cc0",
    ink: "#23153a",
    accent: "#7fd16a",
    label: "#fff8e7",
    labelInk: "#23153a",
    motif: (g) => {
      g.rect(0, 1.0, 1, 0.09, "#7fd16a", g.mat(0.95, 0.2, 0.7));
      const burst = (cx: number, cy: number, r: number) =>
        g.fill((ctx) => {
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const rr = i % 2 ? r * 0.72 : r;
            ctx.lineTo(g.s(cx + Math.cos(a) * rr), g.s(cy + Math.sin(a) * rr));
          }
          ctx.closePath();
        }, "#ffd84a", g.mat(1, 0.15, 0.8));
      burst(0.8, 0.3, 0.1);
    },
  },
  // Turkish Internet Culture: a tea-box carton print, red with tiled checker bands.
  "tea-box": {
    base: "#cc2240",
    base2: "#a3162f",
    crimp: "#b51b37",
    ink: "#f2e8d5",
    accent: "#f2e8d5",
    label: "#f2e8d5",
    labelInk: "#7a0f22",
    motif: (g) => {
      const t = 1 / 28;
      for (const y0 of [0.286, 1.03]) {
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 28; col++) g.rect(col * t, y0 + row * t, t, t, (row + col) % 2 ? "#1f3b73" : "#f2e8d5", g.mat(0.85, 0.25));
        }
      }
    },
  },
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });

/** The site's Nunito, as the family name next/font registered (canvas text can't read CSS variables). */
function siteFont(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const v = getComputedStyle(document.body).getPropertyValue("--font-nunito").trim();
  return v ? `${v}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/** Word-wrap `text` into at most `lines` lines no wider than `max` px. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  return [...out.slice(0, lines - 1), out.slice(lines - 1).join(" ")];
}

/** The silhouette: pinked crimp edges, straight sides, a tear notch on each side at the rest seam line. */
function silhouette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tooth = w / 34;
  const depth = h * 0.012;
  const notchY = TEAR.seamV * h;
  const notch = w * 0.03;
  ctx.beginPath();
  ctx.moveTo(0, depth);
  for (let x = 0; x < w; x += tooth) {
    ctx.lineTo(x + tooth / 2, 0);
    ctx.lineTo(Math.min(w, x + tooth), depth);
  }
  ctx.lineTo(w, notchY - notch * 0.7);
  ctx.lineTo(w - notch, notchY);
  ctx.lineTo(w, notchY + notch * 0.7);
  ctx.lineTo(w, h - depth);
  for (let x = w; x > 0; x -= tooth) {
    ctx.lineTo(x - tooth / 2, h);
    ctx.lineTo(Math.max(0, x - tooth), h - depth);
  }
  ctx.lineTo(0, notchY + notch * 0.7);
  ctx.lineTo(notch, notchY);
  ctx.lineTo(0, notchY - notch * 0.7);
  ctx.closePath();
}

const cache = new Map<string, Promise<PackArt>>();

/** The print for a pack at `widthPx` device pixels across. Cached per pack and size. */
export function packArt(packId: string, widthPx: number): Promise<PackArt> {
  const width = Math.max(64, Math.round(widthPx));
  const key = `${packId}@${width}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = drawPackArt(packId, width);
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

async function drawPackArt(packId: string, width: number): Promise<PackArt> {
  const pack = getPack(packId);
  if (!pack) throw new Error(`Unknown pack ${packId}`);
  const collection = getCollection(pack.collection);
  const print = PRINTS[pack.wrapper] ?? PRINTS["prize-bag"];
  const font = siteFont();
  const [emblem, symbol] = await Promise.all([
    loadImage(packEmblemSrc(pack.collection)),
    loadImage(collectionSymbolSrc(pack.collection)).catch(() => null),
    document.fonts?.load(`900 20px ${font}`).catch(() => undefined),
  ]);

  const height = Math.round(width * H);
  const make = () => {
    const el = document.createElement("canvas");
    el.width = width;
    el.height = height;
    return el;
  };
  const colour = make();
  const material = make();
  const c = colour.getContext("2d")!;
  const m = material.getContext("2d")!;
  const g = new Painter(c, m, width);

  // Ground: the printed foil, a touch darker toward the bottom.
  g.rect(0, 0, 1, H, g.linear(0, 0, 0, H, [[0, print.base], [1, print.base2]]), g.mat(0.86, 0.3));
  print.motif(g);

  // The emblem, centred on the motif, at a whole-number scale.
  c.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.floor((width * 0.44) / emblem.naturalWidth));
  const ew = emblem.naturalWidth * scale;
  const ex = Math.round((width - ew) / 2);
  const ey = Math.round(g.s(0.58) - ew / 2);
  c.drawImage(emblem, ex, ey, ew, ew);
  // Printed on a white underlay: matte-ish exactly where the pixels are.
  const mask = document.createElement("canvas");
  mask.width = ew;
  mask.height = ew;
  const mk = mask.getContext("2d")!;
  mk.imageSmoothingEnabled = false;
  mk.drawImage(emblem, 0, 0, ew, ew);
  mk.globalCompositeOperation = "source-in";
  mk.fillStyle = g.mat(0.3, 0.55, 0.5);
  mk.fillRect(0, 0, ew, ew);
  m.drawImage(mask, ex, ey);

  // Header: the wordmark and the collection symbol, small, like the maker's mark on a real pack.
  const headY = g.s(0.205);
  c.fillStyle = print.ink;
  c.font = `900 ${Math.round(g.s(0.062))}px ${font}`;
  c.textBaseline = "middle";
  c.fillText("hallpass", g.s(0.08), headY);
  m.fillStyle = g.mat(0.1, 0.55);
  m.font = c.font;
  m.textBaseline = "middle";
  m.fillText("hallpass", g.s(0.08), headY);
  c.font = `800 ${Math.round(g.s(0.03))}px ${font}`;
  c.globalAlpha = 0.75;
  c.fillText("COLLECTIBLES", g.s(0.08), headY + g.s(0.05));
  c.globalAlpha = 1;
  if (symbol) {
    const ss = Math.max(1, Math.floor(g.s(0.085) / symbol.naturalWidth));
    const sw = symbol.naturalWidth * ss;
    c.drawImage(symbol, Math.round(width - g.s(0.08) - sw), Math.round(headY - sw / 2), sw, sw);
  }

  // The name on a white-ink label: matte, so it reads against the foil.
  c.font = `900 ${Math.round(g.s(0.068))}px ${font}`;
  const lines = wrap(c, pack.name, g.s(0.74), 2);
  const lineH = g.s(0.078);
  const labelH = lineH * lines.length + g.s(0.05);
  const labelY = g.s(1.205) - labelH / 2;
  g.fill((ctx) => ctx.roundRect(g.s(0.09), labelY, g.s(0.82), labelH, labelH / 2.4), print.label, g.mat(0, 0.75, 0.15));
  c.fillStyle = print.labelInk;
  c.textAlign = "center";
  lines.forEach((l, i) => c.fillText(l, width / 2, labelY + g.s(0.025) + lineH * (i + 0.5)));
  c.textAlign = "left";

  // Footer print: what's inside.
  c.font = `800 ${Math.round(g.s(0.03))}px ${font}`;
  c.fillStyle = print.ink;
  c.globalAlpha = 0.7;
  c.textAlign = "center";
  c.fillText(`${(collection?.name ?? "").toUpperCase()}  ·  3 CARDS`, width / 2, g.s(1.335));
  c.textAlign = "left";
  c.globalAlpha = 1;

  // Crimp seals, top and bottom: a band of the print, darker, with a sealed edge line.
  for (const [y0, y1] of [[0, FIELD_TOP], [FIELD_BOTTOM, H]] as const) {
    g.rect(0, y0, 1, y1 - y0, print.crimp, g.mat(0.95, 0.42, 0.45));
    g.rect(0, y0 === 0 ? y1 - 0.004 : y0, 1, 0.004, "rgba(0,0,0,0.35)", null);
  }

  // Cut the silhouette out of both.
  for (const ctx of [c, m]) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    silhouette(ctx, width, height);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }
  return { colour, material, width, height };
}
