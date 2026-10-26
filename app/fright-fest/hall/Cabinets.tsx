"use client";

/**
 * The three cabinets: buttons that choose a game, with a roving tabindex (one
 * tab stop; the arrow keys, Home and End move between them, and focus follows
 * the selection). The selected cabinet is lit: its screen plays, a pool of
 * light spreads on the floor, and the strip on its front is the Play link.
 *
 * The Play strip is a sibling of the cabinet's button, not inside it (a link in
 * a button is invalid), laid over the button's lower front. Where it is not a
 * link it takes no clicks, so a tap on it still selects the cabinet.
 *
 * On a phone the room has room for one cabinet: the unselected ones are
 * `display: none` (hall.css) but stay in the DOM, and the arrows and dots in
 * `PhoneNav` step through them.
 */

import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { cabinetBoxes, CABINET, DESK, PHONE, placeVars, boxStyle, POOL } from "./geometry";
import { cabinetLabel, needsLaptop } from "./logic";
import { useHall } from "./HallProvider";

const inCabinet = (b: { x: number; y: number; w: number; h: number }, slot: { x: number; y: number }) =>
  boxStyle({ ...b, x: b.x - slot.x, y: b.y - slot.y }, CABINET);

export function Cabinets() {
  const { cabinets, selected, select, focusRequest, clearFocusRequest, device } = useHall();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving focus: once the new selection has rendered (a phone shows only one cabinet), move focus onto it.
  useEffect(() => {
    if (focusRequest === null) return;
    buttons.current[focusRequest]?.focus();
    clearFocusRequest();
  }, [focusRequest, clearFocusRequest]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = cabinets.length - 1;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    select(to, { focus: true });
  };

  return (
    <div role="group" aria-label="Game cabinets" className="hl-cabs">
      {cabinets.map((cab, i) => {
        const on = i === selected;
        const art = cab.open ? cab.art : "mystery";
        const desk = DESK.slots[i];
        const phone = PHONE.slots[0];
        const d = cabinetBoxes(desk);
        const p = cabinetBoxes(phone);
        const laptopOnly = cab.open && needsLaptop(cab.platform, device);
        return (
          <div
            key={i}
            className="hl-cab"
            data-art={art}
            data-on={on ? "1" : "0"}
            data-open={cab.open ? "1" : "0"}
            style={placeVars(d.cabinet, p.cabinet)}
          >
            {on && <span className="hl-pool" aria-hidden="true" style={{ ...boxStyle({ x: POOL.dx, y: POOL.dy, w: POOL.w, h: POOL.h }, CABINET) }} />}
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              className="hl-cab-btn"
              aria-pressed={on}
              aria-label={cabinetLabel(cab, i, cabinets.length)}
              tabIndex={on ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onKey(e, i)}
            />
            {on && <span className="hl-loop hl-scr" aria-hidden="true" style={{ ...inCabinet(d.screen, desk), "--frames": CABINET.screenFrames, "--dur": `${CABINET.screenFrames / CABINET.screenFps}s` } as React.CSSProperties} />}
            <span className="hl-strip" style={inCabinet(d.button, desk)}>
              {cab.open && on ? (
                laptopOnly ? (
                  <span className="hl-play" data-off="1" title="This game needs a keyboard. Play it on a laptop.">
                    Laptop only
                  </span>
                ) : (
                  <Link href={cab.playHref} className="hl-play" aria-label={`Play ${cab.title}`}>
                    Play
                  </Link>
                )
              ) : (
                <span className="hl-play" data-off="1" aria-hidden="true">
                  {cab.open ? cab.title : "???"}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The phone's way through the cabinets: previous, next and where you are. */
export function PhoneNav() {
  const { cabinets, selected, select } = useHall();
  return (
    <div className="hl-nav" data-in="phone" style={placeVars(null, PHONE.panel)}>
      <button type="button" className="hl-nav-btn" aria-label="Previous cabinet" onClick={() => select(selected - 1)}>
        <span aria-hidden="true">‹</span>
      </button>
      <span className="hl-dots" aria-hidden="true">
        {cabinets.map((_, i) => (
          <i key={i} data-on={i === selected ? "1" : "0"} />
        ))}
      </span>
      <button type="button" className="hl-nav-btn" aria-label="Next cabinet" onClick={() => select(selected + 1)}>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
