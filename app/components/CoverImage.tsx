import type { Game } from "../lib/games";

/**
 * A game's cover art, with its fallback chain in ONE place.
 *
 * The chain was previously copy-pasted between `GameCard` and `Arcade`'s
 * `FeaturedBanner`, and the two dashboard surfaces skipped it entirely — both
 * hardcode `/games/<slug>/cover.png`, which does not exist for an external
 * (off-site) game, so those grids render a broken image for exactly the games
 * that are hardest to eyeball. Extracting it fixes that as a side effect and
 * gives future surfaces (the store page hero, the media panel) one thing to call.
 *
 * The chain, in order:
 *   1. `coverUrl` — an absolute URL, set for external games or as an override.
 *   2. `/games/<slug>/cover.png` — the committed convention for native games.
 *   3. A CSS gradient built from the game's own two stops, with the title's
 *      initial centred. Used only when a game has NEITHER, which today means an
 *      external game whose auto-screenshot failed. It is a real element rather
 *      than a broken <img>, so it never shows a torn-image icon.
 *
 * Native games always have (2) committed alongside their bundle, so the gradient
 * branch is keyed on `externalUrl && !coverUrl` rather than on a load error —
 * there is no reliable, synchronous way to know an <img> will 404 before it does,
 * and an `onError` swap would need this to be a client component.
 *
 * RENDERS ABSOLUTELY. The caller supplies a positioned, sized, overflow-hidden
 * box; this fills it. That keeps sizing decisions (aspect ratio, radius,
 * placeholder background) with the surface that owns them, and avoids the class
 * collisions that come from merging caller sizing into the <img> itself.
 */
export function CoverImage({
  game,
  className = "",
  initialClass = "text-4xl",
  loading = "lazy",
  fetchPriority,
}: {
  game: Pick<Game, "slug" | "title" | "gradient" | "coverUrl" | "externalUrl">;
  /** Extra classes for the filling element — e.g. `card-art` for the hover zoom. */
  className?: string;
  /** Type scale of the fallback initial; scale it up for hero-sized boxes. */
  initialClass?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
}) {
  if (game.externalUrl && !game.coverUrl) {
    return (
      <div
        className={`absolute inset-0 flex items-center justify-center ${className}`}
        style={{
          backgroundImage: `linear-gradient(135deg, ${game.gradient[0]}, ${game.gradient[1]})`,
        }}
        // Decorative: the title is always rendered as real text next to this.
        aria-hidden
      >
        <span
          className={`${initialClass} font-black text-white/90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]`}
        >
          {game.title.charAt(0)}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={game.coverUrl ?? `/games/${game.slug}/cover.png`}
      alt=""
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
      // Decorative in every current surface — the title is adjacent real text,
      // so an alt would be read out twice. Surfaces that show the cover WITHOUT
      // a visible title must pass their own labelling.
      aria-hidden
    />
  );
}
