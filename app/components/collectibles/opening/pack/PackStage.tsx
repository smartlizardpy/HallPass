"use client";

/**
 * The sealed pack as an object you handle: hover to turn it toward the light,
 * press and drag the face to inspect it (the foil dents under the finger and
 * springs back), drag along the top to tear it. Enter or Space tears it for
 * you. The rendering is a WebGL foil pack, or the DOM fallback when WebGL is
 * missing or lost; both are loaded on demand, so a page that never shows a
 * sealed pack (a resumed reveal) never downloads them.
 *
 * Layering, back to front: the pouch's inside (DOM), the cards (`children`,
 * DOM), the wrapper (canvas). So cards drawn up out of the pack really pass
 * behind its front wall.
 *
 * Input goes through the pure tear model (`../tear.ts`); this component only
 * converts pointer positions to pack space and reports what happened. It never
 * calls the server: `onCommit` does, once, in the flow.
 */

import "./pack.css";
import { useCallback, useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { autoTearPoint, dragTear, emptyTear, inTearZone, pressTear, reachedEdge, releaseTear, seamLine, type Tear, type TearPoint } from "../tear";
import { PACK_ASPECT } from "./art";
import type { PackRenderer } from "./types";

export interface PackStageHandle {
  /** Tear it open without a gesture (keyboard, the Open button). */
  autoTear(): void;
  loosen(on: boolean): void;
  tug(amount: number): void;
  dropAway(): Promise<void>;
  /** Whole and sealed again (the open call failed). */
  reset(): void;
}

interface Props {
  packId: string;
  seed: number;
  interactive: boolean;
  reducedMotion: boolean;
  label: string;
  describedBy?: string;
  onTearStart(): void;
  onTearAdvance(advance: number, speed: number): void;
  onTearSettle(): void;
  onCommit(): void;
  onHandle(intensity: number): void;
  onRenderer?(kind: "gl" | "dom"): void;
  children?: ReactNode;
  ref?: Ref<PackStageHandle>;
}

/** The canvas is bigger than the pack so the strip can fly and the pack can tilt without clipping. */
const CANVAS_W = 2.3;
const CANVAS_H = 2.0;

export function PackStage(props: Props) {
  const { ref } = props;
  const slot = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const domHost = useRef<HTMLDivElement>(null);
  const renderer = useRef<PackRenderer | null>(null);
  const tear = useRef<Tear>(emptyTear());
  const mode = useRef<"idle" | "inspect" | "tear" | "done">("idle");
  const press = useRef<{ x: number; y: number; samples: TearPoint[] } | null>(null);
  const auto = useRef(0);
  const cb = useRef(props);
  // Read the latest callbacks from handlers without re-binding them.
  useEffect(() => {
    cb.current = props;
  });
  const { packId, seed, reducedMotion } = props;

  // ── Renderer: WebGL if we can, the DOM fallback otherwise (or if the context is lost). ──
  useEffect(() => {
    let live = true;
    let ro: ResizeObserver | null = null;
    const el = slot.current;
    const cv = canvas.current;
    const host = domHost.current;
    if (!el || !cv || !host) return;

    const layout = () => {
      const r = renderer.current;
      if (!r) return;
      const w = el.clientWidth;
      if (r.kind === "gl") {
        const cw = Math.round(w * CANVAS_W);
        const ch = Math.round(w * PACK_ASPECT * CANVAS_H);
        cv.style.width = `${cw}px`;
        cv.style.height = `${ch}px`;
        r.resize(w, cw, ch);
      } else r.resize(w, w, w * PACK_ASPECT);
      r.setTear(tear.current, seamLine(tear.current, seed));
    };

    const fallBack = async () => {
      const { createDomPack } = await import("./domPack");
      if (!live) return;
      renderer.current?.destroy();
      cv.style.display = "none";
      renderer.current = await createDomPack(host, packId, { reducedMotion });
      if (!live) return renderer.current.destroy();
      layout();
      cb.current.onRenderer?.("dom");
    };

    (async () => {
      const gl = await import("./gl/glPack");
      if (!live) return;
      const r = gl.webglAvailable() ? await gl.createGLPack(cv, packId, seed, { reducedMotion, onLost: () => live && void fallBack() }) : null;
      if (!live) return r?.destroy();
      if (!r) return fallBack();
      renderer.current = r;
      layout();
      r.setLight(0.22, 0.18, 0.35);
      cb.current.onRenderer?.("gl");
    })();

    ro = new ResizeObserver(() => layout());
    ro.observe(el);
    return () => {
      live = false;
      ro?.disconnect();
      cancelAnimationFrame(auto.current);
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [packId, seed, reducedMotion]);

  const toPack = useCallback((x: number, y: number, t: number): TearPoint => {
    const r = slot.current!.getBoundingClientRect();
    return { u: (x - r.left) / r.width, v: (y - r.top) / r.height, t };
  }, []);

  const show = useCallback(() => renderer.current?.setTear(tear.current, seamLine(tear.current, seed)), [seed]);

  /** The tear is done: run the front to the end, let the strip go, tell the flow. */
  const finish = useCallback(
    (vx: number, vy: number) => {
      if (mode.current === "done") return;
      mode.current = "done";
      tear.current = { ...tear.current, progress: 1, dragging: false, side: tear.current.side ?? "left" };
      show();
      cb.current.onCommit();
      const r = renderer.current;
      window.setTimeout(() => r?.detach(vx, vy), reducedMotion ? 0 : 90);
    },
    [show, reducedMotion],
  );

  const autoTear = useCallback(() => {
    if (mode.current === "done" || !cb.current.interactive) return;
    mode.current = "tear";
    cb.current.onTearStart();
    const dur = reducedMotion ? 0 : 620;
    const t0 = performance.now();
    tear.current = pressTear(tear.current.side ? tear.current : emptyTear(), { ...autoTearPoint(0, seed), t: t0 });
    const tick = (now: number) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      const { tear: next, advance } = dragTear(tear.current, { ...autoTearPoint(k, seed), t: now }, slot.current?.clientWidth ?? 280);
      tear.current = next;
      show();
      if (advance > 0) cb.current.onTearAdvance(advance, next.speed);
      if (k < 1) auto.current = requestAnimationFrame(tick);
      else finish(1.6, 0.9);
    };
    auto.current = requestAnimationFrame(tick);
  }, [finish, reducedMotion, seed, show]);

  useImperativeHandle(
    ref,
    () => ({
      autoTear,
      loosen(on) {
        slot.current?.toggleAttribute("data-open", on);
        renderer.current?.loosen(on);
      },
      tug: (amount) => renderer.current?.tug(amount),
      dropAway: () => renderer.current?.dropAway() ?? Promise.resolve(),
      reset() {
        cancelAnimationFrame(auto.current);
        slot.current?.removeAttribute("data-open");
        mode.current = "idle";
        tear.current = emptyTear();
        renderer.current?.reset();
        show();
      },
    }),
    [autoTear, show],
  );

  // ── Pointer input ──
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!props.interactive || mode.current === "done" || (e.pointerType === "mouse" && e.button !== 0)) return;
    const p = toPack(e.clientX, e.clientY, e.timeStamp);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture is a nicety; moves still arrive while over the pack
    }
    press.current = { x: e.clientX, y: e.clientY, samples: [p] };
    if (inTearZone(p)) {
      mode.current = "tear";
      tear.current = pressTear(tear.current, p);
      renderer.current?.setTilt(0, 0);
      renderer.current?.setLight(p.u, p.v, 0.9);
      cb.current.onTearStart();
    } else {
      mode.current = "inspect";
      renderer.current?.setDent(p.u, p.v, 0.016);
      renderer.current?.setLight(p.u, p.v, 1);
      cb.current.onHandle(0.4);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = renderer.current;
    if (!r || !props.interactive) return;
    const p = toPack(e.clientX, e.clientY, e.timeStamp);
    const pr = press.current;
    if (!pr) {
      // Hover: turn the pack toward the pointer and let the light follow.
      if (e.pointerType !== "mouse") return;
      r.setTilt(-(p.v - 0.5) * 12, (p.u - 0.5) * 16);
      r.setLight(p.u, p.v, 1);
      return;
    }
    pr.samples.push(p);
    if (pr.samples.length > 8) pr.samples.shift();
    if (mode.current === "tear") {
      const { tear: next, advance } = dragTear(tear.current, p, slot.current!.clientWidth);
      tear.current = next;
      show();
      r.setLight(p.u, p.v, 0.9);
      if (advance > 0) cb.current.onTearAdvance(advance, next.speed);
      if (reachedEdge(next)) {
        const v = velocity(pr.samples);
        endPress(e);
        finish(v.x, v.y);
      }
    } else if (mode.current === "inspect") {
      const w = slot.current!.clientWidth;
      const dx = (e.clientX - pr.x) / w;
      const dy = (e.clientY - pr.y) / (w * PACK_ASPECT);
      const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));
      r.setTilt(clamp(-dy * 40, 20), clamp(dx * 48, 24));
      r.setLight(p.u, p.v, 1);
      r.setDent(p.u, p.v, 0.016);
      const v = velocity(pr.samples);
      cb.current.onHandle(Math.min(1, Math.hypot(v.x, v.y) / 3));
    }
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>) => {
    press.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const pr = press.current;
    if (!pr) return;
    endPress(e);
    const r = renderer.current;
    if (mode.current === "tear") {
      const { tear: next, outcome } = releaseTear(tear.current);
      tear.current = next;
      if (outcome === "commit") {
        const v = velocity(pr.samples);
        finish(v.x, v.y);
      } else {
        mode.current = "idle";
        show();
        cb.current.onTearSettle();
      }
    } else if (mode.current === "inspect") {
      mode.current = "idle";
      r?.setDent(0.5, 0.5, 0);
      r?.setTilt(0, 0);
    }
    if (e.pointerType !== "mouse") r?.setLight(0.22, 0.18, 0.35);
  };

  const onPointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (press.current || e.pointerType !== "mouse") return;
    renderer.current?.setTilt(0, 0);
    renderer.current?.setLight(0.22, 0.18, 0.35);
  };

  return (
    <div className="ho-pack-slot" ref={slot}>
      <div className="ho-interior" aria-hidden="true" />
      <div className="ho-cards-layer">{props.children}</div>
      <canvas ref={canvas} className="ho-pack-canvas" aria-hidden="true" />
      <div ref={domHost} className="ho-pack-dom" aria-hidden="true" />
      <div
        className="ho-pack-hit"
        role="button"
        tabIndex={props.interactive ? 0 : -1}
        aria-label={props.label}
        aria-describedby={props.describedBy}
        aria-disabled={!props.interactive || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && props.interactive) {
            e.preventDefault();
            autoTear();
          }
        }}
      />
    </div>
  );
}

/** Release velocity from the last samples, in pack widths per second (y up). */
function velocity(samples: TearPoint[]): { x: number; y: number } {
  if (samples.length < 2) return { x: 0, y: 0 };
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dt = Math.max(16, b.t - a.t) / 1000;
  return { x: (b.u - a.u) / dt, y: (-(b.v - a.v) * PACK_ASPECT) / dt };
}
