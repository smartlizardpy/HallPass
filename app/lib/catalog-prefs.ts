"use client";

import { useSyncExternalStore } from "react";
import {
  type CatalogSort,
  DEFAULT_CATALOG_SORT,
  toCatalogSort,
} from "./catalog-order";

/**
 * HallPass — what the visitor chose about the main grid: the ORDER it is in and
 * the LAYOUT it is drawn as. Two per-device preferences, kept in `localStorage`
 * and exposed to React through `useSyncExternalStore`.
 *
 * ── WHY NOT THE URL ────────────────────────────────────────────────────────
 * `?sort=alpha` is the obvious home for this and it is the wrong one here. The
 * home grid is statically prerendered and sits in the service-worker precache;
 * reading a search parameter during render means `useSearchParams`, which forces
 * a Suspense boundary and de-opts the page out of prerendering — and therefore
 * out of the precache, which is what makes this arcade work offline. `Arcade`
 * already declines to read `?q=` for exactly that reason and seeds the search box
 * from `window.location` after mount instead. This follows it.
 *
 * It also means the preference is not shareable, and that is the right trade:
 * "how I like the grid" is a habit, not a link. A URL that carried it would make
 * every share a vote on somebody else's layout, and would hand Google a second
 * copy of the home page for every order on the toolbar.
 *
 * ── WHY THE SERVER SNAPSHOT IS ALWAYS THE DEFAULT ──────────────────────────
 * The prerendered HTML is one payload shared by every visitor and every crawler,
 * so the first client render must match it exactly. `getServerSnapshot` returns
 * the default for both preferences; the stored value is read on the render AFTER
 * hydration. The extra render is the point, not an oversight — the same
 * second-paint rule `useDevicePlatform` and the `?q=` seeding both follow.
 *
 * Every read is wrapped try/catch → the default: private mode, a disabled-storage
 * policy and a value somebody typed into devtools all have to degrade to "the
 * grid as it ships" rather than throw inside a render.
 */

/** How the filtered grid is drawn. */
export type CatalogView = "grid" | "list";

/** Cards, as the grid has always been drawn. */
export const DEFAULT_CATALOG_VIEW: CatalogView = "grid";

/** The layouts, in the order the toolbar offers them. */
export const CATALOG_VIEWS: readonly { value: CatalogView; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
];

/** Narrow stored input to a {@link CatalogView}; see `toCatalogSort`. */
export function toCatalogView(value: unknown): CatalogView | null {
  return CATALOG_VIEWS.some((v) => v.value === value)
    ? (value as CatalogView)
    : null;
}

const SORT_KEY = "hp:catalog-sort";
const VIEW_KEY = "hp:catalog-view";

/**
 * ONE listener set for both preferences. A sort change therefore also wakes the
 * view's subscribers, which costs nothing: both snapshots are plain strings, so
 * an unchanged one compares equal and React bails out of the re-render. Two sets
 * would be two things to keep subscribed and unsubscribed correctly in exchange
 * for a saving nobody could measure.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // keep tabs in sync
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Read one preference, VALIDATED, falling back to `fallback` for a missing key,
 * an unreadable store, or a value that is not one of the ones we offer.
 *
 * Reading `localStorage` inside `getSnapshot` is safe here only because the
 * result is a primitive: `useSyncExternalStore` compares snapshots with
 * `Object.is`, so a fresh string that happens to be equal ends the render, while
 * the freshly-parsed ARRAY that `personalization.ts` would have returned would
 * loop forever. That is why that module caches and this one does not need to.
 */
function read<T extends string>(
  key: string,
  parse: (value: unknown) => T | null,
  fallback: T,
): T {
  try {
    return parse(window.localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Persist a preference (best effort) and notify every subscriber regardless. */
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled: the choice still applies to this page,
    // it just will not survive the reload.
  }
  listeners.forEach((l) => l());
}

const getSortSnapshot = (): CatalogSort =>
  read(SORT_KEY, toCatalogSort, DEFAULT_CATALOG_SORT);

const getViewSnapshot = (): CatalogView =>
  read(VIEW_KEY, toCatalogView, DEFAULT_CATALOG_VIEW);

const serverSort = (): CatalogSort => DEFAULT_CATALOG_SORT;
const serverView = (): CatalogView => DEFAULT_CATALOG_VIEW;

/** The order the visitor last chose for the grid. */
export function useCatalogSort(): CatalogSort {
  return useSyncExternalStore(subscribe, getSortSnapshot, serverSort);
}

/** Choose an order; every grid on the page re-renders from this one call. */
export function setCatalogSort(sort: CatalogSort): void {
  write(SORT_KEY, sort);
}

/** The layout the visitor last chose for the grid. */
export function useCatalogView(): CatalogView {
  return useSyncExternalStore(subscribe, getViewSnapshot, serverView);
}

/** Choose a layout. */
export function setCatalogView(view: CatalogView): void {
  write(VIEW_KEY, view);
}
