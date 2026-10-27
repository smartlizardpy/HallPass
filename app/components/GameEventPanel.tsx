import { frightFestGame } from "./events/fright-fest/registry";

/**
 * Fright Fest furniture for the three competition games' store pages: a mode chip
 * beside the title and a small event panel in the rail. Everything here is
 * `ha-deco` (hidden for everyone by globals.css, shown only under the haunted
 * skin), and it is a server-safe, clock-free component: it reads neither the
 * time nor the championship flag.
 *
 * It describes the MODE only, in words that stay true whether or not a
 * competition is running: no scores, no ranks, no board link. A running
 * championship has its own panel beside this one (`championship/GamePanel`),
 * which the page adds; this file never learns whether it exists.
 */

const EVENT_GAMES: Record<string, { mode: string }> = {
  "last-bell": { mode: "The Halloween Shift" },
  "scp-lockdown": { mode: "The Haunting" },
  "survive-till-dawn-pixel-edition": { mode: "Blood Moon" },
};

export function eventModeFor(slug: string): string | null {
  return frightFestGame(slug) ? (EVENT_GAMES[slug]?.mode ?? null) : null;
}

/** The chip (and, on Last Bell only, the Room 000 plaque) next to the title. */
export function GameModeChip({ slug }: { slug: string }) {
  const mode = eventModeFor(slug);
  if (!mode) return null;
  return (
    <>
      <span className="ha-deco ha-mode-chip">
        <span aria-hidden="true" className="ha-spr ha-mode-chip-ico" />
        Fright Fest mode: {mode}
      </span>
      {slug === "last-bell" && (
        <span aria-hidden="true" className="ha-deco ha-spr ha-plaque" />
      )}
    </>
  );
}

/** The panel in the rail, under Play. No buttons, no links, no scores. */
export function GameEventPanel({ slug }: { slug: string }) {
  const mode = eventModeFor(slug);
  if (!mode) return null;
  return (
    <aside className="ha-deco ha-evp" aria-label="Fright Fest">
      <div className="ha-evp-mq">
        <span aria-hidden="true" className="ha-spr ha-evp-ico" />
        Fright Fest · {mode}
      </div>
      <p>
        <b>Fright Fest mode: {mode}.</b> Pick it from the game&apos;s menu while the arcade is haunted.
      </p>
    </aside>
  );
}
