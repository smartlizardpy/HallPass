import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findGame, games } from "@/app/lib/games";
import { boardExists, getBoard } from "@/app/lib/scoreboard";

export const revalidate = 45;

const FULL_LIMIT = 100;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = findGame(slug);
  if (!game) return { title: "Leaderboard" };
  return {
    title: `${game.title} Leaderboard`,
    description: `Top high scores for ${game.title} on HallPass.`,
    alternates: { canonical: `/scoreboard/${slug}` },
  };
}

export default async function BoardPage({ params }: { params: Params }) {
  const { slug } = await params;
  const game = findGame(slug);
  if (!game) notFound();

  const initialized = await boardExists(slug);
  const board = initialized
    ? await getBoard(slug, { limit: FULL_LIMIT })
    : { game: slug, scores: [] };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <Link
        href="/scoreboard"
        className="text-sm font-extrabold text-brand hover:text-brand-600"
      >
        ← All leaderboards
      </Link>

      <header
        className="mt-4 rounded-3xl p-6 sm:p-8"
        style={{
          backgroundImage: `linear-gradient(120deg, ${game.gradient[0]}, ${game.gradient[1]})`,
        }}
      >
        <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white backdrop-blur">
          {game.category}
        </span>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">
          {game.title}
        </h1>
        <p className="mt-1 text-sm font-semibold text-white/85">
          Leaderboard · all-time
        </p>
        <Link
          href={`/game/${slug}`}
          className="mt-4 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-extrabold text-zinc-900 transition hover:scale-105"
        >
          ▶ Play {game.title}
        </Link>
      </header>

      <section className="mt-6 overflow-hidden rounded-3xl bg-white shadow-sm">
        {!initialized ? (
          <p className="px-6 py-12 text-center text-sm font-semibold text-muted">
            This game does not have a leaderboard yet.
          </p>
        ) : board.scores.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm font-semibold text-muted">
            No scores yet — be the first to set a record.
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {board.scores.map((s) => (
              <li
                key={`${s.rank}-${s.handle}`}
                className="flex items-center gap-4 px-5 py-3"
              >
                <span
                  className={`w-8 shrink-0 text-center text-base font-black ${
                    s.rank === 1
                      ? "text-accent-yellow"
                      : s.rank <= 3
                        ? "text-brand"
                        : "text-muted"
                  }`}
                >
                  {s.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-extrabold text-zinc-900">
                  {s.handle}
                </span>
                <span className="shrink-0 font-mono text-base font-bold tabular-nums text-zinc-700">
                  {s.score.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

// Pre-knowable params: all registered game slugs. Boards that aren't
// initialized simply render the "no leaderboard yet" state.
export function generateStaticParams() {
  return games.map((g) => ({ slug: g.slug }));
}
