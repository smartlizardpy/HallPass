/**
 * The Arcade Hall's scene, as numbers (docs/fright-fest-hall.md).
 *
 * The room is one painted picture in two compositions: `desk` (434×230 native
 * pixels, shown at up to 3×) and `phone` (195×236, shown at up to 2.5×). It is
 * built the way the Pack Room is (`components/collectibles/room/geometry.ts`):
 * everything the page puts on top of the picture (cabinets, plates, the board,
 * the details panel) is positioned here in the picture's own pixels and turned
 * into percentages of the room, so the whole scene scales as one and the
 * server can draw it before any script runs.
 *
 * These numbers are the art's manifest (`art/out/a/manifest.json` on branch
 * `design/fright-fest-event-hall`). Move something in the art
 * (`hall_a.py`) and move it here; the test reads the PNGs on disk.
 *
 * Pure, so the arithmetic is tested.
 */

export type Composition = "desk" | "phone";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Below this content width the phone composition is used. The Pack Room switches at the same width. Mirrored in hall.css. */
export const PHONE_BELOW_PX = 868;
/** The laptop scene's widest: 3×. Mirrored in hall.css. */
export const DESK_MAX_PX = 434 * 3;
/** The phone scene's widest: 2.5× (portrait tablets). Mirrored in hall.css. */
export const PHONE_MAX_PX = 195 * 2.5;

/** The public folder the art is served from. */
export const ART_DIR = "/events/fright-fest/hall";

/** A looping strip of equal frames, drawn as stepped background position (hall.css). */
export interface Loop extends Box {
  file: string;
  frames: number;
  fps: number;
  season: "both" | "calm" | "haunted";
}

export interface Egg extends Box {
  name: "ghost" | "pumpkin" | "room000";
  season: "both" | "haunted";
}

/** A cabinet sprite: its size, its screen and the flat strip where the Play button sits (both relative to the sprite). */
export const CABINET = {
  w: 58,
  h: 96,
  screen: { x: 8, y: 18, w: 42, h: 32 } as Box,
  button: { x: 5, y: 68, w: 48, h: 15 } as Box,
  /** The screen loop: frames of the screen's size side by side. */
  screenFrames: 3,
  screenFps: 3,
} as const;

/** The floor light under a lit cabinet, placed by offset from the cabinet's top-left. */
export const POOL = { dx: -11, dy: 96, w: 80, h: 10, file: "pool-on.png" } as const;

export interface Scene {
  w: number;
  h: number;
  /** Where the cabinets stand (top-left of the sprite). The phone shows one at a time. */
  slots: { x: number; y: number }[];
  /** The marquee sign and the ticker plate inside it. */
  sign: Box;
  ticker: Box;
  /** Where the details panel sits (laptop) or the arrows and dots (phone). */
  panel: Box;
  loops: Loop[];
  files: { haunted: string; calm: string };
}

export interface DeskScene extends Scene {
  /** Each zone and its calm (flat, dark) interior, where text may sit. */
  board: { zone: Box; calm: Box };
  quest: { zone: Box; calm: Box };
  prize: { zone: Box; calm: Box };
  eggs: Egg[];
}

export interface PhoneScene extends Scene {
  /** Glimpses of the board and the prize door at the room's edges: links. */
  boardGlimpse: Box;
  prizeGlimpse: Box;
}

export const DESK: DeskScene = {
  w: 434,
  h: 230,
  files: { haunted: "desk-haunted.png", calm: "desk-calm.png" },
  slots: [
    { x: 118, y: 60 },
    { x: 188, y: 60 },
    { x: 258, y: 60 },
  ],
  sign: { x: 142, y: 4, w: 150, h: 38 },
  ticker: { x: 156, y: 44, w: 122, h: 10 },
  panel: { x: 112, y: 166, w: 210, h: 58 },
  board: { zone: { x: 8, y: 10, w: 94, h: 96 }, calm: { x: 15, y: 30, w: 80, h: 68 } },
  quest: { zone: { x: 10, y: 110, w: 92, h: 42 }, calm: { x: 16, y: 134, w: 80, h: 14 } },
  prize: { zone: { x: 334, y: 24, w: 94, h: 132 }, calm: { x: 346, y: 160, w: 70, h: 14 } },
  loops: [
    { file: "anim-marquee-calm.png", x: 142, y: 4, w: 150, h: 38, frames: 3, fps: 4, season: "calm" },
    { file: "anim-marquee-haunted.png", x: 142, y: 4, w: 150, h: 38, frames: 3, fps: 4, season: "haunted" },
    { file: "anim-doorlight.png", x: 326, y: 52, w: 108, h: 154, frames: 2, fps: 3, season: "haunted" },
    // Opaque tiles that sit BEHIND the third cabinet's sprite.
    { file: "anim-ghost.png", x: 311, y: 86, w: 14, h: 18, frames: 4, fps: 4, season: "haunted" },
    { file: "anim-dust.png", x: 338, y: 60, w: 84, h: 96, frames: 3, fps: 4, season: "both" },
  ],
  eggs: [
    { name: "ghost", x: 313, y: 88, w: 12, h: 15, season: "haunted" },
    { name: "pumpkin", x: 322, y: 147, w: 10, h: 9, season: "haunted" },
    { name: "room000", x: 317, y: 127, w: 18, h: 10, season: "both" },
  ],
};

export const PHONE: PhoneScene = {
  w: 195,
  h: 236,
  files: { haunted: "phone-haunted.png", calm: "phone-calm.png" },
  slots: [{ x: 68, y: 96 }],
  sign: { x: 22, y: 4, w: 150, h: 30 },
  ticker: { x: 34, y: 36, w: 126, h: 9 },
  panel: { x: 0, y: 198, w: 195, h: 38 },
  boardGlimpse: { x: 0, y: 96, w: 22, h: 90 },
  prizeGlimpse: { x: 170, y: 60, w: 25, h: 132 },
  loops: [
    { file: "anim-marquee-phone-calm.png", x: 22, y: 4, w: 150, h: 30, frames: 3, fps: 4, season: "calm" },
    { file: "anim-marquee-phone-haunted.png", x: 22, y: 4, w: 150, h: 30, frames: 3, fps: 4, season: "haunted" },
  ],
};

/** The frames' 9-slice (every frame is 48×48 with 16 px slices) and each one's flat fill. */
export const FRAMES = {
  slice: 16,
  size: 48,
  board: { file: "frame-board.png", fill: "#0b0612" },
  quest: { file: "frame-quest.png", fill: "#170b1f" },
  prize: { file: "frame-prize.png", fill: "#170b1f" },
  paper: { file: "frame-paper.png", fill: "#fff8e7" },
} as const;

/** A length in room pixels as a percentage of the room's width or height (CSS). */
export const pct = (n: number, of: number) => `${Number(((n / of) * 100).toFixed(6))}%`;

/** A box as CSS `left/top/width/height` percentages of its scene. */
export function boxStyle(b: Box, scene: Pick<Scene, "w" | "h">): { left: string; top: string; width: string; height: string } {
  return { left: pct(b.x, scene.w), top: pct(b.y, scene.h), width: pct(b.w, scene.w), height: pct(b.h, scene.h) };
}

/**
 * Where an element sits in each composition, as the CSS variables hall.css reads
 * (`--dl/--dt/--dw/--dh` for the laptop scene, `--pl/--pt/--pw/--ph` for the phone
 * one). Pass `null` for a scene the element does not appear in.
 */
export function placeVars(desk: Box | null, phone: Box | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (desk) {
    const s = boxStyle(desk, DESK);
    Object.assign(out, { "--dl": s.left, "--dt": s.top, "--dw": s.width, "--dh": s.height });
  }
  if (phone) {
    const s = boxStyle(phone, PHONE);
    Object.assign(out, { "--pl": s.left, "--pt": s.top, "--pw": s.width, "--ph": s.height });
  }
  return out;
}

/** A box moved by an offset, in room pixels (a cabinet's button, a floor pool). */
export const shift = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

/** The cabinet at a slot: its box, its screen and its Play strip, in room pixels. */
export function cabinetBoxes(slot: { x: number; y: number }) {
  return {
    cabinet: { x: slot.x, y: slot.y, w: CABINET.w, h: CABINET.h },
    screen: shift(CABINET.screen, slot.x, slot.y),
    button: shift(CABINET.button, slot.x, slot.y),
    pool: { x: slot.x + POOL.dx, y: slot.y + POOL.dy, w: POOL.w, h: POOL.h },
  };
}

/**
 * The room's scale at a content width: 3× at 1302 px and up, the width over 434
 * below that, down to the phone switch. Phones: width over 195, up to 2.5×.
 * (hall.css does this with container units; this is the same arithmetic, for the
 * rows a board can show and for the tests.)
 */
export function roomScale(contentPx: number): { composition: Composition; scale: number } {
  if (contentPx >= PHONE_BELOW_PX) return { composition: "desk", scale: Math.min(contentPx, DESK_MAX_PX) / DESK.w };
  return { composition: "phone", scale: Math.min(contentPx, PHONE_MAX_PX) / PHONE.w };
}
