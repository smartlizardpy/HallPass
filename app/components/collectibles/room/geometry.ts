/**
 * The Pack Room's scene, as numbers (docs/collectibles-pack-room.md).
 *
 * The room is one painted picture in two compositions: `desk` (434×230 native
 * pixels, shown at 3× on a 1366 px laptop) and `phone` (195×358, shown at 2×).
 * Everything the page puts on top of it (the packs, the boards, the panels) is
 * positioned here in the picture's own pixels and turned into percentages of
 * the room, so the whole scene scales as one and the server can draw it before
 * any script runs. Move something in the art (`room_a.py`) and move it here.
 *
 * Pure, so the arithmetic is tested.
 */

import type { PlayerPack } from "@/app/lib/collectibles/store";

export type Composition = "desk" | "phone";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a pack stands: its footprint in the art, and how big it is drawn there. */
export interface Spot extends Box {
  /** Pack-art pixels per room pixel: 2/3 on the laptop counter (2× in a 3× room), 1 or 1/2 on phones. */
  k: number;
}

export interface Loop extends Box {
  file: string;
  frames: number;
  fps: number;
  season: "both" | "normal" | "haunted";
}

export interface Scene {
  w: number;
  h: number;
  featured: Spot;
  /** The counter, nearest the riser first, so a few packs stand together. */
  slots: Spot[];
  recent: Box;
  collection: Box;
  loops: Loop[];
}

/** The pack print's native size (`PACK_PRINT_PX`). */
const PACK_W = 96;
const PACK_H = 140;

/** Below this content width the phone composition is used (the laptop scene at 2×). Mirrored in room.css. */
export const PHONE_BELOW_PX = 868;
/** The laptop scene's widest: 3×. Mirrored in room.css. */
export const DESK_MAX_PX = 434 * 3;
/** The phone scene's widest: 2.5× (portrait tablets). Mirrored in room.css. */
export const PHONE_MAX_PX = 195 * 2.5;

const DESK_K = 2 / 3;

export const SCENES: Record<Composition, Scene> = {
  desk: {
    w: 434,
    h: 230,
    featured: { x: 185, y: 68, w: 64, h: 93, k: DESK_K },
    slots: [
      { x: 109, y: 74, w: 64, h: 93, k: DESK_K },
      { x: 261, y: 74, w: 64, h: 93, k: DESK_K },
      { x: 33, y: 74, w: 64, h: 93, k: DESK_K },
      { x: 337, y: 74, w: 64, h: 93, k: DESK_K },
    ],
    // The boards' glass, under their painted headings.
    recent: { x: 10, y: 197, w: 142, h: 22 },
    collection: { x: 282, y: 197, w: 142, h: 22 },
    loops: [
      { file: "anim-marquee-normal.png", x: 134, y: 8, w: 166, h: 38, frames: 3, fps: 4, season: "normal" },
      { file: "anim-marquee-halloween.png", x: 134, y: 8, w: 166, h: 38, frames: 3, fps: 4, season: "haunted" },
      { file: "anim-lamp-halloween.png", x: 209, y: 58, w: 17, h: 2, frames: 3, fps: 5, season: "haunted" },
      { file: "anim-ticket-normal.png", x: 15, y: 115, w: 3, h: 3, frames: 4, fps: 4, season: "normal" },
      { file: "anim-dust.png", x: 167, y: 62, w: 100, h: 100, frames: 3, fps: 4, season: "both" },
      { file: "anim-ghost.png", x: 300, y: 55, w: 8, h: 17, frames: 4, fps: 4, season: "haunted" },
    ],
  },
  phone: {
    w: 195,
    h: 358,
    featured: { x: 49, y: 105, w: 96, h: 140, k: 1 },
    slots: [
      { x: 73, y: 263, w: 48, h: 70, k: 1 / 2 },
      { x: 21, y: 263, w: 48, h: 70, k: 1 / 2 },
      { x: 125, y: 263, w: 48, h: 70, k: 1 / 2 },
    ],
    recent: { x: 113, y: 57, w: 76, h: 42 },
    collection: { x: 6, y: 67, w: 72, h: 29 },
    loops: [
      { file: "anim-marquee-phone-normal.png", x: 15, y: 7, w: 165, h: 38, frames: 3, fps: 4, season: "normal" },
      { file: "anim-marquee-phone-halloween.png", x: 15, y: 7, w: 165, h: 38, frames: 3, fps: 4, season: "haunted" },
      { file: "anim-lamp-halloween.png", x: 89, y: 60, w: 17, h: 2, frames: 3, fps: 5, season: "haunted" },
      { file: "anim-dust-phone.png", x: 74, y: 66, w: 46, h: 80, frames: 3, fps: 4, season: "both" },
      { file: "anim-ghost-phone.png", x: 177, y: 223, w: 12, h: 16, frames: 4, fps: 4, season: "haunted" },
    ],
  },
};

/** A length in room pixels as a percentage of the room's width or height (CSS). */
export const pct = (n: number, of: number) => `${Number(((n / of) * 100).toFixed(6))}%`;

/** A box as CSS `left/top/width/height` percentages of its scene. */
export function boxStyle(b: Box, scene: Scene): { left: string; top: string; width: string; height: string } {
  return { left: pct(b.x, scene.w), top: pct(b.y, scene.h), width: pct(b.w, scene.w), height: pct(b.h, scene.h) };
}

/** The pack drawn at a spot: centred on it, standing on its bottom edge, in room pixels. */
export function packBox(spot: Spot): Box {
  const w = PACK_W * spot.k;
  const h = PACK_H * spot.k;
  return { x: spot.x + spot.w / 2 - w / 2, y: spot.y + spot.h - h, w, h };
}

/** The sealed packs of one kind, standing together as one pack with a count. */
export interface PackGroup {
  packId: string;
  /** Oldest grant first: that is the one Open opens. */
  items: PlayerPack[];
}

/** One group per kind of pack, the most recently earned kind first. */
export function groupSealed(sealed: readonly PlayerPack[]): PackGroup[] {
  const byPack = new Map<string, PlayerPack[]>();
  for (const p of sealed) {
    const list = byPack.get(p.packId);
    if (list) list.push(p);
    else byPack.set(p.packId, [p]);
  }
  const groups = [...byPack.entries()].map(([packId, items]) => ({
    packId,
    items: [...items].sort((a, b) => a.grantedAt.localeCompare(b.grantedAt) || a.publicId.localeCompare(b.publicId)),
  }));
  const newest = (g: PackGroup) => g.items[g.items.length - 1].grantedAt;
  return groups.sort((a, b) => newest(b).localeCompare(newest(a)) || a.packId.localeCompare(b.packId));
}

export interface Arrangement {
  /** In the light, on the riser. */
  featured: PackGroup | null;
  /** On the counter, in slot order. */
  counter: PackGroup[];
  /** Kinds of pack that don't fit on the counter (they are in the All packs sheet). */
  more: number;
}

/** Which kind of pack stands where: the chosen one (or the newest) in the light, the rest along the counter. */
export function arrange(groups: readonly PackGroup[], featuredPackId: string | null, slots: number): Arrangement {
  if (groups.length === 0) return { featured: null, counter: [], more: 0 };
  const chosen = groups.find((g) => g.packId === featuredPackId) ?? groups[0];
  const rest = groups.filter((g) => g !== chosen);
  return { featured: chosen, counter: rest.slice(0, slots), more: Math.max(0, rest.length - slots) };
}
