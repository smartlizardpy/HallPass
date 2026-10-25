import { FRIGHT_FEST_GAMES_ANNOUNCED } from "../components/events/fright-fest/registry";
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
import { FRIGHT_FEST_THEME } from "../lib/events/fright-fest";
import { eventDateLabels } from "../lib/events/labels";
import { resolveGames } from "../lib/games-store";
import Link from "next/link";
import { FrightFestGames } from "./FrightFestGames";
import { FrightFestPhase } from "./FrightFestPhase";

const L = eventDateLabels(FRIGHT_FEST_THEME);

export const metadata: Metadata = {
  title: "Fright Fest 2026",
  description:
    `Fright Fest 2026 on HallPass: a haunted arcade, ${L.startShort} to ${L.endShort} (UK), with three spooky games.`,
  alternates: { canonical: "/fright-fest" },
};

const COMPETITION_SLUGS = [
  "last-bell",
  "shadow-core-halloween-dash",
  "survive-till-dawn-pixel-edition",
];

const STEPS = [
  { n: "1", h: "Find the cabinets", p: "Three games are haunting the arcade for the weekend." },
  { n: "2", h: "Play after dark", p: "Jump into any of them straight from HallPass. No downloads, no sign-up needed to play." },
  { n: "3", h: "Aim for the top", p: "Scoring and standings are still being finalised. Details to follow." },
];

export default async function FrightFestPage() {
  const all = await resolveGames();
  const featured = COMPETITION_SLUGS.map((s) => all.find((g) => g.slug === s)).filter(
    (g): g is NonNullable<typeof g> => Boolean(g),
  );
  const afterDark = all
    .filter((g) => /horror|spooky|halloween/i.test(`${g.category} ${g.title}`) && !COMPETITION_SLUGS.includes(g.slug))
    .slice(0, 6);
  const categories = Array.from(new Set(all.map((g) => g.category)));
  const open = championshipEnabled();

  return (
    <ArcadeShell games={all} categories={categories} activeCategory="">
      <div className="ff-page mx-auto w-full max-w-4xl space-y-10 px-3 pb-12 pt-4 sm:px-8">
        <header className="ff-hero space-y-3">
          <span aria-hidden="true" className="ha-deco ff-moon ha-spr" />
          <span aria-hidden="true" className="ha-deco ff-bat ha-spr" />
          <p className="ff-kicker text-sm font-bold uppercase tracking-widest text-muted">HallPass presents</p>
          <h1 className="ff-title text-4xl font-bold sm:text-5xl">Fright Fest 2026</h1>
          <p className="text-lg">
            <b>The arcade stays open after dark.</b> {L.range} (UK).
          </p>
          <FrightFestPhase />
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/category/horror" className="ff-cta inline-flex items-center rounded-lg bg-brand px-4 py-2.5 font-bold text-white" prefetch={false}>
              Play something spooky now
            </Link>
            <a href="#rules" className="ff-ghost-link">
              Competition rules
            </a>
          </div>
        </header>

        <section aria-labelledby="ff-games" className="space-y-3">
          <h2 id="ff-games" className="ff-h text-xl font-semibold">
            The three cabinets
          </h2>
          {FRIGHT_FEST_GAMES_ANNOUNCED ? (
            <FrightFestGames games={featured} />
          ) : (
            <ul className="ff-mystery grid grid-cols-1 gap-4 sm:grid-cols-3">
              {["First cabinet", "Second cabinet", "Third cabinet"].map((n) => (
                <li key={n} className="ff-cab flex flex-col items-center gap-1 rounded-xl border border-border p-4 text-center">
                  <span aria-hidden="true" className="ha-deco ff-ghost ha-spr" />
                  <b className="ff-q" aria-hidden="true">
                    ???
                  </b>
                  <span className="font-semibold">{n}</span>
                  <span className="text-sm text-muted">To be announced</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ff-how" className="space-y-3">
          <h2 id="ff-how" className="ff-h text-xl font-semibold">
            How it will work
          </h2>
          <ol className="ff-steps grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STEPS.map((st) => (
              <li key={st.n} className="ff-step flex flex-col gap-1 rounded-xl border border-border p-4">
                <span className="ff-n" aria-hidden="true">
                  {st.n}
                </span>
                <b>{st.h}</b>
                <span className="text-sm text-muted">{st.p}</span>
              </li>
            ))}
          </ol>
          {open ? (
            <p>The competition is open. See the rules below.</p>
          ) : (
            <p className="text-muted">The competition is coming soon. Nothing is scored or ranked yet.</p>
          )}
        </section>

        <section aria-labelledby="ff-rewards" className="ff-prize space-y-2">
          <span aria-hidden="true" className="ha-deco ff-box ha-spr" />
          <h2 id="ff-rewards" className="ff-h text-xl font-semibold">
            Champion rewards
          </h2>
          <p>Exclusive champion rewards. Details coming soon.</p>
        </section>

        {afterDark.length > 0 && (
          <section aria-labelledby="ff-dark" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="ff-dark" className="ff-h text-xl font-semibold">
                Good after dark
              </h2>
              <Link href="/category/horror" className="text-sm font-semibold underline" prefetch={false}>
                All horror games
              </Link>
            </div>
            <FrightFestGames games={afterDark} />
          </section>
        )}

        <section id="rules" aria-labelledby="ff-rules" className="scroll-mt-20 space-y-2">
          <h2 id="ff-rules" className="ff-h text-xl font-semibold">
            Competition rules
          </h2>
          <p>The full rules will be published before the competition opens.</p>
        </section>
      </div>
    </ArcadeShell>
  );
}
