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
 * THE SPLASH DOES NOT TRIGGER A GAME SYNC, AND MUST NOT.
 *
 * It used to post `SYNC_NOW` to the service worker here, on the reasoning that a
 * cold PWA launch serves stale game HTML until `PWA.tsx`'s poll lands "thirty
 * seconds later". That reasoning was simply wrong. `PWA.tsx` calls `poll()`
 * immediately after `await navigator.serviceWorker.ready`, and its `30_000`
 * check is a re-poll THROTTLE measured from `lastPolledAt`, which starts at 0 —
 * so the first poll always fires at once. There was never a gap to cover.
 *
 * The cost of getting that wrong was real. `SYNC_NOW` runs `refreshAllGameHtml()`
 * unconditionally, re-fetching every precached `/game-html/` document AND every
 * runtime entry (which is where bundle assets live) with `cache: "no-store"` —
 * a catalogue-wide download burst on exactly the school network the feature was
 * supposed to help. Worse, on a genuine version change the splash's sync and the
 * poll's `CHECK_GAMES_VERSION` both reach `refreshAllGameHtml()` concurrently.
 *
 * `CHECK_GAMES_VERSION` is the message that already does this correctly: it
 * compares against the stored sentinel and no-ops when nothing moved. `PWA.tsx`
 * owns sending it. Anything added here would be a second sender racing the first.
 */

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
