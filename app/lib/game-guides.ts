import type { FaqEntry } from "@/app/lib/faq";

/**
 * HallPass — hand-verified "how to play" content, per game.
 *
 * The generic copy on a store page (the four templated FAQs, the one-line
 * description) cannot say what a game's objective or controls ARE, and search
 * engines and players both need that. This is where it lives.
 *
 * ── EVERY ENTRY MUST HAVE BEEN CHECKED AGAINST THE GAME ───────────────────
 * Controls and rules asserted here are claims a player will test within seconds.
 * An entry is added only after someone has read the game's source or played it,
 * the same standard `app/lib/faq.ts` holds its answers to. A game with no entry
 * simply renders no "How to play" section — never a guess.
 *
 * Keyed by slug and independent of the database, so it covers static, uploaded
 * and external games alike and needs no migration. PURE and free of
 * `server-only`: the store page renders it in the browser and the route marks
 * up the FAQ entries on the server.
 */
export type GameGuide = {
  /** What you are trying to do, and how a run ends. */
  objective: string;
  /** One row per input: the key or gesture, and what it does. */
  controls: { input: string; action: string }[];
  /** Short, specific advice learned from playing it. */
  tips: string[];
  /** Questions specific to THIS game; rendered and marked up with the generic ones. */
  faq?: FaqEntry[];
};

const GUIDES: Record<string, GameGuide> = {};

/** The verified guide for a game, or `null` when it has none yet. */
export function gameGuide(slug: string): GameGuide | null {
  return Object.hasOwn(GUIDES, slug) ? GUIDES[slug] : null;
}
