/**
 * /fright-fest. STATIC: no clock, no cookies, no headers. The phase line is a
 * client island (FrightFestPhase); the server output is identical for everyone
 * and for every date, so the page never 404s after the event.
 *
 * The approved night scene is the theme's. Below it, while the championship is
 * enabled (a code constant, so the page stays static), come the championship's
 * own sections: live standings, your progress, the points table, schedule,
 * rules and rewards. While it is disabled the scene says "to be announced" and
 * nothing else is shown.
 */
import type { Metadata } from "next";
import { ArcadeShell } from "../components/ArcadeShell";
import { FRIGHT_FEST_THEME } from "../lib/events/fright-fest";
import { eventDateLabels } from "../lib/events/labels";
import { resolveGames } from "../lib/games-store";
import { FRIGHT_FEST_GAMES } from "../components/events/fright-fest/registry";
import { Room } from "./hall/Room";
import { buildCabinets } from "./hall/props";
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

  return (
    <ArcadeShell games={all} categories={categories} activeCategory="">
      <div className="w-full pb-12">
        <Room cabinets={cabinets} summary={SUMMARY} />
        <div className="ff-page mx-auto w-full max-w-4xl px-3 pt-4 sm:px-8">
          {SUMMARY ? (
            <FrightFestSections summary={SUMMARY} />
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
