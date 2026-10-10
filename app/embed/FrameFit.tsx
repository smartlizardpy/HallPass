"use client";

/**
 * The picker pages' outer `<main>`, which fits the SDK's inline frame to the card.
 *
 * The SDK opens a picker inline in a fixed-height frame and adds `inline=1` to
 * its URL. Inline, this drops the page padding, so the card itself is the panel,
 * and posts the card's height to the frame's parent whenever it changes; the
 * SDK then fits the frame to it (`openInlinePicker` in `sdk/src/challenge.ts`).
 * Without it the frame stays at its full height and the page shows under a
 * short card. In a popup (no `inline`) it is a padded `<main>` and posts nothing.
 *
 * The height is of this element, not the document: the root layout makes the
 * document at least as tall as the frame, so measuring that could only grow.
 */

import { useEffect, useRef, type ReactNode } from "react";

/**
 * MIRRORED BY HAND from `FRAME_SIZE_TYPE` in `sdk/src/challenge.ts` (the SDK
 * must not import app code, so the string lives in both places).
 */
const FRAME_SIZE_TYPE = "hallpass:frame-size";

export function FrameFit({ inline, children }: { inline: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!inline || !el || window.parent === window) return;
    if (typeof ResizeObserver === "undefined") return;
    let last = 0;
    const report = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last || height <= 0) return;
      last = height;
      // A height is not a secret, and the SDK checks this frame and origin.
      window.parent.postMessage({ type: FRAME_SIZE_TYPE, height }, "*");
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [inline]);

  return (
    <main ref={ref} className={inline ? undefined : "p-3"}>
      {children}
    </main>
  );
}
