/**
 * The championship's part of /fright-fest, under the approved night scene.
 *
 * STATIC: rendered at build time from the championship definition, so the page
 * stays prerendered. The three live parts are client islands over the API: the
 * phase line, the standings, and the viewer's own progress. The rules text is
 * generated from the same object the server ranks with (points table, window,
 * grace), so the page and the code cannot disagree. Each game's ranking rule is
 * shown on its own board tab, which only exists once the game has joined.
 *
 * Uses base tokens only: with the haunted skin off it is an ordinary HallPass
 * page, and the skin repaints the tokens when it is on.
 */

import Link from "next/link";
import { pointBands, type ChampionshipSummary } from "@/app/lib/championship/summary";
import { ordinal } from "@/app/lib/championship/format";
import type { RewardProps } from "@/app/fright-fest/hall/props";
import { MyChampionship } from "./MyProgress";
import { PhaseBanner } from "./PhaseBanner";
import { ChampionshipStandings } from "./Standings";

function Card({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  const hid = `${id ?? title.toLowerCase().replace(/\W+/g, "-")}-h`;
  return (
    <section id={id} aria-labelledby={hid} className="hl-sec scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-6">
      <h2 id={hid} className="text-xl font-black">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground-2">{children}</div>
    </section>
  );
}

/**
 * `rewards` is built on the server from the config's pack ids (fright-fest/hall/props.ts),
 * for announced games only, so this file never sees a game that has not been announced.
 */
export function FrightFestSections({ summary: s, rewards }: { summary: ChampionshipSummary; rewards: RewardProps[] }) {
  const bands = pointBands(s);
  return (
    <div className="mt-6 space-y-6">
      <PhaseBanner summary={s} />
      <ChampionshipStandings summary={s} />
      <MyChampionship summary={s} />

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="How Fright Points work">
          <p>Your rank on each game&apos;s board earns Fright Points. Every game is worth the same, so no single game decides it.</p>
          <table className="w-full max-w-xs text-sm">
            <caption className="sr-only">Fright Points by rank on a game board</caption>
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-black uppercase tracking-wider text-muted">
                <th scope="col" className="py-1.5">Rank on a board</th>
                <th scope="col" className="py-1.5 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.from} className="border-b border-border/60">
                  <td className="py-1.5">
                    {b.to === null ? `${ordinal(b.from)} and below` : b.to === b.from ? ordinal(b.from) : `${ordinal(b.from)} to ${ordinal(b.to)}`}
                  </td>
                  <td className="py-1.5 text-right font-black tabular-nums">{b.points}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5">No result</td>
                <td className="py-1.5 text-right font-black tabular-nums">0</td>
              </tr>
            </tbody>
          </table>
          <p>
            Your total is the sum across every game in the championship. Ties on the overall table go to results on more games, then
            better best placings (a 1st beats a 2nd), then whoever reached their total first.
          </p>
        </Card>

        <Card title="When">
          <ul className="space-y-1.5">
            <li>
              <b>Ranked runs open:</b> {s.labels.opens} UK time.
            </li>
            <li>
              <b>Last ranked runs:</b> {s.labels.lastMinute} UK time. A run you started before the close has {s.submitGraceMin} more
              minutes to finish.
            </li>
            <li>
              <b>Results:</b> checked after the close and final by {s.labels.resultsBy} UK time.
            </li>
          </ul>
          <p>Times are the server&apos;s, never your device&apos;s clock. A game that joins later counts from the moment it joins.</p>
        </Card>
      </div>

      <Card id="rules" title="Rules">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>Who:</b> anyone signed in to HallPass. Guests can play the Fright Fest modes, but their runs are not ranked.
          </li>
          <li>
            <b>Names:</b> the table shows your HallPass handle or @username and your avatar, never your real name or photo.
          </li>
          <li>
            <b>Your best counts:</b> each game keeps your best run. A worse run never costs you anything.
          </li>
          <li>
            <b>Fair play:</b> play the Fright Fest mode as it comes, on your own. The server times every run and checks it.
            Runs that look impossible are not counted; unusual ones are held until a person checks them.
          </li>
          <li>
            <b>Checks and results:</b> standings are provisional until the results are checked after the close. A run can be
            disqualified, always with a reason you can see in &ldquo;Your Fright Fest&rdquo;. Staff cannot review their own runs.
          </li>
          <li>
            <b>The champion</b> is the highest-placed player with a result on every game in the championship. Others still
            appear on the table.
          </li>
          <li>
            <b>Each game&apos;s ranking rule</b> (what counts, and how ties are split) is on its tab in the standings. More
            games join when their Fright Fest modes are verified.
          </li>
        </ul>
      </Card>

      <Card id="rewards" title="Rewards">
        <p>Rewards are HallPass collectible packs: digital, free, and yours to keep after Halloween. Nothing is sold and nothing is posted.</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rewards.map((r) => (
            <li key={r.packId} className="hl-prize flex gap-3 rounded-xl bg-surface-2 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a 96x140 pixel print; next/image would smooth it */}
              <img src={r.print} alt="" width={96} height={140} loading="lazy" className="hl-print h-[140px] w-[96px] shrink-0 [image-rendering:pixelated]" />
              <div className="min-w-0">
                <b className="block text-foreground">{r.name}</b>
                <span className="block">{r.who}</span>
                <ul className="mt-2 space-y-1">
                  {r.slots.map((sl, i) => (
                    <li key={i} className="text-xs">
                      {sl.kind === "fixed" ? (
                        <>
                          <span className="font-bold text-foreground">Guaranteed:</span> {sl.card}
                          {sl.rarity ? ` (${sl.rarity})` : ""}
                        </>
                      ) : (
                        <>
                          <span className="font-bold text-foreground">Random:</span> 1 random card
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
        <p>
          Random cards are drawn at the published odds: <Link href="/packs#pack-odds" className="font-bold underline">see the odds</Link>. There is no
          prize for second place.
        </p>
        <p>One player can earn several. Packs are given out once the results are final.</p>
      </Card>
    </div>
  );
}
