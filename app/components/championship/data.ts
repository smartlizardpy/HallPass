"use client";

/**
 * The championship's client data: one shared fetch per URL per page.
 *
 * Every championship surface is a CLIENT ISLAND on a prerendered page (incident
 * #131: no short-lived data under a static page), so live standings arrive from
 * `/api/v1/championship/<id>` — CDN-cached for 30 s — and the viewer's own
 * progress from `/me`, which is per-player and never cached.
 *
 * Several islands on one page (phase banner, table, your progress) share ONE
 * request per URL: the promise is kept for `TTL_MS`. Islands that sit off-screen
 * can pass `active: false` until they are scrolled to (see `useInView`), so a
 * homepage visitor who never scrolls to the card costs nothing.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { MyProgress, PublicChampionship } from "@/app/lib/championship";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; p: Promise<unknown> }>();

function getJson<T>(url: string, withCookies: boolean): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p as Promise<T | null>;
  const p = fetch(url, withCookies ? { credentials: "include", cache: "no-store" } : undefined)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);
  cache.set(url, { at: Date.now(), p });
  return p;
}

/** Forget cached answers, so the next read refetches (after a run is submitted). */
export function forgetChampionship(id: string): void {
  for (const key of cache.keys()) if (key.includes(`/championship/${encodeURIComponent(id)}`)) cache.delete(key);
}

type Loaded<T> = { data: T | null; loading: boolean };

function useJson<T>(url: string, withCookies: boolean, active: boolean, retry: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, loading: true });
  useEffect(() => {
    if (!active) return;
    let live = true;
    getJson<T>(url, withCookies).then((data) => {
      if (live) setState({ data, loading: false });
    });
    return () => {
      live = false;
    };
  }, [url, withCookies, active, retry]);
  return state;
}

/**
 * Public standings and the server's phase. `retry` is a counter the caller bumps
 * (after `forgetChampionship`) to ask again, for a "try again" button.
 */
export function useChampionship(id: string, active = true, retry = 0): Loaded<PublicChampionship> {
  return useJson<PublicChampionship>(`/api/v1/championship/${encodeURIComponent(id)}`, false, active, retry);
}

export type MeResponse = { signedIn: false } | ({ signedIn: true } & MyProgress);

/** The viewer's own progress, or `{ signedIn: false }`. */
export function useMyChampionship(id: string, active = true, retry = 0): Loaded<MeResponse> {
  return useJson<MeResponse>(`/api/v1/championship/${encodeURIComponent(id)}/me`, true, active, retry);
}

/** True once the element has been within 200px of the viewport. Never true for a `display: none` element. */
export function useInView<T extends Element>(): [(el: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false);
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (!el || seen || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  // No IntersectionObserver (very old browsers): load straight away.
  return [ref, seen || typeof IntersectionObserver === "undefined"];
}

/**
 * The time, to the minute, for phase copy. `null` on the server and in the first
 * client render, so a prerendered page is identical for everyone; the islands
 * show phase-neutral words until it arrives.
 */
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;
const subscribeMinute = (onChange: () => void) => {
  const t = setInterval(onChange, 30_000);
  return () => clearInterval(t);
};
export function useMinute(): number | null {
  return useSyncExternalStore(subscribeMinute, minute, () => null);
}
