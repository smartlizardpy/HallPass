"use client";

import { CoverImage } from "@/app/components/CoverImage";
import { copy } from "@/app/lib/boardpass/copy";
import type { Game } from "@/app/lib/games";

/**
 * One tile in the board library: real cover art (the existing `CoverImage`
 * fallback chain — committed cover, override, or the game's own gradient with its
 * initial), a title strip, and badges that come only from catalogue metadata.
 * The whole card is a single button so the target is the card, not a corner of it.
 */
export function GameCard({
  game,
  onPlay,
  disabled,
  eager = false,
}: {
  game: Game;
  onPlay: (game: Game) => void;
  disabled?: boolean;
  /** The first row loads eagerly so it is painted without a scroll. */
  eager?: boolean;
}) {
  const badges: { kind: string; label: string }[] = [];
  if (game.isNew) badges.push({ kind: "new", label: copy.badgeNew });
  if (game.multiplayer) badges.push({ kind: "multi", label: copy.badgeMultiplayer });
  // A board is a desktop-class screen, so "desktop only" is not worth a badge.
  if (game.platform === "mobile") badges.push({ kind: "platform", label: copy.badgeMobile });

  return (
    <button type="button" className="bp-game" disabled={disabled} onClick={() => onPlay(game)} aria-label={copy.playGame(game.title)}>
      <span className="bp-game-art block">
        <CoverImage game={game} loading={eager ? "eager" : "lazy"} initialClass="text-6xl" />
        {badges.length > 0 && (
          <span className="bp-badges" aria-hidden>
            {badges.map((b) => (
              <span key={b.kind + b.label} className="bp-badge" data-kind={b.kind}>
                {b.label}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="bp-game-text block">
        <span className="bp-game-title block">{game.title}</span>
        <span className="bp-game-meta block">
          {game.category}
          {game.tagline ? ` · ${game.tagline}` : ""}
        </span>
      </span>
    </button>
  );
}
