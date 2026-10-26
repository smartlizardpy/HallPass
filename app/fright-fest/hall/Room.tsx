/**
 * The Arcade Hall: the room at the top of /fright-fest. A SERVER component: the
 * picture, its loops, the labels and the links are all in the prerendered HTML,
 * identical for every visitor and every date. The few parts that need state (the
 * cabinets, the ticker, the board, the details panel, the eggs) are client leaves
 * inside <HallProvider>, which fetches the live data after hydration.
 *
 * It names no game that is not announced: `cabinets` comes from props.ts, where
 * an unannounced game is already a bare mystery cabinet.
 *
 * Layout and seasons live in hall.css (read its header). The art and the numbers
 * that place things on it are in geometry.ts.
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import type { ChampionshipSummary } from "@/app/lib/championship/summary";
import { Board, BoardGlimpse } from "./Board";
import { Cabinets, PhoneNav } from "./Cabinets";
import { Eggs } from "./Eggs";
import { ART_DIR, boxStyle, DESK, PHONE, placeVars, type Box, type Loop } from "./geometry";
import { CandyStatus } from "./candy/CandyStatus";
import type { CandyProps } from "./candy/props";
import { CANDY_HUNT_OPEN } from "./config";
import { HallProvider } from "./HallProvider";
import { Panel } from "./Panel";
import type { CabinetProps } from "./props";
import { Ticker } from "./Ticker";
import "./hall.css";

const PRIZE_DOOR: Box = { x: 334, y: 24, w: 94, h: 150 };

function LoopStrip({ loop, scene }: { loop: Loop; scene: "desk" | "phone" }) {
  const sc = scene === "desk" ? DESK : PHONE;
  return (
    <span
      className="hl-loop"
      aria-hidden="true"
      data-in={scene}
      data-season={loop.season}
      style={
        {
          ...boxStyle(loop, sc),
          "--frames": loop.frames,
          "--dur": `${loop.frames / loop.fps}s`,
          backgroundImage: `url(${ART_DIR}/${loop.file})`,
        } as CSSProperties
      }
    />
  );
}

export function Room({
  cabinets,
  summary,
  candy,
}: {
  cabinets: CabinetProps[];
  summary: ChampionshipSummary | null;
  /** The Candy Hunt dates for the noticeboard; `null` leaves the plate a sign. */
  candy?: CandyProps | null;
}) {
  return (
    <HallProvider cabinets={cabinets} summary={summary}>
      <h1 className="sr-only">Fright Fest 2026: the Arcade Hall</h1>
      <div className="hl-stage">
      <div className="hl-wall" aria-hidden="true" />
      <div className="hl-room">
        <div className="hl-art" aria-hidden="true" />
        {DESK.loops.map((l) => (
          <LoopStrip key={l.file} loop={l} scene="desk" />
        ))}
        {PHONE.loops.map((l) => (
          <LoopStrip key={l.file} loop={l} scene="phone" />
        ))}

        <Eggs />
        <Ticker />
        <Board fit="room" />
        <BoardGlimpse />

        {/* The noticeboard. Open: a link to #candy, "Candy Hunt" from the server and the status words from the client clock. Not open: a sign, not a link, and not focusable. */}
        <div className="hl-quest" data-in="desk" style={placeVars(DESK.quest.calm, null)}>
          {CANDY_HUNT_OPEN && candy ? (
            <a className="hl-quest-link" href="#candy">
              Candy Hunt
              <CandyStatus dates={candy.dates} labels={candy.labels} />
            </a>
          ) : (
            <span className="hl-quest-soon">Candy Hunt · soon</span>
          )}
        </div>

        <Cabinets />

        {/* The prize counter: straight to the Pack Room, on the laptop door and the phone's sliver of it. */}
        <Link
          href="/packs"
          className="hl-door"
          data-in="desk"
          aria-label="The prize counter: go to the Pack Room"
          style={placeVars(PRIZE_DOOR, null)}
        >
          <span className="hl-door-label" aria-hidden="true">
            Pack Room
          </span>
        </Link>
        <Link
          href="/packs"
          className="hl-door hl-door-glimpse"
          data-in="phone"
          aria-label="The prize counter: go to the Pack Room"
          style={placeVars(null, PHONE.prizeGlimpse)}
        />

        <Panel variant="room" />
        <PhoneNav />
      </div>
      </div>

      {/* On a phone the room is a picture and a switch; the words go under it. */}
      <div className="hl-below" data-in="phone">
        <Panel variant="card" />
        <Board fit="card" />
        <Link href="/packs" className="hl-below-link">
          The prize counter: the Pack Room
        </Link>
      </div>
    </HallProvider>
  );
}
