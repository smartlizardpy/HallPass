/**
 * HallPass dashboard — homepage CURATION.
 *
 * The control surface for how the public arcade homepage presents itself: which
 * single game is the FEATURED hero, and which games carry the NEW badge. Both
 * read off the resolved (override-applied) catalogue, so the current state shown
 * here is exactly what the homepage renders.
 *
 * Two panels:
 *   - FEATURED GAME: a single radio list (`name="slug"`) of every game, the
 *     current `isFeatured` holder pre-checked, posting to `setFeaturedAction`.
 *     Only one game can be the hero, so the swap is atomic in the store.
 *   - NEW GAMES: every game with its own inline `toggleNewAction` form carrying
 *     the slug + the DESIRED next state, so each toggle posts independently.
 *
 * Gated with `requireRole("admin")`. `resolveGames()` already fails soft to the
 * static catalogue on a Neon outage, so the page renders regardless. `?ok`/
 * `?error` banners are read from the async `searchParams`.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { resolveGames } from "@/app/lib/games-store";
import { CoverImage } from "@/app/components/CoverImage";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { setFeaturedAction, toggleNewAction } from "./actions";

export const metadata: Metadata = {
  title: "Curation",
  description: "Control the arcade homepage hero and New badges.",
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
        subtitle="Control the arcade homepage — the featured hero and New badges."
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
        <p className="mb-4 text-sm text-muted">
          Exactly one game is the homepage hero. Pick it below and press{" "}
          <span className="font-semibold text-foreground">Set featured</span> —
          choosing a new one replaces the old.
        </p>
        <form action={setFeaturedAction} className="space-y-4">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {games.map((game) => (
              <li key={game.slug}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <input
                    type="radio"
                    name="slug"
                    value={game.slug}
                    defaultChecked={Boolean(game.isFeatured)}
                    className="h-4 w-4 shrink-0 border-border text-brand focus:ring-brand/30"
                  />
                  {/* CoverImage handles external games, which have no
                      `/games/<slug>/cover.png` to point at. */}
                  <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded bg-surface-2">
                    <CoverImage game={game} initialClass="text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-foreground">
                      {game.title}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {game.category}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Set featured
          </button>
        </form>
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
