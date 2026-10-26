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
 * Drawn as design A's arcade (hall/sections.css, `.ar-*`): the LED phase strip, the CRT
 * high-score board with "Your Fright Fest" as its footer, the prize counter, and a paper
 * notice for the rules. Fixed palette, no base tokens; the order is design A's, with
 * Candy Hunt (the `afterProgress` slot) as the last object.
 */

import Link from "next/link";
import { pointBands, type ChampionshipSummary } from "@/app/lib/championship/summary";
import { ordinal } from "@/app/lib/championship/format";
import type { RewardProps } from "@/app/lib/championship/reward-view";
import { MyChampionship } from "./MyProgress";
import { PhaseBanner } from "./PhaseBanner";
import { ChampionshipStandings } from "./Standings";

/**
 * `rewards` is built on the server from the config's pack ids (fright-fest/hall/props.ts),
 * for announced games only, so this file never sees a game that has not been announced.
 */
export function FrightFestSections({
  summary: s,
  rewards,
  afterProgress,
}: {
  summary: ChampionshipSummary;
  rewards: RewardProps[];
  /**
   * A slot after the rules notice. The page fills it (with Candy Hunt), so this
   * file imports nothing about candy.
   */
  afterProgress?: React.ReactNode;
}) {
  const bands = pointBands(s);
  return (
    <div className="ar-stack">
      <PhaseBanner summary={s} />
      <ChampionshipStandings summary={s}>
        <MyChampionship summary={s} />
      </ChampionshipStandings>

      <section id="rewards" aria-labelledby="rewards-h" className="ar-sec ar-prize">
        <div className="ar-head">
          <h2 id="rewards-h">The prize counter</h2>
        </div>
        <div className="ar-walkup">
          <div className="ar-booth" aria-hidden="true" />
          <div className="ar-walkup-text">
            <p>Packs you win wait for you at the prize counter, in the Pack Room.</p>
            <Link href="/packs" className="ar-btn ar-btn-gold">
              Walk to the prize counter
            </Link>
          </div>
        </div>

        <h3 className="ar-sub">Fright Fest rewards</h3>
        <p className="ar-lede">
          Rewards are HallPass collectible packs: digital, free, and yours to keep after Halloween. Nothing is sold and nothing is posted.
          One player can earn several. Packs are given out once the results are final.
        </p>
        <ul className="ar-tickets">
          {rewards.map((r) => (
            <li key={r.packId} className="ar-ticket">
              {/* eslint-disable-next-line @next/next/no-img-element -- a 96x140 pixel print; next/image would smooth it */}
              <img src={r.print} alt="" width={96} height={140} loading="lazy" className="hl-print ar-print" />
              <div className="min-w-0">
                <b className="ar-ticket-name">{r.name}</b>
                <span className="ar-ticket-who">{r.who}</span>
                <ul className="ar-slots">
                  {r.slots.map((sl, i) => (
                    <li key={i}>
                      {sl.kind === "fixed" ? (
                        <>
                          <span className="ar-chip">Guaranteed</span> {sl.card}
                          {sl.rarity ? ` (${sl.rarity})` : ""}
                        </>
                      ) : (
                        <span className="ar-chip ar-chip-rand">1 random card</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
        <p className="ar-note">Random cards are drawn at the published odds. There is no prize for second place.</p>
        <Link href="/packs#pack-odds" className="ar-link">
          Odds for the random cards
        </Link>
      </section>

      <section id="rules" aria-labelledby="rules-h" className="ar-sec ar-paper">
        <div className="ar-head">
          <h2 id="rules-h">How Fright Points work</h2>
        </div>
        <div className="ar-paper-grid">
          <div>
            <p>Your rank on each game&apos;s board earns Fright Points. Every game is worth the same, so no single game decides it.</p>
            <table className="ar-ptbl">
              <caption className="sr-only">Fright Points by rank on a game board</caption>
              <thead>
                <tr>
                  <th scope="col">Rank on a board</th>
                  <th scope="col" className="ar-num">Points</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.from}>
                    <td>{b.to === null ? `${ordinal(b.from)} and below` : b.to === b.from ? ordinal(b.from) : `${ordinal(b.from)} to ${ordinal(b.to)}`}</td>
                    <td className="ar-num">{b.points}</td>
                  </tr>
                ))}
                <tr>
                  <td>No result</td>
                  <td className="ar-num">0</td>
                </tr>
              </tbody>
            </table>
            <p>
              Your total is the sum across every game in the championship. Ties on the overall table go to results on more games, then
              better best placings (a 1st beats a 2nd), then whoever reached their total first.
            </p>
          </div>
          <ul className="ar-rules">
            <li id="schedule">
              <b>When:</b> ranked runs count from {s.labels.opens} to {s.labels.lastMinute} UK time. A run you started before the close has{" "}
              {s.submitGraceMin} more minutes to finish. Results are checked after the close and final by {s.labels.resultsBy} UK time.
              Times are the server&apos;s, never your device&apos;s clock. A game that joins later counts from the moment it joins.
            </li>
            <li>
              <b>Who:</b> anyone signed in to HallPass. Guests can play the Fright Fest modes, but their runs are not ranked.
            </li>
            <li>
              <b>Names:</b> the board shows your HallPass handle or @username, never your real name or photo.
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
              <b>Each game&apos;s ranking rule</b> (what counts, and how ties are split) is on its tab in the high scores. More
              games join when their Fright Fest modes are verified.
            </li>
          </ul>
        </div>
      </section>

      {afterProgress}
    </div>
  );
}
