/**
 * HallPass dashboard — board detail & edit.
 *
 * Admin-gated. Loads one board by its id (the `[id]` route param, awaited per
 * this Next.js's async-params convention) and renders three panels:
 *   - an edit form wired to `updateBoardAction`. The id is immutable, so it
 *     rides along as a hidden `slug` field; the other fields are prefilled.
 *   - a read-only "Top scores" preview (first 10, all-time, in the board's own
 *     sort direction) plus the public endpoint hint.
 *   - a "Scores (moderation)" panel listing the 50 newest raw rows, each with a
 *     per-row delete and a board-wide "Clear all scores" reset, wired to
 *     `deleteScoreAction` / `resetBoardAction`.
 *
 * Failure modes are kept distinct:
 *   - An UNCONFIGURED database (the store throws on first query when
 *     `DATABASE_URL` is unset) renders the same friendly notice as the boards
 *     index instead of a 500. All reads share one try/catch for this.
 *   - A genuinely-missing board id (a clean `null` from `getBoard`) is a 404.
 *   - A removed/unknown linked game is preserved, not silently unlinked: the
 *     select keeps a "<slug> (missing)" option so a save round-trips the link.
 *
 * On a failed action the redirect lands back here with `?error`; a successful
 * moderation action lands with `?ok` — both surfaced as banners.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { findGame, games } from "@/app/lib/games";
import { store } from "@/app/lib/scoreboard";
import { buildIntegrationPrompt } from "@/app/lib/integration-prompt";
import {
  deleteBoardAction,
  deleteScoreAction,
  resetBoardAction,
  updateBoardAction,
} from "../actions";
import { DashHeader } from "../../_ui/DashHeader";
import { IntegratePanel } from "./IntegratePanel";

export const metadata: Metadata = {
  title: "Edit leaderboard",
  robots: { index: false, follow: false },
};

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{
  ok?: string | string[];
  error?: string | string[];
  created?: string | string[];
}>;

function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * True when a thrown store error is the "no DATABASE_URL" stand-in (see
 * `app/lib/db.ts`), as opposed to a real query failure. We match on the message
 * so the page can degrade to a friendly notice rather than a 500.
 */
function isUnconfiguredDbError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /unconfigured|DATABASE_URL/i.test(err.message)
  );
}

export default async function BoardDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const { id } = await params;
  const sp = await searchParams;
  const ok = asString(sp.ok);
  const error = asString(sp.error);
  // Set only on the post-create redirect, so the celebratory "copy your AI
  // prompt" modal auto-opens once for a freshly made board.
  const created = asString(sp.created) === "1";

  // All board reads share one try/catch: an unconfigured DB throws on first
  // query and must degrade to a notice, not a 500. notFound() is deliberately
  // NOT called in here — its thrown signal would be caught — so we capture the
  // board and decide after the try.
  let board: Awaited<ReturnType<typeof store.getBoard>> = null;
  let scores: Awaited<ReturnType<typeof store.getTopScores>> = [];
  let mod: Awaited<ReturnType<typeof store.listScoresForModeration>> = [];
  let dbUnconfigured = false;

  try {
    board = await store.getBoard(id);
    if (board) {
      scores = await store.getTopScores(id, {
        limit: 10,
        period: "all",
        sort: board.sort,
      });
      mod = await store.listScoresForModeration(id, 50);
    }
  } catch (err) {
    if (isUnconfiguredDbError(err)) {
      dbUnconfigured = true;
    } else {
      throw err;
    }
  }

  if (dbUnconfigured) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href="/dashboard/boards"
          className="text-sm font-semibold text-brand hover:text-brand-600"
        >
          ← All leaderboards
        </Link>
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database not configured. Set{" "}
          <code className="font-mono">DATABASE_URL</code> to manage leaderboards.
        </div>
      </div>
    );
  }

  // A clean null (no error) means the id names no board → genuine 404.
  if (!board) notFound();

  // Origin for the agent-integration prompt, derived from the live request so it
  // tracks the current domain (vercel preview today, the real domain later) with
  // no code change — mirroring how `/llms-full.txt` resolves its base URL. Falls
  // back to the canonical host if the proxy headers are somehow absent.
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "hallpass.gg";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const integrationPrompt = buildIntegrationPrompt({
    slug: board.slug,
    title: board.title,
    sort: board.sort,
    scoreLabel: board.scoreLabel,
    baseUrl: `${proto}://${host}`,
  });

  // A linked game whose slug no longer resolves is "missing": we keep the link
  // visible and round-trippable rather than treating the board as standalone.
  const linkedGame = board.gameSlug ? findGame(board.gameSlug) : undefined;
  const gameMissing = Boolean(board.gameSlug) && !linkedGame;
  const gameLabel = linkedGame
    ? linkedGame.title
    : gameMissing
      ? `${board.gameSlug} (missing)`
      : "Standalone board";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/dashboard/boards"
        className="mb-3 inline-block text-sm font-semibold text-brand hover:text-brand-600"
      >
        ← All leaderboards
      </Link>
      <DashHeader title={board.title} subtitle={board.slug} />

      {ok && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <form
        action={updateBoardAction}
        className="space-y-5 rounded-xl border border-border bg-surface p-5"
      >
        <h2 className="text-lg font-black">Edit board</h2>

        {/* Immutable id — carried so the upsert targets the right row. */}
        <input type="hidden" name="slug" value={board.slug} />
        {/* The board's existing game link, so a now-removed game still round-trips
            on save instead of being rejected as unknown. */}
        <input
          type="hidden"
          name="originalGameSlug"
          value={board.gameSlug ?? ""}
        />

        <label className="block text-sm font-semibold text-zinc-900">
          Board id
          <input
            type="text"
            value={board.slug}
            readOnly
            disabled
            className="mt-2 w-full cursor-not-allowed rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-muted outline-none"
          />
        </label>

        <label className="block text-sm font-semibold text-zinc-900">
          Title
          <input
            name="title"
            type="text"
            required
            defaultValue={board.title}
            className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
        </label>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-zinc-900">
            Sort
            <select
              name="sort"
              defaultValue={board.sort}
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="desc">Descending (highest first)</option>
              <option value="asc">Ascending (lowest first)</option>
            </select>
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Score label
            <input
              name="scoreLabel"
              type="text"
              defaultValue={board.scoreLabel}
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-zinc-900">
            Max score
            <input
              name="maxScore"
              type="number"
              min={0}
              step={1}
              placeholder="No cap"
              defaultValue={board.maxScore ?? ""}
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Game
            <select
              name="gameSlug"
              defaultValue={board.gameSlug ?? ""}
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">— none (standalone) —</option>
              {/* Linked game was removed from the catalogue: keep a matching
                  option so the preselected value round-trips on save instead of
                  silently collapsing to standalone. */}
              {gameMissing && (
                <option value={board.gameSlug ?? ""}>{board.gameSlug} (missing)</option>
              )}
              {games.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="pt-1">
          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Save changes
          </button>
        </div>
      </form>

      <IntegratePanel prompt={integrationPrompt} celebrate={created} />

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-black">Top scores</h2>
          <span className="text-xs text-muted">{gameLabel} · all-time</span>
        </div>

        {scores.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            No scores submitted yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Handle</th>
                <th className="py-2 text-right">{board.scoreLabel}</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((entry) => (
                <tr key={`${entry.rank}-${entry.handle}`} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{entry.rank}</td>
                  <td className="py-2 pr-3 font-semibold">
                    {/* Verified players (a signed-in Google identity) carry an
                        avatar + a verified mark; anonymous handle submissions
                        render bare, exactly as before. EMAIL is never present. */}
                    <span className="flex items-center gap-2">
                      {entry.avatar && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.avatar}
                          alt=""
                          width={20}
                          height={20}
                          referrerPolicy="no-referrer"
                          className="h-5 w-5 shrink-0 rounded-full border border-border object-cover"
                        />
                      )}
                      <span>{entry.handle}</span>
                      {entry.verified && (
                        <span
                          title="Verified player"
                          aria-label="Verified player"
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-black leading-none text-white"
                        >
                          ✓
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{entry.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-4 text-xs text-muted">
          Public endpoint:{" "}
          <code className="font-mono text-foreground">
            GET /api/v1/leaderboard/{board.slug}
          </code>
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-black">Scores (moderation)</h2>
          <span className="text-xs text-muted">newest first · up to 50</span>
        </div>

        {mod.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            No scores to moderate.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Id</th>
                <th className="py-2 pr-3">Handle</th>
                <th className="py-2 pr-3 text-right">{board.scoreLabel}</th>
                <th className="py-2 pr-3">Submitted</th>
                <th className="py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {mod.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{row.id}</td>
                  <td className="py-2 pr-3 font-semibold">{row.handle}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{row.score}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{row.createdAt}</td>
                  <td className="py-2 text-right">
                    <form action={deleteScoreAction}>
                      <input type="hidden" name="boardId" value={id} />
                      <input type="hidden" name="scoreId" value={row.id} />
                      <button
                        type="submit"
                        className="rounded-full bg-red-600 px-3 py-1 text-xs font-extrabold text-white hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-black">Reset board</h3>
          <p className="mt-1 text-xs text-muted">
            Permanently deletes every score on this board. This cannot be undone.
          </p>
          <form action={resetBoardAction} className="mt-3">
            <input type="hidden" name="boardId" value={id} />
            <button
              type="submit"
              className="rounded-full bg-red-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-red-700"
            >
              Clear all scores
            </button>
          </form>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-red-300 bg-red-50/40 p-5">
        <h2 className="text-lg font-black text-red-700">Delete leaderboard</h2>
        <p className="mt-1 text-sm text-red-900/80">
          Permanently removes{" "}
          <span className="font-mono font-semibold">{board.slug}</span> and every
          score submitted to it. This cannot be undone. Type the board id to
          confirm.
        </p>
        <form
          action={deleteBoardAction}
          className="mt-3 flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="boardId" value={board.slug} />
          <input
            name="confirm"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={board.slug}
            aria-label="Type the board id to confirm deletion"
            className="rounded-lg border border-red-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:ring-2 focus:ring-red-300"
          />
          <button
            type="submit"
            className="rounded-full bg-red-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-red-700"
          >
            Delete leaderboard
          </button>
        </form>
      </section>
    </div>
  );
}
