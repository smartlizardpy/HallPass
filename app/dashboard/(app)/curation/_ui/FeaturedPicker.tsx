"use client";

/**
 * The homepage-hero picker for the Curation page.
 *
 * Split out as a client component for ONE reason: the catalogue is long enough
 * that a flat radio list of every game (the old design) made choosing the hero a
 * scroll-and-hunt. A live text filter (`usePathname`-free, pure local state)
 * narrows the list by title or category as you type, which the server layout
 * cannot do per-keystroke. Everything else — the single-select invariant, the
 * "clear the old featured" swap — still lives server-side in `setFeaturedAction`,
 * which this form posts to unchanged; the filter is purely a find aid and never
 * changes what is submitted (the selected radio does).
 *
 * The rows carry `defaultChecked` on the current holder so the form is correct
 * with JavaScript disabled too: without the filter you still get the same radio
 * list the old page rendered.
 */

import { useMemo, useState } from "react";
import { CoverImage } from "@/app/components/CoverImage";
import type { Game } from "@/app/lib/games";
import { setFeaturedAction } from "../actions";

/** The serializable slice of a game this picker needs. */
type PickerGame = Pick<
  Game,
  "slug" | "title" | "category" | "gradient" | "coverUrl" | "externalUrl" | "isFeatured"
>;

export function FeaturedPicker({ games }: { games: PickerGame[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        (g.category ?? "").toLowerCase().includes(q),
    );
  }, [games, query]);

  return (
    <form action={setFeaturedAction} className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter games by title or category…"
        aria-label="Filter games"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
      />

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted">
          No games match “{query}”.
        </p>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {filtered.map((game) => (
            <li key={game.slug}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <input
                  type="radio"
                  name="slug"
                  value={game.slug}
                  defaultChecked={Boolean(game.isFeatured)}
                  className="h-4 w-4 shrink-0 border-border text-brand focus:ring-brand/30"
                />
                <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded bg-surface-2">
                  <CoverImage game={game} initialClass="text-base" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-foreground">
                    {game.title}
                  </div>
                  <div className="truncate text-xs text-muted">{game.category}</div>
                </div>
                {game.isFeatured && (
                  <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand">
                    Current
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
      >
        Set featured
      </button>
    </form>
  );
}
