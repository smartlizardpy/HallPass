import type { Metadata } from "next";
import Link from "next/link";
import { findGame } from "@/app/lib/games";
import {
  getBoard,
  listInitializedSlugs,
  type PublicScore,
} from "@/app/lib/scoreboard";

export const metadata: Metadata = {
  title: "Leaderboards",
  description:
    "Live high-score leaderboards for HallPass arcade games. See who's topping the charts and chase the #1 spot.",
  alternates: { canonical: "/scoreboard" },
  openGraph: {
    title: "Leaderboards · HALLPASS",
    description:
      "Live high-score leaderboards for HallPass arcade games. See who's topping the charts.",
    url: "/scoreboard",
  },
};

// Reads are cached in the data layer (~45s); keep the page itself fresh-ish.
export const revalidate = 45;

const TOP_N = 8;

type BoardCard = {
  slug: string;
  title: string;
  category: string;
  accent: string;
  scores: PublicScore[];
};

async function loadBoards(): Promise<BoardCard[]> {
  const slugs = await listInitializedSlugs();
  if (slugs.length === 0) return [];

  const cards = await Promise.all(
    slugs.map(async (slug) => {
      const game = findGame(slug);
      if (!game) return null; // basket for an unknown/retired game — skip
      const board = await getBoard(slug, { limit: TOP_N });
      return {
        slug,
        title: game.title,
        category: game.category,
        accent: game.accent,
        scores: board.scores,
      } satisfies BoardCard;
    })
  );

  return cards
    .filter((c): c is BoardCard => c !== null)
    // Boards with scores first, then by name.
    .sort(
      (a, b) =>
        b.scores.length - a.scores.length || a.title.localeCompare(b.title)
    );
}

export default async function ScoreboardPage() {
  const boards = await loadBoards();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <Link
          href="/"
          className="text-sm font-extrabold text-brand hover:text-brand-600"
        >
          ← Back to arcade
        </Link>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-zinc-900 sm:text-5xl">
          Leaderboards
        </h1>
        <p className="mt-2 max-w-2xl text-sm font-semibold text-muted sm:text-base">
          Live high scores across HallPass games. Beat a score and your initials
          land on the board.
        </p>
      </header>

      {boards.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center">
          <p className="text-base font-bold text-muted">
            No leaderboards yet. Boards appear here once a game has one
            initialized.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
          >
            Play a game
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <BoardPanel key={board.slug} board={board} />
          ))}
        </div>
      )}
    </main>
  );
}

function BoardPanel({ board }: { board: BoardCard }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm">
      <div
        className="flex items-center justify-between gap-2 px-5 py-4"
        style={{
          backgroundImage: `linear-gradient(90deg, ${board.accent}22, transparent)`,
        }}
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-black text-zinc-900">
            {board.title}
          </h2>
          <p className="text-[12px] font-bold text-muted">{board.category}</p>
        </div>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: board.accent }}
          aria-hidden
        />
      </div>

      <div className="flex-1 px-3 pb-3">
        {board.scores.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm font-semibold text-muted">
            No scores yet — be the first.
          </p>
        ) : (
          <ol className="flex flex-col">
            {board.scores.map((s) => (
              <li
                key={`${s.rank}-${s.handle}`}
                className="flex items-center gap-3 rounded-xl px-2 py-2 odd:bg-surface-2/40"
              >
                <span
                  className={`w-6 shrink-0 text-center text-sm font-black ${
                    s.rank === 1
                      ? "text-accent-yellow"
                      : s.rank <= 3
                        ? "text-brand"
                        : "text-muted"
                  }`}
                >
                  {s.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-zinc-900">
                  {s.handle}
                </span>
                <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-zinc-700">
                  {s.score.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-border px-5 py-3">
        <Link
          href={`/scoreboard/${board.slug}`}
          className="text-sm font-extrabold text-brand hover:text-brand-600"
        >
          View full board →
        </Link>
      </div>
    </section>
  );
}
