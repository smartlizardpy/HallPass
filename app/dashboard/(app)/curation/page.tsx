/**
 * HallPass dashboard — CATALOGUE CURATION.
 *
 * The single catalogue-wide control surface for how the public arcade presents
 * itself. It folds together what used to be two sidebar tabs — "Curation" and
 * "Tags & genres" — because both are cross-catalogue levers (they change the
 * homepage and search in bulk, not one game in isolation), and per-game tag /
 * genre edits already live on each game's own control center.
 *
 * Four panels, every read off the RESOLVED (override-applied) catalogue so the
 * state shown is exactly what the public site renders:
 *   - FEATURED GAME: the single homepage hero, shown as a prominent current-pick
 *     card above a filterable radio picker ({@link FeaturedPicker}) posting to
 *     `setFeaturedAction`; only one game is ever featured, so the swap is atomic.
 *   - NEW GAMES: every game with its own inline `toggleNewAction` form.
 *   - TAGS: bulk rename/merge/delete of a tag across every game (search levers).
 *   - GENRES: bulk rename/merge of a genre across every game (homepage rows).
 *
 * Gated with `requireRole("admin")`. Every read fails soft to the static
 * catalogue on a Neon outage, so the page renders regardless. `?ok`/`?error`
 * banners are read from the async `searchParams`.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { resolveGames } from "@/app/lib/games-store";
import { CoverImage } from "@/app/components/CoverImage";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { toggleNewAction } from "./actions";
import { FeaturedPicker } from "./_ui/FeaturedPicker";

export const metadata: Metadata = {
  title: "Curation",
  description: "Control the arcade homepage, New badges, and catalogue-wide tags & genres.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ ok?: string | string[]; error?: string | string[] }>;

/** First value of a possibly-repeated query param, or `null`. */
function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

export default async function CurationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const games = await resolveGames();
  const sp = await searchParams;
  const ok = asString(sp.ok);
  const error = asString(sp.error);

  const featured = games.find((g) => g.isFeatured);

  return (
    <div className="space-y-6">
      <DashHeader
        title="Curation"
        subtitle="Curate the arcade — the featured hero, New badges, and catalogue-wide tags & genres."
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

      {/* FEATURED GAME */}
      <Section
        title="Featured game"
        subtitle={featured ? featured.title : "None selected"}
      >
        {featured && (
          <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-brand/30 bg-brand-50/40 p-3">
            <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-surface-2">
              <CoverImage game={featured} initialClass="text-2xl" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wide text-brand">
                Current hero
              </div>
              <div className="mt-0.5 truncate text-lg font-black tracking-tight text-foreground">
                {featured.title}
              </div>
              <div className="truncate text-sm text-muted">{featured.category}</div>
            </div>
          </div>
        )}
        <p className="mb-4 text-sm text-muted">
          Exactly one game is the homepage hero. Filter, pick a new one, and press{" "}
          <span className="font-semibold text-foreground">Set featured</span> —
          choosing a new one replaces the old.
        </p>
        <FeaturedPicker games={games} />
      </Section>

      {/* NEW GAMES */}
      <Section title="New games" subtitle="Drives the homepage row + card badge">
        <p className="mb-4 text-sm text-muted">
          Marking a game{" "}
          <span className="font-semibold text-foreground">New</span> surfaces it
          in the homepage &ldquo;New games&rdquo; row and shows the badge on its
          card. Any number of games can be new.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {games.map((game) => {
            const isNew = Boolean(game.isNew);
            return (
              <div
                key={game.slug}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-foreground">
                    {game.title}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {game.category}
                  </div>
                </div>
                <form action={toggleNewAction} className="shrink-0">
                  <input type="hidden" name="slug" value={game.slug} />
                  <input type="hidden" name="value" value={String(!isNew)} />
                  <button
                    type="submit"
                    aria-pressed={isNew}
                    className={
                      isNew
                        ? "rounded-full bg-brand-50 px-4 py-1.5 text-sm font-bold text-brand hover:bg-brand-50/70"
                        : "rounded-full border border-border bg-white px-4 py-1.5 text-sm font-bold text-zinc-700 hover:bg-surface-2"
                    }
                  >
                    {isNew ? "New ✓" : "Mark new"}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
