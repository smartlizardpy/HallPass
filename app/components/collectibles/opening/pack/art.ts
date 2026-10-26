/**
 * The print on a pack: every pack is the same crimped foil booster
 * (docs/collectibles-opening.md §4.1) wearing its own pixel-art print
 * (public/collectibles/packs/print/, docs/collectibles-pack-room.md). The print
 * and its foil mask are drawn once with Canvas 2D into two images of the same
 * size, which both the WebGL pack and the DOM fallback use:
 *
 *   colour    RGBA: the print at a whole-number scale, smoothing off, with its
 *             silhouette (pinked crimp edges, a tear notch on each side) in alpha
 *   material  R = metalness, G = roughness, B = clear-coat gloss: foil where the
 *             mask says so, glossy printed film everywhere else, heat-sealed
 *             metal on the crimps
 *
 * The art is 96×140. Its anatomy matches the mesh: the top crimp is rows 0-9
 * (CRIMP_TOP), the bottom crimp the last 8 rows (CRIMP_BOTTOM), and the tear
 * notch is centred on row 16, the middle of which is `TEAR.seamV` (0.118).
 *
 * The textures are sampled with LINEAR filtering (`gl/glPack.ts`), so the print
 * is drawn at about the size it is shown at: pixels stay crisp because each one
 * is already several texels wide.
 */

import { getPack, PACK_PRINT_PX, packFoilSrc, packPrintSrc } from "@/app/lib/collectibles/catalogue";

/** Height ÷ width of every pack (the print is 140/96, within a pixel of this). */
export const PACK_ASPECT = 1.46;
export const CRIMP_TOP = 0.072;
export const CRIMP_BOTTOM = 0.058;

export interface PackArt {
  colour: HTMLCanvasElement;
  material: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Metal, roughness and coat (0..1) for each kind of surface on the wrapper. */
const FOIL = [0.95, 0.22, 0.6] as const;
const FILM = [0.55, 0.42, 0.45] as const;
const SEAL = [0.75, 0.42, 0.4] as const;
const CRIMP_TOP_ROWS = 10;
const CRIMP_BOTTOM_ROWS = 8;
/** The largest whole-number scale drawn (96 × 9 = 864 px, about the old 900 px cap). */
const MAX_SCALE = 9;

const cache = new Map<string, Promise<PackArt>>();

/**
 * The print for a pack at least `widthPx` device pixels across (rounded up to a
 * whole-number scale of the art, from 2× to 9×). Cached per pack and scale.
 */
export function packArt(packId: string, widthPx: number): Promise<PackArt> {
  const scale = Math.min(MAX_SCALE, Math.max(2, Math.ceil(widthPx / PACK_PRINT_PX.w)));
  const key = `${packId}@${scale}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = drawPackArt(packId, scale);
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });

function canvas(w: number, h: number): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  return el;
}

/** The image's pixels at its native size. */
function pixels(img: HTMLImageElement): Uint8ClampedArray {
  const c = canvas(PACK_PRINT_PX.w, PACK_PRINT_PX.h).getContext("2d", { willReadFrequently: true })!;
  c.drawImage(img, 0, 0, PACK_PRINT_PX.w, PACK_PRINT_PX.h);
  return c.getImageData(0, 0, PACK_PRINT_PX.w, PACK_PRINT_PX.h).data;
}

async function drawPackArt(packId: string, scale: number): Promise<PackArt> {
  if (!getPack(packId)) throw new Error(`Unknown pack ${packId}`);
  const [print, foil] = await Promise.all([loadImage(packPrintSrc(packId)), loadImage(packFoilSrc(packId)).catch(() => null)]);
  const { w, h } = PACK_PRINT_PX;
  const width = w * scale;
  const height = h * scale;

  const colour = canvas(width, height);
  const c = colour.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  c.drawImage(print, 0, 0, width, height);

  // The material, one value per art pixel, then scaled up the same way.
  const mask = foil ? pixels(foil) : null;
  const native = canvas(w, h);
  const n = native.getContext("2d")!;
  const data = n.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const crimp = y < CRIMP_TOP_ROWS || y >= h - CRIMP_BOTTOM_ROWS;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isFoil = !!mask && mask[i + 3] > 127 && mask[i] > 127;
      const [metal, rough, coat] = crimp ? SEAL : isFoil ? FOIL : FILM;
      data.data[i] = Math.round(metal * 255);
      data.data[i + 1] = Math.round(rough * 255);
      data.data[i + 2] = Math.round(coat * 255);
      data.data[i + 3] = 255;
    }
  }
  n.putImageData(data, 0, 0);
  const material = canvas(width, height);
  const m = material.getContext("2d")!;
  m.imageSmoothingEnabled = false;
  m.drawImage(native, 0, 0, width, height);

  return { colour, material, width, height };
}
