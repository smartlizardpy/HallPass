/**
 * /fright-fest. STATIC: no clock, no cookies, no headers. The phase line is a
 * client island (FrightFestPhase); the server output is identical for everyone
 * and for every date, so the page never 404s after the event. The championship
 * is not built: while `championshipEnabled()` is false this says "coming soon"
 * and shows no standings, buttons or prize promises.
 */
import type { Metadata } from "next";
import { ArcadeShell } from "../components/ArcadeShell";
import { FRIGHT_FEST_THEME } from "../lib/events/fright-fest";
import { eventDateLabels } from "../lib/events/labels";
import { resolveGames } from "../lib/games-store";
import { FrightFestCountdown } from "./FrightFestCountdown";
import { FrightFestPhase } from "./FrightFestPhase";

const L = eventDateLabels(FRIGHT_FEST_THEME);

export const metadata: Metadata = {
  title: "Fright Fest 2026",
  description:
    `Fright Fest 2026 on HallPass: a haunted arcade, ${L.startShort} to ${L.endShort} (UK), with three spooky games.`,
  alternates: { canonical: "/fright-fest" },
};

export default async function FrightFestPage() {
  const all = await resolveGames();
  const categories = Array.from(new Set(all.map((g) => g.category)));

  return (
    <ArcadeShell games={all} categories={categories} activeCategory="">
      <div className="ff-page mx-auto w-full max-w-4xl px-3 pb-12 pt-4 sm:px-8">
        <section id="rules" className="ff-scene space-y-3 rounded-2xl border border-border p-6 text-center sm:p-10">
          <span aria-hidden="true" className="ha-deco ff-moon ha-spr" />
          <span aria-hidden="true" className="ha-deco ff-bat ha-spr" />
          <span aria-hidden="true" className="ha-deco ff-ghost ha-spr" />
          <p className="ff-kicker text-sm font-bold uppercase tracking-widest text-muted">HallPass presents</p>
          <h1 className="ff-title text-4xl font-bold sm:text-6xl">Fright Fest 2026</h1>
          <FrightFestPhase />
          <FrightFestCountdown />
          <p className="ff-small text-sm text-muted">Games, scoring and rewards: to be announced.</p>
          <span aria-hidden="true" className="ha-deco ff-ground">
            <i className="ff-trees" />
            <i className="ff-pumpkin" />
            <i className="ff-fence" />
          </span>
        </section>
      </div>
    </ArcadeShell>
  );
}
