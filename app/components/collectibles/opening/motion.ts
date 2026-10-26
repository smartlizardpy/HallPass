/**
 * Small Web Animations helpers for the opening's choreography. Every timed step
 * takes an AbortSignal: when the opening moves on (Skip, leaving the page, a
 * stage change) the step's animation is finished at once and the chain stops,
 * so no late callback can act on a stage that is gone.
 */

export class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

export const isAborted = (e: unknown) => e instanceof Aborted;

/** Run a keyframe animation; resolves when it ends, rejects with Aborted if the signal fires first. */
export function play(el: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions, signal?: AbortSignal): Promise<void> {
  if (!el) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Aborted());
  const a = el.animate(frames, opts);
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      try {
        a.finish();
      } catch {
        a.cancel();
      }
      reject(new Aborted());
    };
    signal?.addEventListener("abort", stop, { once: true });
    a.finished
      .then(() => {
        signal?.removeEventListener("abort", stop);
        resolve();
      })
      .catch(() => {
        signal?.removeEventListener("abort", stop);
        reject(new Aborted());
      });
  });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Aborted());
  return new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      window.clearTimeout(t);
      reject(new Aborted());
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** Wait for the browser to have painted the current DOM (two frames). */
export const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Calm, physical easings. */
export const EASE = {
  out: "cubic-bezier(0.2, 0.8, 0.25, 1)",
  inOut: "cubic-bezier(0.55, 0, 0.3, 1)",
  lift: "cubic-bezier(0.3, 0.6, 0.2, 1)",
  settle: "cubic-bezier(0.2, 1.25, 0.4, 1)",
} as const;
