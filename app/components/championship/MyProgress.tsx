"use client";

/**
 * "Your Fright Fest": the viewer's own place, best runs and recent run outcomes.
 * Per-player, so it reads `/me` (never cached) and shows nobody else's data.
 *
 * Signed out, it explains that guests can play but are not ranked, and offers
 * sign-in. Every run outcome is in words a 13-year-old can act on: "Counted",
 * "Held for review", "Not counted" with the server's reason.
 */

import { startSignIn } from "@/app/lib/auth-actions";
import { formatScore, ordinal } from "@/app/lib/championship/format";
import { gapToNextPlace } from "@/app/lib/championship/gap";
import { clockPhase, type ChampionshipSummary } from "@/app/lib/championship/summary";
import type { RunStatus } from "@/app/lib/championship/types";
import { useChampionship, useMinute, useMyChampionship } from "./data";

const RUN_WORDS: Record<RunStatus, string> = {
  issued: "Unfinished",
  accepted: "Counted",
  flagged: "Held for review",
  rejected: "Not counted",
  disqualified: "Disqualified",
};

function PhaseLine({ s }: { s: ChampionshipSummary }) {
  const { data } = useChampionship(s.id);
  const now = useMinute();
  const phase = data?.available ? data.phase : now === null ? null : clockPhase(s, now);
  if (phase === "upcoming") return <p className="text-sm text-foreground-2">Ranked runs open {s.labels.opens} UK time. Until then you can practise.</p>;
  return null;
}

export function MyChampionship({ summary: s }: { summary: ChampionshipSummary }) {
  const { data: me, loading } = useMyChampionship(s.id);
  const { data: pub } = useChampionship(s.id);
  const boards = pub?.standings?.boards ?? [];
  const boardOf = new Map(boards.map((b) => [b.slug, b]));
  // The gap line is for a live table only: nothing can move once the close has passed.
  const gap = me && me.signedIn && me.rank !== null ? gapToNextPlace(pub?.standings?.overall ?? [], { rank: me.rank, points: me.points }, pub?.available ? pub.phase : null) : null;

  return (
    <section aria-labelledby="mine-h" className="hl-sec rounded-2xl border border-border bg-surface p-4 sm:p-6">
      <h2 id="mine-h" className="text-xl font-black">
        Your Fright Fest
      </h2>
      {loading ? (
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none" aria-hidden="true" />
      ) : !me ? (
        <p className="mt-3 text-sm text-muted">Your progress is not available right now.</p>
      ) : !me.signedIn ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose text-sm text-foreground-2">
            <b>Sign in to enter.</b> Anyone can play the Fright Fest modes, but only signed-in players are ranked. The
            table shows your HallPass handle, never your real name.
          </p>
          <form action={startSignIn}>
            <button type="submit" className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600">
              Sign in to enter
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <PhaseLine s={s} />
          {me.rank !== null ? (
            <p className="text-base">
              You are <b>{ordinal(me.rank)}</b> with <b>{me.points} Fright Points</b>.{" "}
              {me.eligible ? (
                <span className="text-foreground-2">You have a result on every game, so you are in the running for the title.</span>
              ) : me.missing.length > 0 ? (
                <span className="text-foreground-2">
                  Still to play: {me.missing.map((slug) => boardOf.get(slug)?.title ?? "a game").join(", ")}. The champion needs a result on every game.
                </span>
              ) : null}
              {gap && <span className="text-foreground-2"> {gap}</span>}
            </p>
          ) : (
            <p className="text-sm text-foreground-2">No ranked run yet. Play a Fright Fest mode while signed in and your best run lands on its board.</p>
          )}

          {me.boards.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-3">
              {me.boards.map((b) => {
                const board = boardOf.get(b.slug);
                return (
                  <li key={b.slug} className="rounded-xl bg-surface-2 px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-wider text-muted">{board?.modeShort ?? board?.title ?? b.slug}</p>
                    {b.rank !== null && b.score !== null && board ? (
                      <p className="text-sm">
                        <b>{ordinal(b.rank)}</b> · {formatScore(board.metric, b.score)} · {b.points} pts
                      </p>
                    ) : (
                      <p className="text-sm text-muted">No result yet</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {me.runs.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-bold text-foreground-2">Your recent runs</summary>
              <ul className="mt-2 space-y-1">
                {me.runs.slice(0, 8).map((r) => {
                  const board = boardOf.get(r.gameSlug);
                  return (
                    <li key={r.id} className="flex flex-wrap gap-x-2">
                      <span className="font-bold">{board?.modeShort ?? "Run"}</span>
                      {r.score !== null && board && <span className="font-mono">{formatScore(board.metric, r.score)}</span>}
                      <span className={r.status === "accepted" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground-2"}>{RUN_WORDS[r.status]}</span>
                      {r.reason && (r.status === "rejected" || r.status === "disqualified") && <span className="text-muted">({r.reason})</span>}
                      {r.status === "flagged" && <span className="text-muted">(a person checks it before it counts)</span>}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
