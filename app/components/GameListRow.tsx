"use client";

import Link from "next/link";
import type { Game } from "../lib/games";
import { playsOn, useDevicePlatform } from "../lib/use-device-platform";
import { CoverImage } from "./CoverImage";

/**
 * One game as a ROW, for the catalogue's list layout.
 *
 * ── WHY NOT A `size` PROP ON `GameCard` ────────────────────────────────────
 * A card is a picture with a caption under it; a row is a line of facts with a
 * thumbnail at the front. They share no layout at all, and the two pieces of
 * `GameCard` that are genuinely delicate — the 56px hover ▶ that must be
 * `display:none` rather than transparent on touch, and the 36px heart seated
 * concentric with the cover's 24px corner arc — are both solutions to problems a
 * row does not have. Threading a mode through that component would put both of
 * those behind an `if` and make every future change to either layout a change to
 * the other. So: a separate component, and the shared things (`CoverImage`, the
 * play guard, the favourites hook, `MIN_PLAYS_SHOWN`) are shared as modules.
 *
 * ── WHAT THE ROW SAYS THAT A CARD CANNOT ───────────────────────────────────
 * The list is not a denser grid, it is a more INFORMATIVE one: a card has room
 * for a title and a category, and the row adds the tagline and a play button that
 * is always there rather than only on hover. That is the reason to offer the
 * layout at all, and it is why the row is worth ~72px of height rather than being
 * squeezed to a bare title.
 *
 * ── THE WHOLE ROW IS THE LINK ──────────────────────────────────────────────
 * The title is a real `<Link>` whose `::after` is stretched over the row, so the
 * accessible name is the title (not "link") while the click target is the whole
 * row. The two buttons are SIBLINGS of it and sit on `z-10`, which is what keeps
 * them above that stretched layer and keeps an interactive element from ever
 * being nested inside another.
 */
export function GameListRow({
  game,
  onPlay,
  isFavorite = false,
  onToggleFavorite,
}: {
  game: Game;
  onPlay: (slug: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (slug: string) => void;
}) {
  // `null` before mount and for any untagged game — a strict `=== false`, since
  // unknown must render no badge and both states are falsy. Same rule as the card.
  const device = useDevicePlatform();
  const mismatch = device ? playsOn(game, device) === false : false;

  return (
    <li className="group relative flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-surface-2">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-900 sm:h-16 sm:w-16">
        <CoverImage game={game} initialClass="text-xl" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/game/${game.slug}`}
            prefetch={false}
            className="truncate text-[15px] font-extrabold text-foreground transition group-hover:text-brand after:absolute after:inset-0"
          >
            {game.title}
          </Link>
          {/* Same three badges the card carries, and the same tokens — including
              `--accent-pink-ink` rather than `--accent-pink` for "New", which is
              the only one of the three that carries text at a contrast the
              brighter pink fails. See `GameCard` for the measurements. */}
          {game.isNew && (
            <span className="shrink-0 rounded-full bg-accent-pink-ink px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
              New
            </span>
          )}
          {game.isFeatured && (
            <span className="shrink-0 rounded-full bg-accent-yellow px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-zinc-900">
              ★ Hot
            </span>
          )}
          {mismatch && (
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-muted">
              {game.platform === "mobile" ? "Mobile" : "Desktop"}
            </span>
          )}
        </div>
        <p className="truncate text-[13px] font-semibold text-muted">
          {game.tagline}
        </p>
      </div>

      {/* Shown only where there is room for it, and dropped rather than stacked
          on the narrow end of the layout.

          THERE IS NO PLAY-COUNT COLUMN, and the reason is worth keeping: this
          site does not print a play count below `MIN_PLAYS_SHOWN` (50), and no
          game has cleared 50 plays in a 30-day window — the busiest was 30 when
          this was written. A column that is empty on every row for every visitor
          is worse than no column, so the row says the things it can actually
          fill in. If the arcade grows into that threshold, this is where the
          count goes. */}
      <span className="hidden w-32 shrink-0 truncate text-[13px] font-bold text-muted lg:block">
        {game.category}
      </span>
      {onToggleFavorite && (
        <button
          type="button"
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => onToggleFavorite(game.slug)}
          className={`tap-44 relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-surface active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
            isFavorite ? "text-accent-pink" : "text-muted"
          }`}
          style={{ touchAction: "manipulation" }}
        >
          {/* The card's heart needs an opaque disc because it sits ON cover art;
              here it sits on the page background, so the disc would be chrome
              for no reason. Same path, same two states. */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={isFavorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={isFavorite ? 0 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </button>
      )}

      {/* Always visible, unlike the card's hover ▶: a row has the width for a
          real button, and a control that only appears on hover would be a
          control a touch device never gets. */}
      <button
        type="button"
        aria-label={`Play ${game.title} now`}
        onClick={() => onPlay(game.slug)}
        style={{ touchAction: "manipulation" }}
        className="relative z-10 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[13px] font-extrabold text-white transition hover:bg-brand-600 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="currentColor"
          className="pointer-events-none"
          aria-hidden="true"
        >
          <path d="M3 1.5v11l10-5.5z" />
        </svg>
        Play
      </button>
    </li>
  );
}
