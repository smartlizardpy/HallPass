"use client";

import Link from "next/link";
import type { Game } from "../lib/games";
import { playsOn, useDevicePlatform } from "../lib/use-device-platform";
import { CoverImage } from "./CoverImage";

export function GameCard({
  game,
  onPlay,
  size = "md",
  isFavorite = false,
  onToggleFavorite,
}: {
  game: Game;
  /**
   * INSTANT PLAY, bypassing the store page. Wired to the hover ▶ only — a plain
   * card click now navigates to `/game/<slug>`, which is a real page with the
   * description, screenshots, leaderboard and comments on it.
   */
  onPlay: (slug: string) => void;
  size?: "sm" | "md" | "lg";
  isFavorite?: boolean;
  onToggleFavorite?: (slug: string) => void;
}) {
  const aspect =
    size === "lg" ? "aspect-[16/10]" : "aspect-square";

  // `null` before mount and for any untagged game, which is why this is a strict
  // `=== false` rather than a falsy check: unknown must render NO badge, and both
  // states are falsy. The badge names the platform the game DOES want, so it reads
  // as information ("this one is a desktop game") rather than as a refusal.
  const device = useDevicePlatform();
  const mismatch = device ? playsOn(game, device) === false : false;

  return (
    // Root is a DIV so the card link, the hover ▶ and the favorite heart are all
    // SIBLINGS — an interactive element is never nested inside another.
    <div className="card group relative flex flex-col text-left">
      {/* The whole card is one plain link to the store page. It used to
          preventDefault and open the player instead, which made the href
          decorative; now the navigation is the actual behaviour, so
          middle-click, open-in-new-tab and crawlers all agree with the click. */}
      <Link
        href={`/game/${game.slug}`}
        prefetch={false}
        className="flex flex-col text-left"
      >
        <div className={`relative overflow-hidden rounded-3xl bg-zinc-900 ${aspect}`}>
          {/* Cover art + its fallback chain live in CoverImage — `card-art` is
              what the globals.css hover-zoom hooks onto. */}
          <CoverImage game={game} className="card-art" />

          {/* badges overlay */}
          <div className="pointer-events-none absolute left-2 top-2 flex gap-1">
            {game.isNew && (
              <span className="rounded-full bg-accent-pink px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow-lg">
                New
              </span>
            )}
            {game.isFeatured && (
              <span className="rounded-full bg-accent-yellow px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-zinc-900 shadow-lg">
                ★ Hot
              </span>
            )}
            {/* Deliberately muted, and deliberately still here: a game that does
                not suit this device is sorted down and labelled, never removed.
                The card keeps its link, so the catalogue a crawler sees is the
                same catalogue on every device. */}
            {mismatch && (
              <span className="rounded-full bg-zinc-900/80 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow-lg">
                {game.platform === "mobile" ? "Mobile" : "Desktop"}
              </span>
            )}
          </div>
        </div>

        {/* meta */}
        <div className="px-1 pt-2.5">
          <h3 className="truncate text-[14px] font-extrabold leading-tight text-zinc-900 group-hover:text-brand">
            {game.title}
          </h3>
          <p className="mt-0.5 truncate text-[12px] font-semibold text-muted">
            {game.category}
          </p>
        </div>
      </Link>

      {/* Hover ▶ — instant play, skipping the store page.

          It is a real <button> and a SIBLING of the card link, not a span inside
          it: a nested button would be invalid HTML and unreachable by keyboard.
          The wrapper is anchored `inset-x-0 top-0` with the SAME aspect ratio as
          the cover, so it overlays the artwork exactly without having to know the
          meta strip's height. Only the button itself takes pointer events, so the
          rest of the artwork still belongs to the card link.

          `group-focus-within` alongside `group-hover` is what makes it reachable
          by keyboard at all — previously the ▶ was `pointer-events-none` and
          purely decorative, so there was no keyboard path to instant play.

          `hidden [@media(hover:hover)]:flex` — NOT `opacity-0` — is what keeps it
          off touch devices, and the distinction is load-bearing. `opacity: 0`
          does not remove an element from hit testing, so an opacity-hidden button
          with `pointer-events-auto` would sit invisible but tappable dead centre
          over the artwork: on a phone, tapping the middle of any card would
          instant-play instead of opening the store page, silently defeating this
          whole change on the majority of traffic. `display: none` genuinely
          removes it. On touch, tapping the card goes to the store page — the
          behaviour Poki and Roblox both use. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 hidden items-center justify-center rounded-3xl bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/20 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:flex ${aspect}`}
      >
        <button
          type="button"
          aria-label={`Play ${game.title} now`}
          title={`Play ${game.title} now`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay(game.slug);
          }}
          style={{ touchAction: "manipulation" }}
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-brand shadow-2xl ring-4 ring-white/30 transition hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 14 14"
            fill="currentColor"
            className="pointer-events-none"
          >
            <path d="M3 1.5v11l10-5.5z" />
          </svg>
        </button>
      </div>

      {/* Favorite heart — sibling of the play button, top-RIGHT (badges stay
          top-left). Only rendered when a handler is supplied, so cards without
          personalization render exactly as before. Always visible (not
          hover-only) so it stays tappable on touch.

          Styling: a SELF-CONTAINED chip that reads as a full circle on ANY
          background. The disc is the SAME in both states — a near-OPAQUE dark
          fill (`bg-zinc-900/90`) with a hairline light ring (`ring-white/30`) and
          a soft drop shadow. Opaque (not translucent) is deliberate: nothing —
          not the cover art, not the light page-background peeking through the
          cover's rounded corner — can ever show THROUGH the disc and make it look
          bitten/cut off. The dark fill separates it from light covers; the white
          ring + shadow separate it from dark covers. The disc never relies on the
          artwork to be visible. Only the
          heart changes between states — white outline (idle) vs vivid pink FILLED
          (active) — so a favorited card is obvious at a glance. The chip pops on
          press.

          Position: the cover's top-right corner is rounded at 24px (`rounded-3xl`)
          and the disc is 36px — larger than the corner radius — so the disc is
          seated CONCENTRIC with the corner arc (`right-1.5 top-1.5` = 6px inset →
          disc centre = 6 + 18 = 24px from each edge = the arc centre). That nests
          the disc into the corner with a UNIFORM ~6px gap to the rounded edge all
          the way around, instead of the cramped 3px-at-the-corner / 8px-at-the-
          edges margin that made the heart look cut off by the corner. */}
      {onToggleFavorite && (
        <button
          type="button"
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite(game.slug);
          }}
          className={`absolute right-1.5 top-1.5 z-10 grid h-9 w-9 place-items-center rounded-full bg-zinc-900/90 ring-1 ring-white/30 shadow-[0_2px_8px_rgba(0,0,0,0.5)] backdrop-blur-md transition-all duration-150 hover:scale-105 hover:bg-zinc-900 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 ${
            isFavorite ? "text-accent-pink" : "text-white"
          }`}
          style={{ touchAction: "manipulation" }}
        >
          {/* Clean, single-path heart, perfectly centred in its 0 0 24 24 box
              (bbox x:2–22, y:3–21 → centre 12,12) so it never sits off-centre or
              clips against the SVG viewport. Idle = white outline, active = pink
              fill. */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={isFavorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={isFavorite ? 0 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </button>
      )}
    </div>
  );
}
