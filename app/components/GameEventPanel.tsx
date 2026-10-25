import { championshipEnabled } from "../lib/events/championship";

/**
 * Fright Fest furniture for the three competition games' store pages: a mode chip
 * beside the title and a small event panel in the rail. Everything here is
 * `ha-deco` (hidden for everyone by globals.css, shown only under the haunted
 * skin), and it is a server-safe, clock-free component: it reads no time, only the
 * championship flag.
 *
 * The competition is not built. While `championshipEnabled()` is false the panel
 * says so plainly and offers nothing to press, no scores and no board link.
 */

const EVENT_GAMES: Record<string, { mode: string }> = {
  "last-bell": { mode: "The Halloween Shift" },
  "shadow-core-halloween-dash": { mode: "Cursed Dash" },
  "survive-till-dawn-pixel-edition": { mode: "Blood Moon" },
};

export function eventModeFor(slug: string): string | null {
  return EVENT_GAMES[slug]?.mode ?? null;
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
        <b>Fright Fest mode: {mode}.</b>{" "}
        {championshipEnabled()
          ? "This is one of the Fright Fest games."
          : "Competition coming soon. Nothing is scored or ranked yet, so just play."}
      </p>
    </aside>
  );
}
