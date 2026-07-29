"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";
import posthog from "posthog-js";
import type { Game } from "../lib/games";
import { pickSurprise } from "../lib/surprise";

/**
 * "Surprise me" — jump to a random game's store page.
 *
 * Lives at the top of the sidebar nav, so it renders in BOTH the desktop rail
 * and the mobile drawer from one insertion (see `Sidebar`'s `navList`).
 *
 * THE PICK HAPPENS IN THE CLICK HANDLER, never during render. Every page that
 * mounts this is statically prerendered, so a pick made while rendering would be
 * baked into the build output — one "random" game shared by every visitor until
 * the next deploy — and the client's independent pick would disagree with the
 * server HTML and trip a hydration mismatch. `pickSurprise` carries the same
 * warning at its definition.
 *
 * It navigates to `/game/<slug>` rather than calling `useOpenGame` to launch the
 * player directly. Both are one line here; the store page wins because a random
 * game dropped straight into a fullscreen overlay gives the player no idea what
 * they got and no way to judge it before backing out. The store page shows the
 * art, the tagline and the Play button — the same destination a card click
 * reaches, so the surprise is a shortcut through the catalogue rather than a
 * separate mode.
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
  // A ref, not state: the previous pick only ever feeds the NEXT click and
  // nothing renders from it, so storing it in state would buy a re-render per
  // press for no visible change.
  const lastPick = useRef<string | null>(null);

  // `usePathname()` is already normalised and un-encoded, and `skipTrailing
  // SlashRedirect: true` means `/game/foo/` is a live URL too — so match the
  // prefix and strip any trailing slash rather than comparing the whole path.
  const current = pathname?.startsWith("/game/")
    ? pathname.slice("/game/".length).replace(/\/$/, "")
    : null;

  const handleClick = () => {
    const slug = pickSurprise(
      games.map((g) => g.slug),
      { exclude: current, last: lastPick.current },
    );
    // Only reachable with an empty catalogue, which would mean the whole page is
    // empty anyway. Bail rather than routing to `/game/undefined`.
    if (!slug) return;

    lastPick.current = slug;
    posthog.capture("surprise_me_clicked", { game_slug: slug });
    onNavigate?.();
    router.push(`/game/${slug}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group mb-2 flex w-full items-center gap-3 rounded-2xl bg-brand px-4 py-3 text-[15px] font-bold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-600 active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 lg:py-2.5"
      style={{ touchAction: "manipulation" }}
    >
      {/* A die, rotating a quarter-turn on hover — the one bit of motion in the
          rail, and it reads as "roll" without needing a label change. */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 transition-transform duration-300 group-hover:rotate-90"
      >
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8.5 8.5h.01M15.5 15.5h.01M12 12h.01" />
      </svg>
      <span className="flex-1 text-left">Surprise me</span>
    </button>
  );
}
