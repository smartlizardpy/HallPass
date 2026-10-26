"use client";

/**
 * The three easter eggs: a ghost, a pumpkin and Room 000. Pure decoration for
 * people with a mouse or a finger: `aria-hidden`, never focusable, they sit
 * UNDER everything interactive (hall.css), so they can block nothing, and a
 * click shows one line of text. There is no sound and nothing flashes.
 */

import { DESK, placeVars } from "./geometry";
import { useHall } from "./HallProvider";

const LINES: Record<string, string> = {
  ghost: "Shh. It only haunts this machine.",
  pumpkin: "This pumpkin has seen every high score since 2025.",
  room000: "Room 000. The door is locked. For now.",
};

export function Eggs() {
  const { toast } = useHall();
  return (
    <>
      {DESK.eggs.map((egg) => (
        // Decorative and pointer-only by design (see above), so no key handler and no role.
        <span
          key={egg.name}
          className="hl-egg"
          data-egg={egg.name}
          data-season={egg.season}
          data-in="desk"
          aria-hidden="true"
          tabIndex={-1}
          style={placeVars(egg, null)}
          onClick={() => toast(LINES[egg.name])}
        />
      ))}
    </>
  );
}
