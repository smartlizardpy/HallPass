"use client";

/**
 * A sealed pack on the Pack Room shelf: the same printed foil pouch the opening
 * tears (`opening/pack/art.ts`), drawn once into a 2D canvas. No WebGL here. The
 * foil feel is CSS: a drop shadow, and on hover or focus of the surrounding
 * `.hc-link` a small lift, a slight tilt and a sheen masked to the pack's own
 * silhouette (taken from the canvas, so the pinked edges stay clean).
 *
 * The box has a fixed aspect ratio from the first paint, so drawing never
 * shifts the layout. Drawing waits until the box is near the viewport.
 */

import "./collectibles.css";
import { useEffect, useRef } from "react";
import { PACK_ASPECT, packArt } from "./opening/pack/art";

export function PackPrint({ packId, width, className }: { packId: string; width: number; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    let cancelled = false;
    let started = false;

    const draw = () => {
      if (started) return;
      started = true;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.round(width * dpr);
      packArt(packId, px)
        .then((art) => {
          if (cancelled) return;
          canvas.width = art.colour.width;
          canvas.height = art.colour.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(art.colour, 0, 0);
          try {
            box.style.setProperty("--hc-pack-mask", `url(${art.colour.toDataURL("image/png")})`);
          } catch {
            /* the sheen just stays off */
          }
          box.dataset.ready = "";
        })
        .catch(() => {
          started = false;
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      draw();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          draw();
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(box);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [packId, width]);

  return (
    <span
      ref={boxRef}
      className={`hc-print${className ? ` ${className}` : ""}`}
      style={{ width, height: Math.round(width * PACK_ASPECT) }}
    >
      <canvas ref={canvasRef} className="hc-print-canvas" aria-hidden="true" />
      <span className="hc-print-sheen" aria-hidden="true" />
    </span>
  );
}
