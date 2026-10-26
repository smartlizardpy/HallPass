"use client";

/**
 * The homepage championship card, while a championship is ENABLED. It replaces
 * the theme's `EventBoard` in the same slot (the homepage picks one or the
 * other; neither imports the other) and keeps the approved card's markup and
 * classes: the marquee, "How to win", the reward block and the standings
 * screen. What changes is the copy, which is now true, and the screen, which
 * shows the real top three.
 *
 * Like `EventBoard` it is `ha-deco`: part of the haunted homepage, hidden when
 * the skin is not painting. With the skin off the championship still lives on
 * /fright-fest and on each game's page (docs/championship-design.md §9).
 *
 * DATA. Nothing is fetched until the card is near the viewport (`useInView`; a
 * hidden card never intersects), then one CDN-cached request. Until it answers,
 * the screen shows the empty rows. Nothing is invented: no sample names, no
 * counts. Rewards are digital collectible packs; nothing is posted to anyone.
 */

import Link from "next/link";
import { ordinal } from "@/app/lib/championship/format";
import { clockPhase, type ChampionshipSummary } from "@/app/lib/championship/summary";
import type { ChampionshipPhase } from "@/app/lib/championship/types";
import { useChampionship, useInView, useMinute } from "./data";

const ORD = ["1ST", "2ND", "3RD"];

function screenStatus(phase: ChampionshipPhase | null, s: ChampionshipSummary): string {
  switch (phase) {
    case "upcoming":
      return `Opens ${s.labels.opensDay}`;
    case "live":
      return "Live";
    case "closed":
    case "verification":
      return "Being checked";
    case "finalised":
    case "archived":
      return "Final";
    case "suspended":
      return "Paused";
    default:
      return "";
  }
}

export function ChampionshipHomeCard({ summary: s, phone = false }: { summary: ChampionshipSummary; phone?: boolean }) {
  const [ref, seen] = useInView<HTMLElement>();
  const { data } = useChampionship(s.id, seen);
  const now = useMinute();
  const phase: ChampionshipPhase | null = data?.available ? data.phase : now === null ? null : clockPhase(s, now);
  const overall = data?.standings?.overall ?? [];
  const boards = data?.standings?.boards ?? [];
  const top = overall.slice(0, 3);
  const open = phase === "live";
  const over = phase === "finalised" || phase === "archived";

  return (
    <section ref={ref} className={`ha-deco ${phone ? "ha-ph-board" : "ha-board-sec"}`} aria-label={`${s.title} championship`}>
      <div className={`ha-board${phone ? " ph" : ""}`}>
        <div className="hb-mq">
          <span className="hb-t">
            <span aria-hidden="true" className="ha-spr ha-s-trophy" />
            Fright Fest championship
          </span>
          <span className="hb-end">{open ? `Ends ${s.labels.lastMinute} UK` : s.labels.range}</span>
        </div>
        <div className="hb-grid">
          <div className="hb-col">
            <p className="hb-k">How to win</p>
            <ol className="hb-how">
              <li>
                <b>1</b>
                <p>
                  <b>Sign in and play</b> the Fright Fest modes.
                </p>
              </li>
              <li>
                <b>2</b>
                <p>
                  <b>Earn Fright Points.</b> Your best run in each game counts.
                </p>
              </li>
              <li>
                <b>3</b>
                <p>
                  <b>Top the table on {s.labels.closesDate}</b> to become the Fright Fest champion.
                </p>
              </li>
            </ol>
          </div>
          <p className="hb-sum">
            <b>Sign in, play the Fright Fest modes, earn Fright Points,</b> and top the table to become champion.
          </p>
          <div className="hb-prize">
            <span className="ha-spr hb-sheet ha-s-prize" role="img" aria-label="A closed mystery reward box" />
            <div>
              <h3>Win HallPass collectible packs</h3>
              <p>Champions earn exclusive Champion Packs. Finish every game for a Participation Pack. Digital, and yours to keep.</p>
              <Link href={`${s.href}#rules`} className="hb-terms" prefetch={false}>
                Rules and rewards
              </Link>
            </div>
            <div className="hb-act">
              <Link href={s.href} className="ha-btn" prefetch={false}>
                {open ? "Enter Fright Fest" : over ? "See the results" : "See how it works"}
              </Link>
            </div>
          </div>
          <div className="hb-scr">
            <div className="hb-h">
              <span>{over ? "Final standings" : "Standings"}</span>
              <span className="hb-cd">{screenStatus(phase, s)}</span>
            </div>
            {top.length > 0 ? (
              <ol className="hb-rows" aria-label="Top three">
                {top.map((o) => (
                  <li key={o.publicId}>
                    <span className="r">{ORD[o.rank - 1] ?? ordinal(o.rank).toUpperCase()}</span>
                    <span className="truncate">{o.name}</span>
                    <span className="p">{o.points.toLocaleString("en-GB")}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <>
                <ol className="hb-rows hb-empty" aria-hidden="true">
                  {ORD.map((o) => (
                    <li key={o}>
                      <span className="r">{o}</span>
                      <span>???</span>
                      <span className="p">-----</span>
                    </li>
                  ))}
                </ol>
                {data?.available && open && <p className="hb-none">No runs yet. Be the first on the board.</p>}
              </>
            )}
            {boards.length > 0 && (
              <p className="hb-boards">
                Game boards:{" "}
                {boards.map((b, i) => (
                  <span key={b.slug}>
                    {i > 0 && " · "}
                    <Link href={`${s.href}#board-${b.slug}`} prefetch={false}>
                      {b.title}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
