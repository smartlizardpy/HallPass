"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether Board Mode is showing on this page (a session, an open panel, a sign-in
 * window or a running game). A tiny external store so unrelated site chrome (the
 * feature promo, the survey banner, the splash) can stay out of the way of a
 * shared screen without importing the board, and without a prop path through the
 * layout. `BoardProvider` is the only writer.
 *
 * These widgets used to hide themselves on the `/board` path. The board now lives
 * on the homepage, which every visitor sees, so the path says nothing; the state
 * does.
 */

let active = false;
const listeners = new Set<() => void>();

export function setBoardActive(next: boolean): void {
  if (next === active) return;
  active = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** `false` on the server and before the board has said otherwise. */
export function useBoardActive(): boolean {
  return useSyncExternalStore(subscribe, () => active, () => false);
}
