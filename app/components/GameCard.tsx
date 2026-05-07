import type { Game } from "../lib/games";

export function GameCard({
  game,
  onPlay,
  size = "md",
}: {
  game: Game;
  onPlay: (slug: string) => void;
  size?: "sm" | "md" | "lg";
}) {
  const aspect =
    size === "lg" ? "aspect-[16/10]" : "aspect-square";
  return (
    <button
      type="button"
      onClick={() => onPlay(game.slug)}
      className="card group flex flex-col text-left"
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
  );
}
