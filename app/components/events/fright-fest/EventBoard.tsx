import Link from "next/link";
import type { Game } from "../../../lib/games";
import { FRIGHT_FEST_THEME } from "../../../lib/events/fright-fest";
import { eventDateLabels } from "../../../lib/events/labels";

const LABELS = eventDateLabels(FRIGHT_FEST_THEME);
import { FRIGHT_FEST_GAMES } from "./registry";

/**
 * The Fright Fest card on the homepage, in the artifact's "upcoming" state. It is
 * part of the THEME: it never reads the championship flag, so the haunted site
 * looks the same whether or not a competition exists. No standings, no Enter or
 * Leaderboards buttons, no "live" wording, and the prize block names no prize
 * ("Exclusive champion rewards / Details coming soon"). When a championship
 * ships, its live surface is a separate component that replaces this slot; this
 * file must not grow a dependency on it.
 *
 * Rendered for everyone and hidden by globals.css (`ha-deco`) unless the skin is
 * painting; it holds no state and does not read the clock.
 */
const ORD = ["1ST", "2ND", "3RD"];

export function EventBoard({ phone = false }: { phone?: boolean }) {

  return (
    <section className={`ha-deco ${phone ? "ha-ph-board" : "ha-board-sec"}`} aria-label="Fright Fest championship">
      <div className={`ha-board${phone ? " ph" : ""}`}>
        <div className="hb-mq">
          <span className="hb-t">
            <span aria-hidden="true" className="ha-spr ha-s-trophy" />
            Fright Fest championship
          </span>
          <span className="hb-end">{LABELS.range}</span>
        </div>
        <div className="hb-grid">
          <div className="hb-col">
            <p className="hb-k">How it will work</p>
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
                  <b>Aim for the top of the board.</b>
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
            <><b>Play the three games</b> and aim for the top of the board. Details to follow.</>
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
              <Link href="/fright-fest" className="ha-btn" prefetch={false}>
                  See how it works
                </Link>
            </div>
          </div>
          <div className="hb-scr">
            <div className="hb-h">
              <span>Standings</span>
              <span className="hb-cd">Coming soon</span>
            </div>
            <ol className="hb-rows hb-empty">
                {ORD.map((o) => (
                  <li key={o}>
                    <span className="r">{o}</span>
                    <span>???</span>
                    <span className="p">-----</span>
                  </li>
                ))}
              </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
