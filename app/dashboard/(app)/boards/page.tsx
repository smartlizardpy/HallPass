/**
 * HallPass dashboard — leaderboards index.
 *
 * Admin-gated table of every provisioned board: its id (the public
 * `/api/v1/leaderboard/<id>` path), the game it links to (or "standalone"), its
 * sort direction, score label, and a live count of submitted scores. Each row
 * links to the board's detail/edit page; the header links to the create form.
 *
 * The store throws when `DATABASE_URL` is unset (the Neon connection is lazy),
 * so the data fetch is wrapped: an unconfigured database renders a friendly
 * notice instead of a 500.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { isUnconfiguredDbError } from "@/app/lib/db";
import { findGame } from "@/app/lib/games";
import { store } from "@/app/lib/scoreboard";
import type { BoardConfig } from "@/sdk/src/contract";
import { DashHeader } from "../_ui/DashHeader";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "Manage HALLPASS scoreboards and their game links.",
  robots: { index: false, follow: false },
};

export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string | string[] }>;
}) {
  await requireRole("admin");

  const okParam = (await searchParams).ok;
  const ok = Array.isArray(okParam) ? okParam[0] : okParam;

  let boards: BoardConfig[] | null = null;
  let counts: number[] = [];
  let dbError = false;

  try {
    boards = await store.listBoards();
    counts = await Promise.all(boards.map((b) => store.countScores(b.slug)));
  } catch (error) {
    // Only the "no DATABASE_URL" case is a friendly notice; a real outage must
    // surface (a 500) rather than masquerade as "not configured".
    if (isUnconfiguredDbError(error)) dbError = true;
    else throw error;
  }

  return (
    <>
      <DashHeader
        title="Leaderboards"
        subtitle="Manage scoreboards and the games they power."
        action={
          <Link
            href="/dashboard/boards/new"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            New board
          </Link>
        }
      />

      {ok && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}

      {dbError ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database not configured. Set{" "}
          <code className="font-mono">DATABASE_URL</code> to manage leaderboards.
        </div>
      ) : boards && boards.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm font-semibold text-foreground">No boards yet.</p>
          <p className="mt-1 text-sm text-muted">
            Create your first leaderboard to start collecting scores.
          </p>
          <Link
            href="/dashboard/boards/new"
            className="mt-4 inline-block rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            New board
          </Link>
        </div>
      ) : (
        boards && (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="whitespace-nowrap px-4 py-3">Board id</th>
                  <th className="px-4 py-3">Game</th>
                  <th className="px-4 py-3">Sort</th>
                  <th className="whitespace-nowrap px-4 py-3">Score label</th>
                  <th className="px-4 py-3 text-right">Scores</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {boards.map((board, i) => {
                  const game = board.gameSlug ? findGame(board.gameSlug) : undefined;
                  return (
                    <tr
                      key={board.slug}
                      className="border-b border-border last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-3 font-mono text-xs">{board.slug}</td>
                      <td className="px-4 py-3">
                        {game ? (
                          game.title
                        ) : (
                          <span className="text-muted">— standalone —</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {board.sort === "asc" ? "Ascending" : "Descending"}
                      </td>
                      <td className="px-4 py-3">{board.scoreLabel}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {counts[i]}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/boards/${board.slug}`}
                          className="text-sm font-semibold text-brand hover:text-brand-600"
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
