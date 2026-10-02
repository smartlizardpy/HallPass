/**
 * HallPass — the decisions behind the gameplay recorder, kept free of the browser.
 *
 * `game-recorder.ts` does the capturing; everything it has to DECIDE lives here so
 * it can be tested without a canvas: how much to allow, whether a game can be
 * recorded at all, and whether it draws in layers that a single-canvas recording
 * will lose.
 */

import { pickGameCanvas, type CanvasCandidate } from "./dom-capture";
import { extensionFor } from "./replay-buffer";

/** Why a game cannot be recorded. Every one is reported, never swallowed. */
export type RecordFailure =
  | "cross-origin"
  | "no-canvas"
  | "unsupported"
  | "no-container"
  | "failed";

/** What a recording is allowed to cost. */
export type RecordLimits = {
  /** Auto-stop after this long. */
  maxMs: number;
  /** Auto-stop once this many encoded bytes are held. */
  maxBytes: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  /** Frames per second requested from `captureStream`. */
  fps: number;
};

/**
 * Desktop: 5 minutes, ~120 MB. Touch devices: 3 minutes at a lower bitrate.
 *
 * Encoded chunks are held as Blobs (which the browser may spill to disk) and
 * nothing decoded is retained, so memory is not the binding constraint on a
 * desktop. On iOS it is: Safari kills a tab that grows too large and a crash
 * loses the whole take, so a shorter, lighter recording that survives beats a
 * longer one that might not.
 */
export const DESKTOP_LIMITS: RecordLimits = {
  maxMs: 5 * 60_000,
  maxBytes: 120 * 1024 * 1024,
  videoBitsPerSecond: 2_500_000,
  audioBitsPerSecond: 128_000,
  fps: 30,
};

export const TOUCH_LIMITS: RecordLimits = {
  maxMs: 3 * 60_000,
  maxBytes: 80 * 1024 * 1024,
  videoBitsPerSecond: 1_500_000,
  audioBitsPerSecond: 96_000,
  fps: 30,
};

export function limitsFor(touch: boolean): RecordLimits {
  return touch ? TOUCH_LIMITS : DESKTOP_LIMITS;
}

/** Which cap ended a recording, if any. */
export function capReached(
  limits: RecordLimits,
  elapsedMs: number,
  bytes: number,
): "time" | "size" | null {
  if (elapsedMs >= limits.maxMs) return "time";
  if (bytes >= limits.maxBytes) return "size";
  return null;
}

/**
 * Layered games draw to several full-size canvases stacked on one another.
 * Recording one canvas loses the others, so say so.
 *
 * "Layered" means a second visible canvas covers at least half the area of the
 * largest. A minimap or HUD strip next to the main picture does not count — the
 * main picture is the one that is recorded and nothing important is lost.
 */
export function isLayered(candidates: readonly CanvasCandidate[]): boolean {
  const visible = candidates
    .filter((c) => c.renderedWidth > 0 && c.renderedHeight > 0)
    .map((c) => c.width * c.height)
    .sort((a, b) => b - a);
  return visible.length >= 2 && visible[1] >= visible[0] * 0.5;
}

/** How many canvases a tester could see — recorded in the sidecar. */
export function visibleCanvasCount(candidates: readonly CanvasCandidate[]): number {
  return candidates.filter((c) => c.renderedWidth > 0 && c.renderedHeight > 0).length;
}

export type Support = {
  hasMediaRecorder: boolean;
  hasCaptureStream: boolean;
  /** The container `pickMimeType()` chose, or null when none works. */
  mimeType: string | null;
};

/** Can this browser record a canvas at all? */
export function supportFailure(support: Support): RecordFailure | null {
  if (!support.hasMediaRecorder || !support.hasCaptureStream) return "unsupported";
  if (support.mimeType === null) return "no-container";
  return null;
}

/** The canvas to record, or why there is none. */
export function chooseCanvas<T extends CanvasCandidate>(
  candidates: readonly T[],
): { ok: true; canvas: T } | { ok: false; reason: "no-canvas" } {
  const canvas = pickGameCanvas(candidates);
  return canvas ? { ok: true, canvas } : { ok: false, reason: "no-canvas" };
}

/** `snag-20261002-210045`. Local time: the tester recognises it. */
export function takeBaseName(slug: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${slug}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(
    at.getHours(),
  )}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

export function takeFileNames(
  slug: string,
  at: Date,
  mimeType: string,
): { video: string; events: string } {
  const base = takeBaseName(slug, at);
  return { video: `${base}.${extensionFor(mimeType)}`, events: `${base}.events.json` };
}

/** `m:ss` for the recording timer. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
