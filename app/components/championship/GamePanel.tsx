"use client";

/**
 * The championship panel on an event game's store page: how to enter, the
 * leader, your best and rank on this board, and a link to the full standings.
 *
 * A CLIENT ISLAND, like `ChallengedHere` and `FriendsWhoPlay`: `/game/[slug]`
 * must stay prerendered (and in the service-worker precache), so per-viewer and
 * live data arrive from `/api/`.
 *
 * Renders NOTHING until the API says this game's board has joined: a game still
 * waiting for verification is not announced here either. It is championship
 * UI, not skin, so it shows whether or not the haunted look is painting.
 */

import Link from "next/link";
import { startSignIn } from "@/app/lib/auth-actions";
import { formatScore, ordinal } from "@/app/lib/championship/format";
import { clockPhase, phaseLine, type ChampionshipSummary, type SummaryGame } from "@/app/lib/championship/summary";
import { useChampionship, useMinute, useMyChampionship } from "./data";

export function ChampionshipGamePanel({ summary: s, game }: { summary: ChampionshipSummary; game: SummaryGame }) {
  const { data } = useChampionship(s.id);
  const board = data?.standings?.boards.find((b) => b.slug === game.slug) ?? null;
  const { data: me } = useMyChampionship(s.id, !!board);
  const now = useMinute();
  if (!data?.available || !board) return null;

  const phase = data.phase ?? (now === null ? null : clockPhase(s, now));
  const leader = board.entries[0] ?? null;
  const mine = me && me.signedIn ? me.boards.find((b) => b.slug === game.slug) : null;
  const href = `${s.href}#board-${game.slug}`;

  return (
    <aside aria-labelledby={`champ-${game.slug}`} className="mt-4 rounded-2xl border border-border bg-surface p-4 text-sm">
      <h2 id={`champ-${game.slug}`} className="text-[11px] font-black uppercase tracking-wider text-muted">
        {s.title} · {game.modeShort}
      </h2>
      {phase && <p className="mt-2 text-foreground-2">{phaseLine(s, phase)}</p>}
      {board.status === "paused" && <p className="mt-2 font-bold text-amber-700 dark:text-amber-300">This board is paused for now.</p>}
      {(phase === "live" || phase === "upcoming") && board.status === "open" && (
        <p className="mt-2">
          <b>To enter:</b> sign in, then play <b>{game.mode}</b> from the game&apos;s menu. Your best run counts.
        </p>
      )}
      <dl className="mt-3 space-y-1">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Leader</dt>
          <dd className="min-w-0 truncate text-right font-bold">
            {leader ? `${leader.name} · ${formatScore(board.metric, leader.score)}` : "Nobody yet"}
          </dd>
        </div>
        {mine && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">You</dt>
            <dd className="text-right font-bold">
              {mine.rank !== null && mine.score !== null ? `${ordinal(mine.rank)} · ${formatScore(board.metric, mine.score)}` : "No ranked run yet"}
            </dd>
          </div>
        )}
      </dl>
      {me && !me.signedIn && (phase === "live" || phase === "upcoming") && (
        <form action={startSignIn} className="mt-3">
          <button type="submit" className="w-full rounded-full bg-brand px-4 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600">
            Sign in to be ranked
          </button>
        </form>
      )}
      <Link href={href} prefetch={false} className="mt-3 inline-block font-bold text-brand hover:text-brand-600">
        Full standings →
      </Link>
    </aside>
  );
}
