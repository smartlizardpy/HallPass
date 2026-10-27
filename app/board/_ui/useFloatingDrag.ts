"use client";

/**
 * Drag-by-handle for a floating panel (the sign-in windows and the on-screen
 * keyboard). Pointer events with capture, so touch, mouse and stylus all work and
 * a finger that slides off the handle keeps dragging; position is clamped by
 * `clampPosition` so the handle can never leave the screen; arrow keys on the
 * handle nudge it for anyone who can't drag.
 *
 * `pos` may be `null` for a panel that is placed by CSS until first moved (the
 * docked keyboard). The first drag starts from where the panel really is.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { clampPosition, nudge, type Point, type Size } from "./drag-math";

export function useFloatingDrag(
  ref: RefObject<HTMLElement | null>,
  initial: () => Point | null,
  fallback: Size,
  onGrab?: () => void,
) {
  const [pos, setPos] = useState<Point | null>(initial);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const sizes = useCallback((): { win: Size; view: Size } => {
    const el = ref.current;
    return {
      win: el ? { w: el.offsetWidth, h: el.offsetHeight } : fallback,
      view: { w: window.innerWidth, h: window.innerHeight },
    };
  }, [ref, fallback]);

  // Keep it on screen if the viewport changes.
  useEffect(() => {
    const onResize = () => {
      const s = sizes();
      setPos((p) => (p ? clampPosition(p, s.win, s.view) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sizes]);

  const current = (): Point | null => {
    if (pos) return pos;
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top };
  };

  const handle = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if ((e.target as HTMLElement).closest("button, input, a")) return;
      onGrab?.();
      const at = current();
      if (!at) return;
      drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      if (!drag.current) return;
      const { win, view } = sizes();
      setPos(clampPosition({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, win, view));
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel(e: React.PointerEvent<HTMLElement>) {
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
      const at = current();
      if (!at) return;
      const next = nudge(at, e.key);
      if (!next) return;
      e.preventDefault();
      const { win, view } = sizes();
      setPos(clampPosition(next, win, view));
    },
  };

  return { pos, setPos, handle, sizes };
}
