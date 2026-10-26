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
  if (phase === "upcoming") return <p className="ar-line">Ranked runs open {s.labels.opens} UK time. Until then you can practise.</p>;
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
    <section id="mine" aria-labelledby="mine-h" className="ar-mine">
      <h3 id="mine-h" className="ar-label">
        Your Fright Fest
      </h3>
      {loading ? (
        <div className="ar-skeleton ar-skeleton-s" aria-hidden="true" />
      ) : !me ? (
        <p className="ar-line">Your progress is not available right now.</p>
      ) : !me.signedIn ? (
        <div className="ar-mine-row">
          <p className="ar-line">
            <b>Sign in to enter.</b> Anyone can play the Fright Fest modes, but only signed-in players are ranked. The
            table shows your HallPass handle, never your real name.
          </p>
          <form action={startSignIn}>
            <button type="submit" className="ar-btn ar-btn-gold">
              Sign in to enter
            </button>
          </form>
        </div>
      ) : (
        <div className="ar-mine-body">
          <PhaseLine s={s} />
          {me.rank !== null ? (
            <p className="ar-line">
              You are <b>{ordinal(me.rank)}</b> with <b>{me.points} Fright Points</b>.{" "}
              {me.eligible ? (
                <span>You have a result on every game, so you are in the running for the title.</span>
              ) : me.missing.length > 0 ? (
                <span>
                  Still to play: {me.missing.map((slug) => boardOf.get(slug)?.title ?? "a game").join(", ")}. The champion needs a result on every game.
                </span>
              ) : null}
              {gap && <span> {gap}</span>}
            </p>
          ) : (
            <p className="ar-line">No ranked run yet. Play a Fright Fest mode while signed in and your best run lands on its board.</p>
          )}

          {me.boards.length > 0 && (
            <ul className="ar-mine-boards">
              {me.boards.map((b) => {
                const board = boardOf.get(b.slug);
                return (
                  <li key={b.slug}>
                    <p className="ar-label">{board?.modeShort ?? board?.title ?? b.slug}</p>
                    {b.rank !== null && b.score !== null && board ? (
                      <p className="ar-line">
                        <b>{ordinal(b.rank)}</b> · {formatScore(board.metric, b.score)} · {b.points} pts
                      </p>
                    ) : (
                      <p className="ar-line ar-dim">No result yet</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {me.runs.length > 0 && (
            <details className="ar-runs">
              <summary>Your recent runs</summary>
              <ul>
                {me.runs.slice(0, 8).map((r) => {
                  const board = boardOf.get(r.gameSlug);
                  return (
                    <li key={r.id}>
                      <span className="ar-strong">{board?.modeShort ?? "Run"}</span>
                      {r.score !== null && board && <span>{formatScore(board.metric, r.score)}</span>}
                      <span className={r.status === "accepted" ? "ar-ok" : ""}>{RUN_WORDS[r.status]}</span>
                      {r.reason && (r.status === "rejected" || r.status === "disqualified") && <span className="ar-dim">({r.reason})</span>}
                      {r.status === "flagged" && <span className="ar-dim">(a person checks it before it counts)</span>}
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
