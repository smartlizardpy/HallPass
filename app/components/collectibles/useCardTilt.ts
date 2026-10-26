"use client";

import { useEffect, type RefObject } from "react";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The card's material variables (see holo.css): rest pose is the registered defaults. */
const REST = { px: 0.5, py: 0.5, rx: 0, ry: 0, tilt: 0 };
type Pose = typeof REST;
const KEYS = ["px", "py", "rx", "ry", "tilt"] as const;
const MAX_DEG = 14;
const STIFFNESS = 0.15;
const DAMPING = 0.8;

/**
 * Tilt and light for ONE card: hover with a mouse, drag with a finger. Writes
 * `--px --py --tilt --rx --ry` (the contract in holo.css) straight onto the
 * element through a small spring, at most once per animation frame, with no
 * React state. `data-tilt` is set while the card is away from rest, which is
 * what turns the tilt transform on; when the spring settles back the inline
 * variables and the attribute are removed, so an ancestor driving the same
 * variables (the opening) is never shadowed. Does nothing under reduced motion.
 *
 * Touch uses pointer events and holds the pointer on press; the card carries
 * `touch-action: none` (holo.css) only when live, so grids still scroll.
 *
 * `from` listens somewhere else: an ancestor that also holds a control laid
 * over the card (the opening's turn button, the summary's link). The card then
 * follows that element's pointer, and a finger is tracked without capturing
 * it, so the control still gets its taps and swipes.
 */
export function useCardTilt(ref: RefObject<HTMLElement | null>, enabled = true, from?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reducedMotion()) return;
    const src = from?.current ?? el;
    let finger: number | null = null; // the pressed pointer, when not captured
    const pos: Pose = { ...REST };
    const vel: Pose = { px: 0, py: 0, rx: 0, ry: 0, tilt: 0 };
    let target: Pose = { ...REST };
    let frame = 0;
    let last = 0;
    let active = false; // a pointer is steering the card

    const write = () => {
      el.style.setProperty("--px", pos.px.toFixed(3));
      el.style.setProperty("--py", pos.py.toFixed(3));
      el.style.setProperty("--tilt", pos.tilt.toFixed(3));
      el.style.setProperty("--rx", pos.rx.toFixed(2));
      el.style.setProperty("--ry", pos.ry.toFixed(2));
    };
    const clear = () => {
      for (const k of KEYS) el.style.removeProperty(`--${k}`);
      delete el.dataset.tilt;
    };
    const step = (now: number) => {
      frame = 0;
      // Scale to the frame time so 30 and 144 Hz screens feel alike (capped: a background tab must not fling the card).
      const f = Math.min(3, last ? (now - last) / 16.67 : 1);
      last = now;
      let moving = false;
      for (const k of KEYS) {
        vel[k] = (vel[k] + (target[k] - pos[k]) * STIFFNESS * f) * Math.pow(DAMPING, f);
        pos[k] += vel[k] * f;
        if (Math.abs(vel[k]) > 0.0008 || Math.abs(target[k] - pos[k]) > 0.002) moving = true;
      }
      if (moving || active) {
        write();
        frame = requestAnimationFrame(step);
      } else {
        Object.assign(pos, REST);
        last = 0;
        clear();
      }
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    const aim = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      target = {
        px,
        py,
        rx: (px - 0.5) * 2 * MAX_DEG,
        ry: (0.5 - py) * 2 * MAX_DEG,
        tilt: Math.min(1, Math.hypot(px - 0.5, py - 0.5) * 2),
      };
      active = true;
      el.dataset.tilt = "";
      kick();
    };
    const release = () => {
      active = false;
      target = { ...REST };
      kick();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (src === el) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
      } else finger = e.pointerId;
      aim(e);
    };
    const onMove = (e: PointerEvent) => {
      // A finger only steers while pressed; a mouse steers on hover.
      if (e.pointerType !== "mouse" && !(src === el ? el.hasPointerCapture?.(e.pointerId) : finger === e.pointerId)) return;
      aim(e);
    };
    const onUp = () => {
      finger = null;
      release();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || finger === e.pointerId) onUp();
    };
    src.addEventListener("pointerdown", onDown);
    src.addEventListener("pointermove", onMove);
    src.addEventListener("pointerleave", onLeave);
    src.addEventListener("pointerup", onUp);
    src.addEventListener("pointercancel", onUp);
    return () => {
      src.removeEventListener("pointerdown", onDown);
      src.removeEventListener("pointermove", onMove);
      src.removeEventListener("pointerleave", onLeave);
      src.removeEventListener("pointerup", onUp);
      src.removeEventListener("pointercancel", onUp);
      if (frame) cancelAnimationFrame(frame);
      clear();
    };
  }, [ref, enabled, from]);
}
