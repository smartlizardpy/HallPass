"use client";

/**
 * HallPass mobile — the launch splash.
 *
 * More than polish: the mobile shell is decided on the SECOND paint (device is
 * `null` on the server and first client render — see `use-device-platform.ts`),
 * so for a beat the desktop layout is on screen before it swaps to the phone
 * shell. This overlay covers exactly that seam: a phone visitor sees the wordmark
 * and a spinning wheel, and by the time it fades the mobile shell has mounted
 * underneath.
 *
 * ONCE PER SESSION. Keyed in `sessionStorage`, so it plays on the first load /
 * PWA launch and never again while browsing around — a splash on every tap-through
 * gets old fast.
 *
 * REDUCED MOTION. The wheel spins only under `motion-safe`; a visitor who asked
 * for less motion gets the static mark and a plain fade. No JS branch needed —
 * the Tailwind `motion-safe:` variant gates it at the CSS level.
 *
 * SERVER / DESKTOP. `null` until mounted and only ever shown on a real phone, so
 * it is absent from the prerendered HTML the crawler and the SW precache see.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useDevicePlatform } from "../lib/use-device-platform";
import { Wordmark } from "./Wordmark";

const SEEN_KEY = "hp-mobile-splash-shown";

/**
 * Ask the service worker to re-fetch every cached game, while the splash covers
 * the wait.
 *
 * The splash is the one moment in the app that genuinely means "the player just
 * launched this": it is latched once per session and only ever runs on a real
 * phone. `PWA.tsx` polls `/games-version` every 30 seconds and forwards the
 * result, but a cold PWA launch serves whatever game HTML it already holds until
 * that first poll lands — which, on a school network, is precisely the half
 * minute the player is looking at it. `sw.js` has handled a `SYNC_NOW` message
 * since the sync work landed; nothing had ever sent one.
 *
 * This refreshes GAME HTML, not the catalogue listing. Which games appear on the
 * phone shell comes from the page's own HTML and is a `networkFirst` navigation,
 * so it is already fresh whenever there is a connection.
 *
 * Fire-and-forget and fully guarded: no service worker (dev, or a browser
 * without one) and no connection both mean this simply does nothing. It is never
 * awaited, so it cannot delay the splash it rides along with.
 */
function requestGameSync(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // `onLine === false` is a reliable negative; `true` only means "there is an
  // interface", so it is not worth trusting further. The refresh itself is
  // best-effort inside the worker either way.
  if (navigator.onLine === false) return;
  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage({ type: "SYNC_NOW" });
    })
    .catch(() => {
      /* no worker to talk to — nothing to refresh */
    });
}

/** Full-screen worlds where a launch splash would be noise, not a welcome. */
const SKIP_PREFIXES = ["/dashboard", "/play/signin", "/play/signout", "/play/auth"];

export function MobileSplash() {
  const isMobile = useDevicePlatform() === "mobile";
  const pathname = usePathname() ?? "/";
  const [phase, setPhase] = useState<"idle" | "showing" | "leaving">("idle");

  // The show-once latch is a REF, not the `phase` state, and that distinction is
  // load-bearing. `phase` cannot be a dependency of the effect that schedules the
  // dismiss timers: that effect calls `setPhase("showing")`, so listing `phase`
  // makes React tear the effect down and run its cleanup — clearing `toLeave` and
  // `toGone` — the instant it re-runs for the `idle → showing` change, before
  // either timer can fire. The splash then stays on "showing" forever (a spinner
  // that never fades). A ref carries "already triggered" across renders without
  // being a dependency, so entering "showing" can no longer cancel its own exit.
  const triggered = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (triggered.current || !isMobile) return;
    if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // sessionStorage can throw in locked-down/private modes — if we can't
      // remember we showed it, better to skip than to replay it every navigation.
      return;
    }
    triggered.current = true;
    // Behind the same once-per-session latch as the splash itself, so a player
    // tapping around the arcade does not re-trigger a catalogue-wide refetch.
    requestGameSync();
    // Showing on the render AFTER mount is the point, not an oversight: the
    // server/first-paint render must be splash-free (it is shared, prerendered and
    // in the SW precache), so the overlay can only appear once the effect has
    // confirmed a phone. Same deliberate second-paint pattern as the `?q=` seeding
    // in `Arcade.tsx`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("showing");
    // Deliberately no dep-change cleanup here: these timers are the exit path, and
    // clearing them on any re-run (a pathname change, a device flip) is exactly
    // what stranded the splash before. They're cleared only on real unmount, by
    // the effect below.
    timers.current.push(setTimeout(() => setPhase("leaving"), 700));
    timers.current.push(setTimeout(() => setPhase("idle"), 1050));
  }, [isMobile, pathname]);

  // Clear any pending timers on unmount only — never on a dependency change.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background transition-opacity duration-300 lg:hidden ${
        phase === "leaving" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Wordmark on top, spinner beneath it — the wheel reads as "loading this"
          rather than sitting above an unlabelled mark. */}
      <Wordmark size="text-3xl" dotClass="h-2 w-2" tag="mobile" />

      {/* The wheel: a brand arc on a faint track, spinning under motion-safe. */}
      <svg
        width="56"
        height="56"
        viewBox="0 0 50 50"
        className="motion-safe:animate-spin"
        style={{ animationDuration: "0.8s" }}
      >
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          className="text-brand/15"
        />
        <path
          d="M25 5a20 20 0 0 1 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          className="text-brand"
        />
      </svg>
    </div>
  );
}
