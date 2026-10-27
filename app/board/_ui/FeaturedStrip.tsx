"use client";

import type { CSSProperties } from "react";
import { CoverImage } from "@/app/components/CoverImage";
import { copy } from "@/app/lib/boardpass/copy";
import type { Game } from "@/app/lib/games";

/**
 * The compact featured strip. It is deliberately short (capped in board.css) so
 * the first row of real game art stays visible below it at 1080p. The game is the
 * one an editor flagged `isFeatured` — nothing here is inferred from plays.
 */
export function FeaturedStrip({ game, onPlay, disabled }: { game: Game; onPlay: (g: Game) => void; disabled?: boolean }) {
  const style = { "--bp-g0": game.gradient[0], "--bp-g1": game.gradient[1] } as CSSProperties;
  return (
    <section className="bp-featured" style={style} aria-label={copy.featured}>
      <div className="flex min-w-0 flex-col justify-center">
        <span className="bp-eyebrow">{copy.featured}</span>
        <h2>{game.title}</h2>
        <p className="line-clamp-2">{game.tagline || game.description}</p>
        <div className="mt-3">
          <button type="button" className="bp-btn bp-btn-primary bp-btn-lg" disabled={disabled} onClick={() => onPlay(game)} aria-label={copy.playGame(game.title)}>
            ▶ {copy.play}
          </button>
        </div>
      </div>
      <div className="bp-featured-art" aria-hidden>
        <CoverImage game={game} loading="eager" fetchPriority="high" initialClass="text-7xl" />
      </div>
    </section>
  );
}
