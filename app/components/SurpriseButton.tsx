"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { Game } from "../lib/games";
import { pickSurprise } from "../lib/surprise";

/**
 * Duration of the die tumble, in ms. MIRRORS the `.dice-rolling` animation in
 * `globals.css` — the navigation is held until the die settles, so if the two
 * drift the die either gets cut off mid-spin or the button sits dead after the
 * animation ends.
 */
const ROLL_MS = 420;

/**
 * "Surprise me" — jump to a random game's store page.
 *
 * Lives at the top of the sidebar nav, so it renders in BOTH the desktop rail
 * and the mobile drawer from one insertion (see `Sidebar`'s `navList`).
 *
 * THE PICK HAPPENS ON INTERACTION, never during render. Every page that mounts
 * this is statically prerendered, so a pick made while rendering would be baked
 * into the build output — one "random" game shared by every visitor until the
 * next deploy — and the client's independent pick would disagree with the server
 * HTML and trip a hydration mismatch. `pickSurprise` carries the same warning.
 *
 * It navigates to `/game/<slug>` rather than calling `useOpenGame` to launch the
 * player directly. Both are one line here; the store page wins because a random
 * game dropped straight into a fullscreen overlay gives the player no idea what
 * they got and no way to judge it before backing out.
 *
 * ARMING. On hover/focus the pick is made EARLY, stashed, and prefetched, so the
 * click navigates to an already-warm route. The stash is what makes the prefetch
 * honest: without it the click would re-roll and land somewhere the prefetch
 * never touched, making the warm-up pure waste. Touch devices never hover, so
 * they fall through to picking at click time and simply do not get the head
 * start — which is why the click path can never assume an armed pick exists.
 *
 * This is deliberately ONE route warmed on intent, not the catalogue-wide
 * prefetch the game cards opt out of with `prefetch={false}`.
 */
export function SurpriseButton({
  games,
  onNavigate,
}: {
  games: Game[];
  /** Closes the mobile drawer; omitted on desktop. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [rolling, setRolling] = useState(false);

  // Refs, not state: none of these are rendered, so keeping them in state would
  // buy a re-render per hover for no visible change.
  const lastPick = useRef<string | null>(null);
  const armed = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The re-entry guard, mirroring `rolling`.
   *
   * The state alone very nearly works — React flushes discrete click events
   * synchronously, so a second click does observe `rolling === true` from the
   * re-render. But that is a scheduling detail to be leaning on: if the update
   * were ever batched instead, every click in the batch would read the stale
   * `false`, set its own timer, and fire its own `router.push` — and the cleanup
   * below only tracks the LAST timer, so the extras could not even be cancelled.
   * A ref updates synchronously and makes the guard independent of all that.
   */
  const rollingRef = useRef(false);

  // The roll holds the navigation behind a timer, so an unmount mid-roll (the
  // mobile drawer closing, or a route change from elsewhere) would otherwise
  // fire a stray push and set state on a dead component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // `usePathname()` is already normalised and un-encoded, and
  // `skipTrailingSlashRedirect: true` means `/game/foo/` is a live URL too — so
  // match the prefix and strip any trailing slash rather than comparing paths.
  const current = pathname?.startsWith("/game/")
    ? pathname.slice("/game/".length).replace(/\/$/, "")
    : null;

  const roll = useCallback(
    () =>
      pickSurprise(
        games.map((g) => g.slug),
        { exclude: current, last: lastPick.current },
      ),
    [games, current],
  );

  /**
   * Pick early and warm the route, so the click navigates to cache.
   *
   * The pick STICKS until it is fired — there is deliberately no disarm on
   * pointer-leave. Clearing it would make every re-hover roll a fresh slug and
   * prefetch a fresh route, so idly waving the cursor over the sidebar would
   * download a different game's payload each pass. Holding it means at most one
   * prefetch per mount, and the player cannot observe which of the two moments
   * the die was rolled at anyway.
   */
  const arm = () => {
    if (rollingRef.current || armed.current) return;
    const slug = roll();
    if (!slug) return;
    armed.current = slug;
    router.prefetch(`/game/${slug}`);
  };

  const handleClick = () => {
    // Mashing the button must not queue N navigations behind N timers.
    if (rollingRef.current) return;

    const slug = armed.current ?? roll();
    // Only reachable with an empty catalogue, which would mean the whole page is
    // empty anyway. Bail rather than routing to `/game/undefined`.
    if (!slug) return;

    lastPick.current = slug;
    armed.current = null;
    posthog.capture("surprise_me_clicked", { game_slug: slug });

    const go = () => {
      onNavigate?.();
      router.push(`/game/${slug}`);
    };

    // Reduced motion gets the destination immediately. Holding the navigation
    // for an animation that was suppressed would be a pure 420ms stall — the
    // accessibility setting turned into a penalty.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Latched here too, so a double-click cannot push twice. Never unlatched,
      // for the same reason `rolling` is not: `go()` navigates and this unmounts.
      rollingRef.current = true;
      go();
      return;
    }

    rollingRef.current = true;
    setRolling(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      go();
      // Not reset to false: `go()` navigates and this unmounts. Clearing it here
      // would flash the die back to rest for a frame first.
    }, ROLL_MS);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerEnter={arm}
      onFocus={arm}
      aria-busy={rolling}
      title="Open a random game"
      className="group relative mb-2 flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-brand px-4 py-3 text-[15px] font-bold text-white shadow-lg shadow-brand/25 transition-[transform,box-shadow] duration-200 hover:shadow-xl hover:shadow-brand/30 active:scale-[0.97] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 lg:py-2.5"
      style={{
        // Echoes the featured banner's radial wash rather than the flat fill of
        // the header's "Sign in". Both were solid `bg-brand`, which read as two
        // competing primary actions; this keeps the brand colour but puts the
        // button in the site's "playful" language instead of its "account" one.
        backgroundImage:
          "radial-gradient(circle at 88% 15%, rgba(255,199,0,0.30), transparent 55%), radial-gradient(circle at 10% 95%, rgba(255,79,139,0.38), transparent 60%)",
        touchAction: "manipulation",
      }}
    >
      {/* Sheen that sweeps across on hover. Purely decorative and pointer-inert,
          so it can never eat the click. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-full w-1/2 skew-x-[-20deg] bg-white/20 transition-all duration-500 group-hover:left-[150%] motion-reduce:hidden"
      />

      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        // `dice-rolling` is the keyframe; the hover rotate is the resting
        // invitation. They are mutually exclusive — while rolling the hover
        // transform is dropped so the two cannot fight over `transform`.
        className={`relative shrink-0 ${
          rolling
            ? "dice-rolling"
            : "transition-transform duration-300 group-hover:rotate-90"
        }`}
      >
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8.5 8.5h.01M15.5 15.5h.01M12 12h.01" />
      </svg>

      <span className="relative flex-1 text-left">
        {rolling ? "Rolling…" : "Surprise me"}
      </span>

      {/* Arrow slides in on hover — the same "this navigates" cue the section
          headers use, and it fills the dead space on the right. */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="relative shrink-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-90 motion-reduce:transition-none"
      >
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  );
}
