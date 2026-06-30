import type { Game } from "../lib/games";

export function GameCard({
  game,
  onPlay,
  size = "md",
  isFavorite = false,
  onToggleFavorite,
}: {
  game: Game;
  onPlay: (slug: string) => void;
  size?: "sm" | "md" | "lg";
  isFavorite?: boolean;
  onToggleFavorite?: (slug: string) => void;
}) {
  const aspect =
    size === "lg" ? "aspect-[16/10]" : "aspect-square";
  return (
    // Root is a DIV (not a button): the full-card play control and the favorite
    // heart are SIBLING buttons, so we never nest a button inside a button
    // (invalid HTML + breaks keyboard/AT activation).
    <div className="card group relative flex flex-col text-left">
      <button
        type="button"
        onClick={() => onPlay(game.slug)}
        className="flex flex-col text-left"
      >
        <div className={`relative overflow-hidden rounded-3xl bg-zinc-900 ${aspect}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/games/${game.slug}/cover.png`}
            alt={game.title}
            className="card-art absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />

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
          </div>

          {/* hover play button */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/20 group-hover:opacity-100">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-brand shadow-2xl ring-4 ring-white/30">
              <svg width="18" height="18" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 1.5v11l10-5.5z" />
              </svg>
            </span>
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
      </button>

      {/* Favorite heart — sibling of the play button, top-RIGHT (badges stay
          top-left). Only rendered when a handler is supplied, so cards without
          personalization render exactly as before. Always visible (not
          hover-only) so it stays tappable on touch.

          Styling: a dark frosted-glass disc rather than a solid white circle, so
          it reads on ANY cover art (light or dark) and recedes into the artwork
          instead of sitting on top of it. Idle = white outline heart on the glass;
          active = vivid pink FILLED heart on a bright white disc so a favorited
          card is obvious at a glance. A single SVG morphs between the two states
          (fill/stroke toggle) and the button pops on press. */}
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
          className={`absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-full shadow-md backdrop-blur-md transition-all duration-150 hover:scale-105 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 ${
            isFavorite
              ? "bg-white text-accent-pink"
              : "bg-black/30 text-white hover:bg-black/55"
          }`}
          style={{ touchAction: "manipulation" }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill={isFavorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={isFavorite ? 0 : 2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
          >
            <path d="M12 21s-6.7-4.3-9.3-8.2C.9 10.1 1.6 6.5 4.6 5.3c2-.8 4 .1 5 1.7 1-1.6 3-2.5 5-1.7 3 1.2 3.7 4.8 1.9 7.5C18.7 16.7 12 21 12 21z" />
          </svg>
        </button>
      )}
    </div>
  );
}
