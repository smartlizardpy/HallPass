/**
 * The fallback pack, for browsers without WebGL or after a lost context. Same
 * print (`art.ts`), same torn edge (`seamLine`), same contract, drawn with three
 * clipped copies of the print: the body below the edge, the untorn strip, and
 * the torn part of the strip, which swings up about the tear's front. Foil is a
 * gradient that follows the light. Flatter than the WebGL pack, but the same
 * gesture, the same edge and the same choreography.
 */

import type { Tear } from "../tear";
import { emptyTear, TEAR } from "../tear";
import { packArt, PACK_ASPECT } from "./art";
import type { PackRenderer, RendererOptions } from "./types";

function seamPoints(seam: Float32Array, from: number, to: number): string[] {
  const pts: string[] = [];
  const n = seam.length;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    if (u < from - 1e-6 || u > to + 1e-6) continue;
    pts.push(`${(u * 100).toFixed(2)}% ${(seam[i] * 100).toFixed(2)}%`);
  }
  return pts;
}

export async function createDomPack(host: HTMLElement, packId: string, opts: RendererOptions): Promise<PackRenderer> {
  const root = document.createElement("div");
  root.className = "ho-dompack";
  const layer = (cls: string) => {
    const el = document.createElement("div");
    el.className = `ho-dompack-layer ${cls}`;
    root.appendChild(el);
    return el;
  };
  const body = layer("is-body");
  const strip = layer("is-strip");
  const flap = layer("is-flap");
  const foil = layer("is-foil");
  host.appendChild(root);

  let disposed = false;
  let packPx = 280;
  let tear: Tear = emptyTear();
  let seam: Float32Array = new Float32Array(96).fill(TEAR.seamV);
  const reduced = opts.reducedMotion;

  async function paint(px: number) {
    const art = await packArt(packId, Math.min(900, Math.round(px * Math.min(2, window.devicePixelRatio || 1))));
    if (disposed) return;
    const url = art.colour.toDataURL();
    for (const el of [body, strip, flap]) el.style.backgroundImage = `url(${url})`;
    // The sheen follows the pack's silhouette.
    foil.style.maskImage = `url(${url})`;
    foil.style.setProperty("-webkit-mask-image", `url(${url})`);
  }

  function clip() {
    const all = seamPoints(seam, 0, 1);
    body.style.clipPath = `polygon(0% 100%, ${all.join(", ")}, 100% 100%)`;
    foil.style.clipPath = body.style.clipPath;
    const front = tear.side === "right" ? 1 - tear.progress : tear.progress;
    const tornFrom = tear.side === "right" ? front : 0;
    const tornTo = tear.side === "right" ? 1 : tear.side === "left" ? front : 0;
    const untornFrom = tear.side === "right" ? 0 : tornTo;
    const untornTo = tear.side === "right" ? front : 1;
    const top = (a: number, b: number) => `polygon(${(a * 100).toFixed(2)}% 0%, ${(b * 100).toFixed(2)}% 0%, ${[...seamPoints(seam, a, b)].reverse().join(", ")})`;
    strip.style.clipPath = untornTo > untornFrom ? top(untornFrom, untornTo) : "inset(100%)";
    flap.style.clipPath = tornTo > tornFrom ? top(tornFrom, tornTo) : "inset(100%)";
    // The torn part swings up about the front of the tear.
    const hingeU = tear.side === "right" ? front : tornTo;
    const i = Math.round(Math.min(1, Math.max(0, hingeU)) * (seam.length - 1));
    flap.style.transformOrigin = `${(hingeU * 100).toFixed(2)}% ${(seam[i] * 100).toFixed(2)}%`;
    const curl = tear.dragging ? 1 : tear.progress >= 1 ? 1 : 0.2;
    const deg = (tear.side === "right" ? 1 : -1) * curl * (10 + tear.lift * 40) * -1;
    flap.style.transform = tear.side ? `rotate(${deg.toFixed(2)}deg) translateY(${(-curl * 2).toFixed(1)}px)` : "";
  }

  const renderer: PackRenderer = {
    kind: "dom",
    resize(px) {
      packPx = px;
      root.style.width = `${px}px`;
      root.style.height = `${px * PACK_ASPECT}px`;
      void paint(px);
    },
    setTilt(rx, ry) {
      if (reduced) return;
      root.style.transform = `perspective(${packPx * 3.6}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    },
    setLight(u, v, on) {
      foil.style.setProperty("--lu", `${(u * 100).toFixed(1)}%`);
      foil.style.setProperty("--lv", `${(v * 100).toFixed(1)}%`);
      foil.style.opacity = String(0.35 + on * 0.5);
    },
    setDent() {},
    setTear(t, line) {
      tear = t;
      seam = line;
      clip();
    },
    detach(vx) {
      tear = { ...tear, progress: 1, side: tear.side ?? "left" };
      clip();
      strip.style.clipPath = "inset(100%)";
      if (reduced) {
        flap.style.opacity = "0";
        return;
      }
      const dir = tear.side === "right" ? -1 : 1;
      flap.animate(
        [
          { transform: flap.style.transform, opacity: 1 },
          { transform: `translate(${(dir * 60 + vx * 20).toFixed(0)}px, -140px) rotate(${dir * 50}deg)`, opacity: 0 },
        ],
        { duration: 700, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
      );
    },
    loosen(on) {
      body.style.transition = "transform 320ms ease";
      body.style.transform = on && !reduced ? "translateY(2px)" : "";
    },
    tug(amount) {
      root.style.translate = reduced ? "" : `0 ${(amount * 6).toFixed(1)}px`;
    },
    dropAway() {
      if (reduced) {
        root.style.opacity = "0";
        return Promise.resolve();
      }
      const a = root.animate([{ transform: `${root.style.transform} translateY(0)`, opacity: 1 }, { transform: `${root.style.transform} translateY(${packPx * 0.9}px) rotateX(25deg)`, opacity: 0 }], {
        duration: 520,
        easing: "cubic-bezier(.5,0,.75,0)",
        fill: "forwards",
      });
      return a.finished.then(() => undefined).catch(() => undefined);
    },
    reset() {
      root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      root.style.opacity = "";
      flap.style.opacity = "";
      tear = emptyTear();
      seam = new Float32Array(96).fill(TEAR.seamV);
      clip();
    },
    destroy() {
      disposed = true;
      root.remove();
    },
  };
  clip();
  return renderer;
}
