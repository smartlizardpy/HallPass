import type { Tear } from "../tear";

/**
 * What the pack component asks of a renderer. Two implement it: the WebGL foil
 * (`gl/glPack.ts`) and the DOM fallback (`domPack.ts`), used when WebGL is
 * missing or its context is lost. Everything is fire-and-forget except the
 * timed moves, which resolve when they finish (or at once under reduced motion).
 *
 * Units: u/v are pack space (0..1 across and down the untilted pack); tilt in
 * degrees; velocities in pack widths per second.
 */
export interface PackRenderer {
  readonly kind: "gl" | "dom";
  /** The pack is `packPx` CSS px wide, centred in a `w`×`h` CSS px surface. */
  resize(packPx: number, w: number, h: number): void;
  /** Inspection tilt (rotate about x, then y). */
  setTilt(rxDeg: number, ryDeg: number): void;
  /** The light that follows the pointer; `on` 0..1 fades it. */
  setLight(u: number, v: number, on: number): void;
  /** A fingertip pressing the foil in (depth in pack widths, 0 to release). */
  setDent(u: number, v: number, depth: number): void;
  /** The tear as it stands, and its edge (`seamLine`, left → right). */
  setTear(tear: Tear, seam: Float32Array): void;
  /** The tear is complete: the strip comes free with this velocity and flies off. */
  detach(vx: number, vy: number): void;
  /** Once the strip is off, the mouth eases open (and closes again on reset). */
  loosen(on: boolean): void;
  /** Cards being drawn up pull the pouch a little with them, 0..1. */
  tug(amount: number): void;
  /** The empty wrapper drops out of the way. */
  dropAway(): Promise<void>;
  /** Back to a whole, sealed pack (the open call failed). */
  reset(): void;
  destroy(): void;
}

export interface RendererOptions {
  reducedMotion: boolean;
  /** Called if the renderer can no longer draw (WebGL context lost): swap to the fallback. */
  onLost?: () => void;
}
