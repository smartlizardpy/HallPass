"use client";

/**
 * HallPass — silencing the arcade while the panic disguise is up.
 *
 * A pixel-perfect Google Doc is worthless if the room can still hear a game.
 * Sound is the loudest tell there is: a teacher who hears coin pickups does not
 * need to read the screen. So raising the disguise has to take the noise with it,
 * and dismissing it has to give back EXACTLY the state the player had — never
 * unmuting something they muted themselves, never resuming what they had paused.
 *
 * ── WHAT IS ACTUALLY REACHABLE FROM THE HOST PAGE ───────────────────────────
 * Games run in iframes, so most of the noise is not ours to touch directly:
 *
 *   - SAME-ORIGIN frames — the local catalogue, served from `/game-html/<slug>/`
 *     (and its `/games/<slug>/` static twin) — ARE scriptable. We walk into their
 *     documents and treat their media elements exactly like our own.
 *   - CROSS-ORIGIN frames — external games on their own origin, and the YouTube
 *     trailer embeds on the store pages — are not reachable at all. Touching
 *     `contentDocument` throws, and neither embed exposes a postMessage control
 *     channel we could use instead (the trailer URL deliberately omits
 *     `enablejsapi`). Nothing in this module can silence those; the honest
 *     mitigation is the focus move in `panic.ts`, since most engines pause
 *     themselves on window blur.
 *   - WEB AUDIO inside a frame is only reachable if the game parked its
 *     `AudioContext` on a global, which the plain-script games of this genre
 *     usually do. {@link findAudioContexts} sweeps for those; a context held in a
 *     module-local closure stays out of reach, and no host-page API can find it.
 *   - `new Audio()` elements never inserted into a document are likewise
 *     invisible to a DOM query. Their sound survives.
 *
 * Best-effort by construction, then — but it covers the local `<audio>`/`<video>`
 * games and the common Web Audio case, which is the difference between silence
 * and a room full of noise.
 *
 * The module keeps the repo's stealth split: a PURE core (no `window`, works on
 * anything shaped like a media element, unit-tested) under a thin browser layer
 * that does nothing but find the real objects and hand them over.
 */

/* -------------------------------------------------------------------------- *
 * Pure core — no `window`, fully unit-testable.
 * -------------------------------------------------------------------------- */

/** The slice of `HTMLMediaElement` this module touches. */
export type Silenceable = {
  muted: boolean;
  paused: boolean;
  pause(): void;
  play(): unknown;
};

/** What one media element was doing before we silenced it. */
export type MediaSilence = {
  media: Silenceable;
  /** Its `muted` flag before we touched it — restored verbatim. */
  wasMuted: boolean;
  /** True only if WE paused it, so an already-paused clip stays paused. */
  wePaused: boolean;
};

/** The slice of `AudioContext` this module touches. */
export type Suspendable = {
  readonly state: string;
  suspend(): unknown;
  resume(): unknown;
};

/**
 * Mute and pause everything, recording the prior state of each element.
 *
 * Muting AND pausing on purpose: muting alone leaves a video's frames advancing
 * (and its timeline running), while pausing alone is undone by any game loop that
 * calls `play()` again on its own. Doing both means the only way sound comes back
 * is through {@link restoreMedia}.
 */
export function silenceMedia(media: readonly Silenceable[]): MediaSilence[] {
  const records: MediaSilence[] = [];
  for (const el of media) {
    const wasMuted = el.muted === true;
    const wePaused = el.paused !== true;
    try {
      el.muted = true;
      if (wePaused) el.pause();
    } catch {
      /* A detached or mid-teardown element — nothing to silence. */
    }
    records.push({ media: el, wasMuted, wePaused });
  }
  return records;
}

/**
 * Put every recorded element back exactly as it was. An element the player had
 * already muted stays muted; one they had already paused stays paused. A resumed
 * `play()` can still be refused by the autoplay policy (it returns a rejected
 * promise) — dismissal always follows a real gesture, so in practice it is
 * allowed, and a refusal is swallowed rather than thrown at the player.
 */
export function restoreMedia(records: readonly MediaSilence[]): void {
  for (const { media, wasMuted, wePaused } of records) {
    try {
      media.muted = wasMuted;
      if (wePaused) {
        const result = media.play();
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {});
        }
      }
    } catch {
      /* Gone from the document since we silenced it — nothing to restore. */
    }
  }
}

/**
 * Suspend every context that is currently running, returning the ones we
 * actually suspended. A context the game had already suspended is left alone, so
 * {@link resumeAudio} cannot start audio the game deliberately stopped.
 */
export function suspendAudio(contexts: readonly Suspendable[]): Suspendable[] {
  const suspended: Suspendable[] = [];
  for (const ctx of contexts) {
    if (ctx.state !== "running") continue;
    try {
      ctx.suspend();
      suspended.push(ctx);
    } catch {
      /* Closed between the sweep and here. */
    }
  }
  return suspended;
}

/** Resume only the contexts {@link suspendAudio} actually suspended. */
export function resumeAudio(contexts: readonly Suspendable[]): void {
  for (const ctx of contexts) {
    try {
      ctx.resume();
    } catch {
      /* Closed while the disguise was up. */
    }
  }
}

/**
 * Sweep a global object for anything the caller recognises as an audio context.
 * Only OWN ENUMERABLE keys are read, which is exactly where a classic script's
 * top-level `var ctx = new AudioContext()` lands and nowhere near the hundreds of
 * inherited platform properties. Results are de-duplicated because one context is
 * commonly aliased under several names.
 *
 * READING AND TESTING BOTH HAPPEN INSIDE THE GUARD, and that is the whole point
 * rather than caution: a page that embeds an external game has that frame's
 * cross-origin WindowProxy sitting among its own globals under the iframe's id,
 * and touching ANY property of one — including the property reads a type test
 * makes — throws a SecurityError. Let that escape and the sweep dies halfway
 * through raising the disguise, leaving the arcade muted with no undo. A value we
 * are not allowed to inspect is by definition not ours to silence.
 */
export function findAudioContexts(
  scope: object,
  isContext: (value: unknown) => boolean,
): Suspendable[] {
  const found = new Set<Suspendable>();
  let keys: string[];
  try {
    keys = Object.keys(scope);
  } catch {
    return [];
  }
  for (const key of keys) {
    try {
      const value = (scope as Record<string, unknown>)[key];
      if (isContext(value)) found.add(value as Suspendable);
    } catch {
      continue;
    }
  }
  return [...found];
}

/* -------------------------------------------------------------------------- *
 * Browser layer — finds the real objects, then defers to the core.
 * -------------------------------------------------------------------------- */

/** Guards a pathological page from an unbounded frame walk. */
const MAX_FRAME_DEPTH = 3;

/**
 * Every window we are allowed to script: this one plus the same-origin frames
 * beneath it. A cross-origin frame throws on property access, which is precisely
 * the signal that it is none of our business — so the `catch` is the boundary
 * check, not a failure path.
 */
function scriptableWindows(root: Window, depth = 0): Window[] {
  const windows: Window[] = [root];
  if (depth >= MAX_FRAME_DEPTH) return windows;
  let frames: HTMLCollectionOf<HTMLIFrameElement> | never[] = [];
  try {
    frames = root.document.getElementsByTagName("iframe");
  } catch {
    return windows;
  }
  for (const frame of Array.from(frames)) {
    try {
      const child = frame.contentWindow;
      // Reading `document` is the same-origin test; it throws for a foreign origin.
      if (!child || !child.document) continue;
      windows.push(...scriptableWindows(child, depth + 1));
    } catch {
      /* Cross-origin — unreachable by design. */
    }
  }
  return windows;
}

function mediaIn(win: Window): Silenceable[] {
  try {
    return Array.from(win.document.querySelectorAll<HTMLMediaElement>("audio, video"));
  } catch {
    return [];
  }
}

function contextsIn(win: Window): Suspendable[] {
  const ctor = (win as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown });
  const classes = [ctor.AudioContext, ctor.webkitAudioContext].filter(
    (c): c is new () => unknown => typeof c === "function",
  );
  if (classes.length === 0) return [];
  return findAudioContexts(win, (value) => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { state?: unknown; suspend?: unknown; resume?: unknown };
    if (typeof candidate.suspend !== "function" || typeof candidate.resume !== "function") {
      return false;
    }
    return classes.some((c) => value instanceof c);
  });
}

/**
 * Silence the arcade. Returns the undo — call it once, on dismiss, to put every
 * element and context back the way the player left it. A no-op outside the
 * browser, so the controller's effect needs no extra guard.
 */
export function hushArcade(): () => void {
  if (typeof window === "undefined") return () => {};
  const windows = scriptableWindows(window);
  const records = silenceMedia(windows.flatMap(mediaIn));
  const suspended = suspendAudio(windows.flatMap(contextsIn));
  return () => {
    restoreMedia(records);
    resumeAudio(suspended);
  };
}
