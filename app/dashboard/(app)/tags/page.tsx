/**
 * HallPass dashboard — GLOBAL "Tags & genres" manager.
 *
 * The catalogue-wide counterpart to per-game editing: fix a mislabelled TAG or
 * GENRE once and have it apply to every game that carries it. Tags drive arcade
 * search; genres (categories) drive the homepage category rows — so this screen
 * curates the main page in bulk.
 *
 * Two panels, both reading the resolved (override-applied) catalogue via
 * {@link resolveTags} / {@link resolveGenres} (fetched in parallel) so the counts
 * shown are exactly what the public site renders:
 *   - TAGS: each tag + its game count, an inline rename/merge form (renaming onto
 *     an existing tag MERGES them) and a separate danger Delete form that strips
 *     the tag from every game.
 *   - GENRES: each genre + count with a rename/merge form. A genre can't be
 *     blank, so there is deliberately no delete.
 *
 * Gated with `requireRole("admin")`. `?ok`/`?error` banners are read from the
 * async `searchParams`.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { resolveGenres, resolveTags } from "@/app/lib/games-store";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { deleteTagAction, renameGenreAction, renameTagAction } from "./actions";

export const metadata: Metadata = {
  title: "Tags & genres",
  description: "Fix a mislabelled tag or genre across the whole catalogue.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ ok?: string | string[]; error?: string | string[] }>;

/** First value of a possibly-repeated query param, or `null`. */
function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/** A small "× games" count pill shown beside each tag/genre name. */
function CountPill({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-muted">
      {count} {count === 1 ? "game" : "games"}
    </span>
  );
}

export default async function TagsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const [tags, genres] = await Promise.all([resolveTags(), resolveGenres()]);
  const sp = await searchParams;
  const ok = asString(sp.ok);
  const error = asString(sp.error);

  return (
    <div className="space-y-6">
      <DashHeader
        title="Tags & genres"
        subtitle="Fix a mislabelled tag or genre across every game at once."
      />

      {ok && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* TAGS */}
      <Section
        title="Tags"
        subtitle={`${tags.length} ${tags.length === 1 ? "tag" : "tags"}`}
      >
        <p className="mb-4 text-sm text-muted">
          Tags power arcade search. Edit a tag and press{" "}
          <span className="font-semibold text-foreground">Rename / merge</span> to
          rewrite it on every game — renaming onto an{" "}
          <span className="font-semibold text-foreground">existing</span> tag{" "}
          <span className="font-semibold text-foreground">merges</span> the two.{" "}
          <span className="font-semibold text-foreground">Delete</span> strips the
          tag from all games.
        </p>

        {tags.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted">
            No tags in the catalogue yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {tags.map(({ tag, count }) => (
              <li
                key={tag}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm font-bold text-foreground">
                    {tag}
                  </span>
                  <CountPill count={count} />
                </div>
                <div className="flex items-center gap-2">
                  <form
                    action={renameTagAction}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="from" value={tag} />
                    <label className="sr-only" htmlFor={`tag-${tag}`}>
                      New name for {tag}
                    </label>
                    <input
                      id={`tag-${tag}`}
                      name="to"
                      defaultValue={tag}
                      autoComplete="off"
                      className="w-40 rounded-lg border border-border px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-full bg-brand px-4 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
                    >
                      Rename / merge
                    </button>
                  </form>
                  <form action={deleteTagAction}>
                    <input type="hidden" name="from" value={tag} />
                    <button
                      type="submit"
                      className="rounded-full border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* GENRES */}
      <Section
        title="Genres"
        subtitle={`${genres.length} ${genres.length === 1 ? "genre" : "genres"}`}
      >
        <p className="mb-4 text-sm text-muted">
          Genres are the homepage category rows. Renaming onto an{" "}
          <span className="font-semibold text-foreground">existing</span> genre{" "}
          <span className="font-semibold text-foreground">merges</span> its games
          in. A genre can&rsquo;t be empty, so there&rsquo;s no delete — every game
          belongs to exactly one.
        </p>

        {genres.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted">
            No genres in the catalogue yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {genres.map(({ name, count }) => (
              <li
                key={name}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm font-bold text-foreground">
                    {name}
                  </span>
                  <CountPill count={count} />
                </div>
                <form action={renameGenreAction} className="flex items-center gap-2">
                  <input type="hidden" name="from" value={name} />
                  <label className="sr-only" htmlFor={`genre-${name}`}>
                    New name for {name}
                  </label>
                  <input
                    id={`genre-${name}`}
                    name="to"
                    defaultValue={name}
                    autoComplete="off"
                    className="w-40 rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-full bg-brand px-4 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
                  >
                    Rename / merge
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
