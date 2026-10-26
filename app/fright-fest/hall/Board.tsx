"use client";

/**
 * The high-score board: the overall Fright Points table, top rows first, with
 * your own row pinned when you are ranked below them. Live from the shared
 * championship fetch; nothing here is sample data. Every state is real:
 * loading (a skeleton of the right height), the scores being offline, the
 * championship not announced, nothing played yet, the table, provisional or final.
 *
 * `fit="room"` is the board on the room's wall: it counts how many rows its
 * screen can hold (a ResizeObserver, so the rows follow the room's scale) and
 * shows that many. `fit="card"` is the same board in the page flow on a phone,
 * which has room for five.
 */

import { useEffect, useRef, useState } from "react";
import { DESK, placeVars, PHONE } from "./geometry";
import { boardCapacity, boardIsOpen, boardRows, type BoardMe } from "./logic";
import { useHall } from "./HallProvider";

const SKELETON_ROWS = 5;

export function Board({ fit }: { fit: "room" | "card" }) {
  const { champ, me, phase, summary, loading, offline, retry } = useHall();
  const box = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(fit === "card" ? 5 : SKELETON_ROWS);

  useEffect(() => {
    if (fit !== "room") return;
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const coarse = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const ro = new ResizeObserver(([e]) => setCapacity(boardCapacity(e.contentRect.height, coarse())));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const open = boardIsOpen(phase);
  const standings = champ?.available ? champ.standings : null;
  const overall = standings?.overall ?? [];
  const mine: BoardMe | null =
    me && me.signedIn && me.available && me.rank !== null && me.publicId ? { publicId: me.publicId, rank: me.rank, points: me.points } : null;
  const final = !!champ?.final || phase === "finalised" || phase === "archived";
  const view = boardRows(overall, mine, capacity, standings?.championPublicId ?? null, final);

  let body: React.ReactNode;
  if (!summary || (champ && !champ.available)) {
    body = <p className="hl-board-msg">Scores to be announced.</p>;
  } else if (loading || phase === null) {
    body = (
      <ol className="hl-rows" aria-hidden="true" data-skeleton="1">
        {Array.from({ length: capacity }, (_, i) => (
          <li key={i} className="hl-row">
            <i />
          </li>
        ))}
      </ol>
    );
  } else if (!open) {
    body = <p className="hl-board-msg">No scores yet. Ranked runs open {summary.labels.opens} UK time.</p>;
  } else if (offline) {
    body = (
      <div className="hl-board-msg">
        <p>The scores are offline for a moment. Your runs are still being saved.</p>
        <button type="button" className="hl-btn" onClick={retry}>
          Try again
        </button>
      </div>
    );
  } else if (view.rows.length === 0 && !view.you) {
    body = <p className="hl-board-msg">{phase === "live" ? "No scores yet. Be the first on the board." : "No ranked runs were entered."}</p>;
  } else {
    body = (
      <ol className="hl-rows">
        {view.rows.map((r) => (
          <li key={r.publicId} className="hl-row" data-you={r.you ? "1" : undefined} data-rank={r.rank <= 3 ? r.rank : undefined}>
            <span className="hl-rank">
              {r.champion && (
                <span className="hl-crown" role="img" aria-label="Champion">
                  ♛
                </span>
              )}
              {r.rank}
            </span>
            <span className="hl-name" title={r.name}>
              {r.you ? "You" : r.name}
            </span>
            <span className="hl-pts">{r.points}</span>
          </li>
        ))}
        {view.you && (
          <li className="hl-row" data-you="1" data-pinned="1">
            <span className="hl-rank">{view.you.rank}</span>
            <span className="hl-name">You</span>
            <span className="hl-pts">{view.you.points}</span>
          </li>
        )}
      </ol>
    );
  }

  const tag = open && standings && !offline ? (final ? "Final" : phase === "suspended" ? "Paused" : "Provisional") : null;

  return (
    <div
      ref={box}
      className="hl-board"
      data-fit={fit}
      data-in={fit === "room" ? "desk" : undefined}
      style={fit === "room" ? placeVars(DESK.board.calm, null) : undefined}
    >
      <p className="hl-board-head">
        <span title="Overall Fright Points">
          <span className="hl-board-x">Fright </span>Points
        </span>
        {tag && <span className="hl-tag">{tag}</span>}
      </p>
      <div className="hl-board-body" aria-live="off">
        {body}
      </div>
      <a className="hl-board-link" href="#standings">
        Full standings
      </a>
    </div>
  );
}

/** The phone's glimpse of the board at the room's left edge: a link down to the standings. */
export function BoardGlimpse() {
  return (
    <a className="hl-glimpse" data-in="phone" href="#standings" aria-label="See the standings" style={placeVars(null, PHONE.boardGlimpse)} />
  );
}
