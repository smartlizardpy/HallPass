"use client";

import { useEffect, type RefObject } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Pointer-driven foil and tilt for ONE element: writes `--mx`/`--my` (0-100 %)
 * and `--rx`/`--ry` (degrees, ±`tilt`) as custom properties, at most once per
 * animation frame, straight onto the element (no React state, no re-render).
 * Resets on leave. Does nothing under reduced motion, so the foil sits still.
 */
export function useHolo(ref: RefObject<HTMLElement | null>, { enabled = true, tilt = 0 }: { enabled?: boolean; tilt?: number } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reducedMotion()) return;
    let frame = 0;
    let last: { x: number; y: number } | null = null;
    const paint = () => {
      frame = 0;
      if (!last) return;
      const r = el.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (last.x - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (last.y - r.top) / r.height));
      el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
      if (tilt) {
        el.style.setProperty("--rx", `${((px - 0.5) * 2 * tilt).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${((0.5 - py) * 2 * tilt).toFixed(2)}deg`);
      }
      el.dataset.live = "";
    };
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      last = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      for (const p of ["--mx", "--my", "--rx", "--ry"]) el.style.removeProperty(p);
      delete el.dataset.live;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, enabled, tilt]);
}

/** `on` while the element is on screen, `paused` off it: for the one looping finish. */
export function useOnScreenLoop(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (reducedMotion() || typeof IntersectionObserver === "undefined") {
      el.dataset.loop = "paused";
      return;
    }
    const io = new IntersectionObserver((entries) => {
      el.dataset.loop = entries.some((e) => e.isIntersecting) ? "on" : "paused";
    });
    io.observe(el);
    return () => {
      io.disconnect();
      delete el.dataset.loop;
    };
  }, [ref, enabled]);
}
