/**
 * /fright-fest. STATIC: no clock, no cookies, no headers. The server output is
 * identical for everyone and for every date, so the page never 404s after the
 * event. Everything live is a client island over the shared championship fetch.
 *
 * The page is the Arcade Hall (hall/Room.tsx): a pixel-art room with the
 * cabinets, the ticker, the high-score board and the prize-counter door. Below
 * it, while the championship is enabled (a code constant, so the page stays
 * static), come the championship's own sections: live standings, your progress,
 * the points table, schedule, rules and rewards. While it is disabled the room
 * says "to be announced" and the page has nothing else.
 *
 * Candy Hunt (hall/candy/) is a section between "Your Fright Fest" and the points
 * table, passed in through the sections' `afterProgress` slot so the
 * championship components import nothing about candy; the hall's noticeboard links
 * to it.
 *
 * Props for the islands come from hall/props.ts, which keeps announced games only.
 */
import type { Metadata } from "next";
import { ArcadeShell } from "../components/ArcadeShell";
import { FRIGHT_FEST_THEME } from "../lib/events/fright-fest";
import { eventDateLabels } from "../lib/events/labels";
import { resolveGames } from "../lib/games-store";
import { FRIGHT_FEST_GAMES } from "../components/events/fright-fest/registry";
import { Room } from "./hall/Room";
import { CandyHunt } from "./hall/candy/CandyHunt";
import { buildCandy } from "./hall/candy/props";
import { CANDY_HUNT_OPEN } from "./hall/config";
import { CANDY_FRIGHT_FEST_2026 } from "../lib/candy/fright-fest-2026";
import "./hall/sections.css";
import { buildCabinets, buildRewards } from "./hall/props";
import { FrightFestSections } from "../components/championship/FrightFestSections";
import { championshipEnabled } from "../lib/championship/config";
import { FRIGHT_FEST_2026 } from "../lib/championship/fright-fest-2026";
import { championshipSummary } from "../lib/championship/summary";

const SUMMARY = championshipEnabled(FRIGHT_FEST_2026.id) ? championshipSummary(FRIGHT_FEST_2026) : null;

const L = eventDateLabels(FRIGHT_FEST_THEME);

export const metadata: Metadata = {
  title: "Fright Fest 2026",
  description: SUMMARY
    ? `Fright Fest 2026 on HallPass: a haunted arcade and a championship. Earn Fright Points in the Halloween modes, ${L.startShort} to ${L.endShort} (UK).`
    : `Fright Fest 2026 on HallPass: a haunted arcade, ${L.startShort} to ${L.endShort} (UK), with three spooky games.`,
  alternates: { canonical: "/fright-fest" },
};

export default async function FrightFestPage() {
  const all = await resolveGames();
  const categories = Array.from(new Set(all.map((g) => g.category)));
  // Plain data for the room's client islands: announced games only (hall/props.ts).
  const cabinets = buildCabinets(FRIGHT_FEST_2026, FRIGHT_FEST_GAMES, all);
  const rewards = buildRewards(FRIGHT_FEST_2026, FRIGHT_FEST_GAMES);

  // Candy Hunt needs the championship's sections to sit in, so it is on only with them.
  const candy = CANDY_HUNT_OPEN && SUMMARY ? buildCandy(CANDY_FRIGHT_FEST_2026, SUMMARY.labels.resultsBy) : null;

  return (
    <ArcadeShell games={all} categories={categories} activeCategory="">
      <div className="w-full pb-12">
        <Room cabinets={cabinets} summary={SUMMARY} candy={candy} />
        <div className="ff-page mx-auto w-full max-w-4xl px-3 pt-4 sm:px-8">
          {SUMMARY ? (
            <FrightFestSections summary={SUMMARY} rewards={rewards} afterProgress={candy ? <CandyHunt candy={candy} /> : null} />
          ) : (
            <section id="rules" className="rounded-2xl border border-border bg-surface p-6 text-center">
              <p className="text-base font-bold">Games, scoring and rewards: to be announced.</p>
            </section>
          )}
        </div>
      </div>
    </ArcadeShell>
  );
}
