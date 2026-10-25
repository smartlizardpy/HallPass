import Link from "next/link";
import type { Game } from "../../../lib/games";
import { championshipEnabled } from "../../../lib/events/championship";
import { FRIGHT_FEST_THEME } from "../../../lib/events/fright-fest";
import { eventDateLabels } from "../../../lib/events/labels";

const LABELS = eventDateLabels(FRIGHT_FEST_THEME);
import { FRIGHT_FEST_GAMES } from "./registry";

/**
 * The championship card on the homepage. The ONE theme-adjacent component that
 * reads the championship flag, because it is the competition's own surface.
 *
 * While the competition is not enabled it is the artifact's "upcoming" state:
 * no standings, no Enter / Leaderboards buttons, no "live" wording, and the
 * prize block names no prize ("Exclusive champion rewards / Details coming
 * soon"). When enabled it renders the live layout, still with NO invented data:
 * the standings are an empty state until real scores exist. Nothing here ever
 * promises a physical prize.
 *
 * Rendered for everyone and hidden by globals.css (`ha-deco`) unless the skin is
 * painting; it holds no state and does not read the clock.
 */
const ORD = ["1ST", "2ND", "3RD"];

export function ChampionshipBoard({ games, phone = false }: { games: Game[]; phone?: boolean }) {
  const live = championshipEnabled();
  const known = FRIGHT_FEST_GAMES.map((ff) => ({ ff, game: games.find((g) => g.slug === ff.slug) })).filter(
    (c): c is { ff: (typeof FRIGHT_FEST_GAMES)[number]; game: Game } => Boolean(c.game),
  );

  return (
    <section className={`ha-deco ${phone ? "ha-ph-board" : "ha-board-sec"}`} aria-label="Fright Fest championship">
      <div className={`ha-board${phone ? " ph" : ""}`}>
        <div className="hb-mq">
          <span className="hb-t">
            <span aria-hidden="true" className="ha-spr ha-s-trophy" />
            Fright Fest championship
          </span>
          <span className="hb-end">{live ? `Ends ${LABELS.endsAt}` : LABELS.range}</span>
        </div>
        <div className="hb-grid">
          <div className="hb-col">
            <p className="hb-k">{live ? "How to win" : "How it will work"}</p>
            <ol className="hb-how">
              <li>
                <b>1</b>
                <p>
                  <b>Play the three games</b> in their Halloween modes.
                </p>
              </li>
              <li>
                <b>2</b>
                <p>
                  <b>{live ? "Compete for Fright Points." : "Aim for the top of the board."}</b>
                </p>
              </li>
              <li>
                <b>3</b>
                <p>
                  <b>Top the board</b> to become the Fright Fest champion.
                </p>
              </li>
            </ol>
          </div>
          <p className="hb-sum">
            {live ? (
              <><b>Play the three games, compete for Fright Points,</b> and top the board to become champion.</>
            ) : (
              <><b>Play the three games</b> and aim for the top of the board. Details to follow.</>
            )}
          </p>
          <div className="hb-prize">
            <span className="ha-spr hb-sheet ha-s-prize" role="img" aria-label="A closed mystery reward box" />
            <div>
              <h3>Exclusive champion rewards</h3>
              <p>Details coming soon.</p>
              <Link href="/fright-fest#rules" className="hb-terms" prefetch={false}>
                Competition rules
              </Link>
            </div>
            <div className="hb-act">
              {live ? (
                <>
                  <Link href="/fright-fest" className="ha-btn" prefetch={false}>
                    Enter Fright Fest
                  </Link>
                  <Link href="/fright-fest#leaderboards" className="ha-link" prefetch={false}>
                    Full leaderboards
                  </Link>
                </>
              ) : (
                <Link href="/fright-fest" className="ha-btn" prefetch={false}>
                  See how it works
                </Link>
              )}
            </div>
          </div>
          <div className="hb-scr">
            <div className="hb-h">
              <span>Standings</span>
              {!live && <span className="hb-cd">Coming soon</span>}
            </div>
            {live ? (
              <p className="hb-none">Standings appear when the first scores are in</p>
            ) : (
              <ol className="hb-rows hb-empty">
                {ORD.map((o) => (
                  <li key={o}>
                    <span className="r">{o}</span>
                    <span>???</span>
                    <span className="p">-----</span>
                  </li>
                ))}
              </ol>
            )}
            {live && known.length > 0 && (
              <p className="hb-boards">
                Game boards:{" "}
                {known.map(({ ff, game }, i) => (
                  <span key={ff.slug}>
                    {i > 0 && " · "}
                    <Link href={`/game/${game.slug}`} prefetch={false}>
                      {game.title}
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
