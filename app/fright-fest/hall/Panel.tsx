"use client";

/**
 * The details panel for the selected cabinet: its status chip, the game and its
 * Fright Fest mode, the ranking rule, one line on what the phase means for it,
 * and a link to its board once the board is open. A mystery cabinet says only
 * that a game joins later; it never says which.
 *
 * Play itself is the strip on the cabinet (Cabinets.tsx), so it stays above the
 * fold on a small laptop. A phone is told when the game needs a laptop.
 *
 * `variant="room"` sits on the room's floor (laptop scene); `variant="card"` is
 * the same panel in the page flow under the phone room.
 */

import { DESK, placeVars } from "./geometry";
import { boardIsOpen, needsLaptop } from "./logic";
import { useHall } from "./HallProvider";

export function Panel({ variant }: { variant: "room" | "card" }) {
  const { cabinets, selected, status, phase, device } = useHall();
  const cab = cabinets[selected] ?? { open: false as const };
  const laptopOnly = cab.open && needsLaptop(cab.platform, device);

  return (
    <div
      className="hl-panel"
      data-variant={variant}
      data-in={variant === "room" ? "desk" : "phone"}
      style={variant === "room" ? placeVars(DESK.panel, null) : undefined}
    >
      <p className="hl-chip" data-open={cab.open ? "1" : "0"}>
        {status.chip}
      </p>
      <h2 className="hl-panel-title" title={cab.open ? `${cab.title}: ${cab.mode}` : undefined}>
        {cab.open ? (
          <>
            {cab.title}
            <span className="hl-panel-mode">{cab.mode}</span>
          </>
        ) : (
          "??? Not announced yet"
        )}
      </h2>
      {cab.open && (
        <p className="hl-panel-rule" title={cab.rankingRule}>
          {cab.rankingRule}
        </p>
      )}
      <p className="hl-panel-line">{status.line}</p>
      {laptopOnly && <p className="hl-panel-line hl-panel-warn">Play on a laptop: this game needs a keyboard.</p>}
      {cab.open && boardIsOpen(phase) && (
        <a className="hl-panel-link" href={`#board-${cab.slug}`}>
          See its board
        </a>
      )}
    </div>
  );
}
