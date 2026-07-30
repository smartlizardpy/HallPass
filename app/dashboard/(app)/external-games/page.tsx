/**
 * HallPass dashboard — EXTERNAL (off-site) games index.
 *
 * Lists every row of `external_games` (games hosted off-site, embedded by URL and
 * appended to the resolved catalogue after the static entries) with a cover
 * thumbnail, title, category, a link to the live external URL, and a delete form.
 * A prominent "Add external game" action opens the create form.
 *
 * FAIL-SOFT: `listExternalGames()` can throw on an unconfigured/unreachable Neon,
 * so it is guarded with `.catch(() => [])` — the page then renders an empty state
 * instead of 500-ing. Gated with `requireRole("admin")`, the same guard the
 * actions enforce.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { listExternalGames } from "@/app/lib/external-games-store";
import type { Game } from "@/app/lib/games";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { deleteExternalGameAction, recacheExternalCoverAction } from "./actions";

export const metadata: Metadata = {
  title: "External games",
  description: "Register and manage off-site games embedded by URL.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ ok?: string | string[]; error?: string | string[] }>;

function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

const OK_LABEL: Record<string, string> = {
  created: "External game added.",
  deleted: "External game deleted.",
  recached: "Cover re-cached to blob storage.",
};

export default async function ExternalGamesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const sp = await searchParams;
  const okKey = asString(sp.ok);
  const ok = okKey ? (OK_LABEL[okKey] ?? okKey) : null;
  const error = asString(sp.error);

  // Fail soft: an unconfigured/unreachable Neon degrades to an empty list.
  const games: Game[] = await listExternalGames().catch(() => []);

  return (
    <div className="space-y-6">
      <DashHeader
        title="External games"
        subtitle="Off-site games embedded by URL. They appear alongside native games."
        action={
          <Link
            href="/dashboard/external-games/new"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Add external game
          </Link>
        }
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

      <Section title="Registered" subtitle={`${games.length} game${games.length === 1 ? "" : "s"}`}>
        {games.length === 0 ? (
          <p className="text-sm text-muted">
            No external games yet.{" "}
            <Link
              href="/dashboard/external-games/new"
              className="font-semibold text-brand hover:text-brand-600"
            >
              Add one
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-3">
            {games.map((game) => (
              <li
                key={game.slug}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={game.coverUrl ?? `/games/${game.slug}/cover.png`}
                  alt=""
                  loading="lazy"
                  style={
                    game.coverUrl
                      ? undefined
                      : {
                          backgroundImage: `linear-gradient(135deg, ${game.gradient[0]}, ${game.gradient[1]})`,
                        }
                  }
                  className="aspect-video w-28 shrink-0 rounded-lg bg-surface-2 object-cover"
                />

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-black tracking-tight text-foreground">
                    {game.title}
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {game.category || "Uncategorised"}
                  </p>
                  {game.externalUrl && (
                    <a
                      href={game.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block max-w-full truncate text-xs font-semibold text-brand hover:text-brand-600"
                    >
                      {game.externalUrl} ↗
                    </a>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* Re-host this game's cover on our blob so devices stop
                      re-fetching it from the third-party host. External-only:
                      every row on this page is an off-site game. */}
                  <form action={recacheExternalCoverAction}>
                    <input type="hidden" name="slug" value={game.slug} />
                    <button
                      type="submit"
                      className="rounded-full border border-border bg-white px-4 py-1.5 text-sm font-bold text-zinc-700 hover:bg-surface-2"
                      title="Download the current cover and re-host it on our storage"
                    >
                      Re-cache cover
                    </button>
                  </form>

                  <form action={deleteExternalGameAction}>
                    <input type="hidden" name="slug" value={game.slug} />
                    <button
                      type="submit"
                      className="rounded-full border border-red-300 bg-white px-4 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50"
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
    </div>
  );
}
