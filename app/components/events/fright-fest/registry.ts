/**
 * The three Fright Fest registry games: the only catalogue games that ever look
 * like event games (cabinet frame + mode chip, hero cabinets). One list, so the
 * hero, the cards and the board cannot disagree about which games count.
 *
 * Pure data. Nothing here reads the clock, the championship flag or the DOM.
 * `data-event-game` is an inert attribute: with the skin off it styles nothing.
 */

export type FrightFestGame = {
  slug: string;
  /** Mode name, shown on the chip and in the cabinet's accessible name. */
  short: string;
  /** Cabinet marquee lines. */
  mq: [string, string];
  /** Cabinet accent colour (marquee + screen tint). */
  acc: string;
  /** Cover focal point, so the cropped cabinet screen shows the interesting part. */
  pos: string;
};

export const FRIGHT_FEST_GAMES: readonly FrightFestGame[] = [
  { slug: "last-bell", short: "Halloween Shift", mq: ["Halloween", "Shift"], acc: "#e8e3d3", pos: "center 30%" },
  { slug: "shadow-core-halloween-dash", short: "Cursed Dash", mq: ["Cursed", "Dash"], acc: "#f43f5e", pos: "center 38%" },
  { slug: "survive-till-dawn-pixel-edition", short: "Blood Moon", mq: ["Blood", "Moon"], acc: "#ff5470", pos: "center 22%" },
];

const BY_SLUG = new Map(FRIGHT_FEST_GAMES.map((g) => [g.slug, g] as const));

/** The registry entry for a catalogue slug, or undefined for every ordinary game. */
export function frightFestGame(slug: string): FrightFestGame | undefined {
  return BY_SLUG.get(slug);
}
