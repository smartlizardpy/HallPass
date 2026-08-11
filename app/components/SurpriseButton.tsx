"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import posthog from "posthog-js";
import type { Game } from "../lib/games";
import { pickSurprise } from "../lib/surprise";

/**
 * "Surprise me" — jump to a random game's store page.
 *
 * ONE SHAPE, ONE HOME: the compact round die in `SiteHeader`'s control cluster,
 * desktop only (the header's `isMobile` branch spells out why a phone does not
 * get one). It is a PEER of `StreakChip` / `WhatsNewLink` / `AccountMenu`, not a
 * primary action, so it deliberately has no gradient, shadow or sheen and wears
 * the same `h-11 w-11` / `rounded-full` / `bg-surface-2` metrics as the header's
 * other icon buttons.
 *
 * It used to have a second shape as well — a full-width gradient button built to
 * be the loudest thing in the sidebar rail, selected by a `variant` prop. When
 * navigation moved out of the rail and into the top bar that branch lost its last
 * caller, so it is gone, and so is everything that existed only to serve it (see
 * NAVIGATES ON THE CLICK).
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
 * NAVIGATES ON THE CLICK, with nothing in between. The die used to tumble for
 * 420ms before routing. That was a RAIL affordance: a full-width button whose
 * label flipped to "Rolling…" filled the wait with something legible to read. A
 * 20px glyph spinning in the corner of the top bar has no label to flip, so the
 * same hold just reads as lag on a site whose entire pitch is getting into a game
 * fast. The wait is gone, and with it the timer and its unmount cleanup, the
 * `rolling` state, the `.dice-rolling` keyframe in `globals.css`, the `aria-busy`
 * flag, the `role="status"` live region that announced the wait, and the
 * `prefers-reduced-motion` short-circuit whose only job was to skip the hold.
 * Nothing is left to reflect or announce: the next thing that happens after the
 * press is the page changing, which announces itself.
 *
 * ARMING. On hover/focus the pick is made EARLY, stashed, and prefetched, so the
 * click navigates to an already-warm route. The stash is what makes the prefetch
 * honest: without it the click would re-roll and land somewhere the prefetch
 * never touched, making the warm-up pure waste. Touch devices never hover, so
 * they fall through to picking at click time and simply do not get the head
 * start — which is why the click path can never assume an armed pick exists.
 * With the roll gone this is the whole latency story, not a bonus on top of it.
 *
 * This is deliberately ONE route warmed on intent, not the catalogue-wide
 * prefetch the game cards opt out of with `prefetch={false}`.
 */
export function SurpriseButton({ games }: { games: Game[] }) {
  const router = useRouter();
  const pathname = usePathname();

  // Refs, not state: neither is rendered, so keeping them in state would buy a
  // re-render per hover for no visible change.
  const lastPick = useRef<string | null>(null);
  const armed = useRef<string | null>(null);
  /**
   * The one-shot navigation guard, latched the moment a click commits to a slug.
   *
   * It is NOT here to stop N mashes queueing N timers — there is no timer any
   * more. `router.push` is asynchronous even with nothing delaying it, so two
   * clicks landing in the same tick would BOTH get past an unguarded handler,
   * each pick its own game and each push it — a press that visibly goes
   * somewhere other than where the first click sent you.
   *
   * A REF, NOT STATE, and that is the load-bearing part. A ref updates
   * synchronously, so the second click reads exactly what the first one wrote,
   * whatever React does with the render. State would work only for as long as
   * React keeps flushing discrete click events synchronously; batched, every
   * click in the batch would read the stale `false` and the guard would be no
   * guard at all.
   *
   * Never reset to false, and that is safe because the push takes the whole
   * component with it. `SiteHeader` is rendered by `ArcadeShell` INSIDE each page
   * (`app/page.tsx`, `app/game/[slug]/page.tsx`), not by the root layout, so a
   * client-side route change tears this instance down and mounts a fresh button
   * with a fresh guard. Checked in a browser rather than reasoned about: six
   * consecutive presses each navigated, every one a soft transition, and the die
   * in the DOM afterwards was a NEW element each time. That includes
   * `/game/a` → `/game/b`, the case where a shared route pattern could plausibly
   * have kept the old instance — and its guard — alive.
   */
  const navigatingRef = useRef(false);

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
   * prefetch a fresh route, so idly waving the cursor over the header would
   * download a different game's payload each pass. Holding it means at most one
   * prefetch per mount, and the player cannot observe which of the two moments
   * the die was rolled at anyway.
   */
  const arm = () => {
    if (navigatingRef.current || armed.current) return;
    const slug = roll();
    if (!slug) return;
    armed.current = slug;
    router.prefetch(`/game/${slug}`);
  };

  const handleClick = () => {
    if (navigatingRef.current) return;

    const slug = armed.current ?? roll();
    // Only reachable with an empty catalogue, which would mean the whole page is
    // empty anyway. Bail rather than routing to `/game/undefined` — and bail
    // BEFORE latching, so a button that could not pick is not left dead.
    if (!slug) return;

    navigatingRef.current = true;
    lastPick.current = slug;
    armed.current = null;
    posthog.capture("surprise_me_clicked", { game_slug: slug });
    router.push(`/game/${slug}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerEnter={arm}
      onFocus={arm}
      // The accessible name, because there is no visible text to derive one
      // from. It says "Surprise me" rather than echoing the tooltip: that is the
      // name the control is known by everywhere else on the site, and the tooltip
      // is left to describe what pressing it does. `title` is not the accessible
      // name here (the `aria-label` wins) but it is still the hover tooltip,
      // which is the only way a sighted mouse user learns what a lone die does.
      aria-label="Surprise me"
      title="Open a random game"
      // Sized as one of the header's icon buttons — the same h-11 w-11,
      // rounded-full, `bg-surface-2`, hover-to-brand as the hamburger next to the
      // wordmark. In the top bar this is one of four controls, and shouting would
      // only move the competition with the featured banner into the chrome.
      //
      // `text-zinc-800`, not `--muted`: the header docblock's rule is that text
      // on `--surface-2` may not use `--muted` (4.45:1, under AA) while icons
      // may. A lone die IS an icon and would clear the 3:1 non-text floor on
      // `--muted` — but every sibling control in the cluster is zinc-800/700, and
      // being a peer of them is the entire point of this control.
      //
      // No `focus:outline-none` + custom ring either. The header controls all
      // rely on the UA focus ring; overriding it here alone would make this the
      // one control in the row that focuses differently.
      className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-zinc-800 transition hover:text-brand"
      style={{ touchAction: "manipulation" }}
    >
      {/* The die. The rotate is a RESTING affordance — the invitation to press,
          not a reaction to having pressed — so it survived the removal of the
          tumble. It needs `group` on the button above. */}
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
        className="shrink-0 transition-transform duration-300 group-hover:rotate-90"
      >
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8.5 8.5h.01M15.5 15.5h.01M12 12h.01" />
      </svg>
    </button>
  );
}
