/**
 * HallPass dashboard — create a new leaderboard.
 *
 * Admin-gated form that posts to the `createBoardAction` server action. The
 * action owns all validation (via the shared `parseCreateBoardInput`); on
 * failure it redirects back here with the message in `?error`, which we surface
 * as a banner. The game `<select>` leads with an empty "none" option — leaving
 * it selected provisions a STANDALONE board (the action maps "" → explicit
 * standalone), and a real game can be linked later from the detail page.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { games } from "@/app/lib/games";
import { createBoardAction } from "../actions";
import { requireRole } from "@/app/lib/auth";
import { DashHeader } from "../../_ui/DashHeader";

export const metadata: Metadata = {
  title: "New leaderboard",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ error?: string | string[] }>;

function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewBoardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");
  const error = asString((await searchParams).error);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <DashHeader
        title="New leaderboard"
        subtitle="Provision a scoreboard. The board id becomes its public API path."
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <form
        action={createBoardAction}
        className="space-y-5 rounded-xl border border-border bg-surface p-5"
      >
        <label className="block text-sm font-semibold text-zinc-900">
          Board id
          <input
            name="slug"
            type="text"
            required
            pattern="[a-z0-9][a-z0-9-]*"
            placeholder="my-game-board"
            autoComplete="off"
            className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
          <span className="mt-1 block text-xs font-normal text-muted">
            Lowercase letters, digits, and hyphens. Used as{" "}
            <code className="font-mono">/api/v1/leaderboard/&lt;id&gt;</code>.
          </span>
        </label>

        <label className="block text-sm font-semibold text-zinc-900">
          Title
          <input
            name="title"
            type="text"
            required
            placeholder="My Game — High Scores"
            className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
        </label>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-zinc-900">
            Sort
            <select
              name="sort"
              defaultValue="desc"
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
              defaultValue="Score"
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
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
            <span className="mt-1 block text-xs font-normal text-muted">
              Optional. Leave blank for no per-board cap.
            </span>
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Game
            <select
              name="gameSlug"
              defaultValue=""
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">— none (link later) —</option>
              {games.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Create board
          </button>
          <Link
            href="/dashboard/boards"
            className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
