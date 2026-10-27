/**
 * Pure geometry for the floating login windows, kept out of the component so the
 * clamp and the keyboard nudge can be tested without a DOM.
 */

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

/** Keep at least this much of a window on screen so its title bar stays grabbable. */
export const GRAB_MARGIN = 48;

/**
 * Clamp a window's top-left so the title bar can never be dragged out of reach:
 * fully on-screen when it fits, otherwise at least {@link GRAB_MARGIN} px visible
 * horizontally and the whole title row visible vertically.
 */
export function clampPosition(pos: Point, win: Size, view: Size): Point {
  const minX = Math.min(0, GRAB_MARGIN - win.w);
  const maxX = Math.max(0, view.w - win.w);
  const minY = 0;
  const maxY = Math.max(0, view.h - GRAB_MARGIN);
  const fitsX = win.w <= view.w;
  return {
    x: Math.round(Math.min(Math.max(pos.x, fitsX ? 0 : minX), fitsX ? maxX : Math.max(view.w - GRAB_MARGIN, minX))),
    y: Math.round(Math.min(Math.max(pos.y, minY), maxY)),
  };
}

/** The default spot for the nth window: cascaded so new ones don't hide old ones. */
export function startPosition(index: number, win: Size, view: Size): Point {
  const step = 36;
  const base: Point = {
    x: Math.round((view.w - win.w) / 2) + (index % 5) * step - 2 * step,
    y: Math.round((view.h - win.h) / 3) + (index % 5) * step - 2 * step,
  };
  return clampPosition(base, win, view);
}

export function nudge(pos: Point, key: string, step = 16): Point | null {
  switch (key) {
    case "ArrowLeft": return { x: pos.x - step, y: pos.y };
    case "ArrowRight": return { x: pos.x + step, y: pos.y };
    case "ArrowUp": return { x: pos.x, y: pos.y - step };
    case "ArrowDown": return { x: pos.x, y: pos.y + step };
    default: return null;
  }
}
