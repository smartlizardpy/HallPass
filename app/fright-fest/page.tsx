/**
 * /fright-fest. STATIC: no clock, no cookies, no headers. The phase line is a
 * client island (FrightFestPhase); the server output is identical for everyone
 * and for every date, so the page never 404s after the event. The championship
 * is not built: while `championshipEnabled()` is false this says "coming soon"
 * and shows no standings, buttons or prize promises.
 */
import type { Metadata } from "next";
import { ArcadeShell } from "../components/ArcadeShell";
import { championshipEnabled } from "../lib/events/championship";
import { resolveGames } from "../lib/games-store";
import { FrightFestGames } from "./FrightFestGames";
import { FrightFestPhase } from "./FrightFestPhase";

export const metadata: Metadata = {
  title: "Fright Fest 2026",
  description:
    "Fright Fest 2026 on HallPass: a haunted arcade, 28 Oct to 31 Oct (UK), with three spooky games.",
  alternates: { canonical: "/fright-fest" },
};

const COMPETITION_SLUGS = [
  "last-bell",
  "shadow-core-halloween-dash",
  "survive-till-dawn-pixel-edition",
];

export default async function FrightFestPage() {
  const all = await resolveGames();
  const featured = COMPETITION_SLUGS.map((s) => all.find((g) => g.slug === s)).filter(
    (g): g is NonNullable<typeof g> => Boolean(g),
  );
  const categories = Array.from(new Set(all.map((g) => g.category)));
  const open = championshipEnabled();

  return (
    <ArcadeShell games={all} categories={categories} activeCategory="">
      <div className="ff-page mx-auto w-full max-w-4xl space-y-8 px-3 pb-12 pt-4 sm:px-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Fright Fest 2026</h1>
          <FrightFestPhase />
        </header>

        <section aria-labelledby="ff-games" className="space-y-3">
          <h2 id="ff-games" className="text-xl font-semibold">
            The competition games
          </h2>
          <FrightFestGames games={featured} />
        </section>

        <section aria-labelledby="ff-comp" className="space-y-3">
          <h2 id="ff-comp" className="text-xl font-semibold">
            The competition
          </h2>
          {open ? (
            <p>The competition is open. See the rules below.</p>
          ) : (
            <>
              <p>The Fright Fest competition is coming soon.</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Play the three games above.</li>
                <li>How scoring works: details coming soon.</li>
                <li>How the standings work: details coming soon.</li>
              </ol>
              <p>Exclusive champion rewards, details coming soon.</p>
            </>
          )}
        </section>

        <section id="rules" aria-labelledby="ff-rules" className="scroll-mt-20 space-y-2">
          <h2 id="ff-rules" className="text-xl font-semibold">
            Competition rules
          </h2>
          <p>The full rules will be published before the competition opens.</p>
        </section>
      </div>
    </ArcadeShell>
  );
}
