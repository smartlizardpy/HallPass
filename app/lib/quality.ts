/**
 * HallPass — a game's QUALITY, as rated by a super admin.
 *
 * PURE and free of server imports, so the dashboard form, the store, the
 * for-you ranking and the catalogue sort all share one definition and one set
 * of tests.
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────
 * A super admin scores a game 1-10 on {@link QUALITY_CRITERIA}. The game's
 * quality is the plain average of the criteria that HAVE been scored, so a game
 * rated only on gameplay is not dragged down by an empty sound box. It is
 * editorial opinion about a game and says nothing about any player.
 *
 * ── WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────────────
 *   * NOT A FILTER. It only nudges the order of listings that already hold every
 *     game (see `catalog-order.ts`); a poorly rated game is ranked lower, never
 *     hidden — the catalogue's standing rule is that membership is identical for
 *     everyone.
 *   * NOT A PENALTY FOR BEING UNRATED. A game nobody has rated reads as
 *     {@link NEUTRAL_QUALITY} — the middle of the scale — so a brand-new game is
 *     neither buried nor lifted until someone has judged it.
 *   * NOT A TRUMP CARD. {@link qualityBoost} is bounded and small beside a
 *     player's own taste (`for-you.ts`): a loved genre still beats a 10/10 game
 *     the player has shown no interest in.
 */

export const QUALITY_CRITERIA = [
  { key: "gameplay", label: "Gameplay" },
  { key: "visuals", label: "Visuals" },
  { key: "sound", label: "Sound" },
  { key: "polish", label: "Polish" },
  { key: "fun", label: "Fun" },
] as const;

export type QualityKey = (typeof QUALITY_CRITERIA)[number]["key"];

/** One 1-10 score per criterion; `null` (or absent) = not rated on that one. */
export type QualityScores = Record<QualityKey, number | null>;

export const MIN_SCORE = 1;
export const MAX_SCORE = 10;

/** What an unrated game counts as: the middle of 1-10. */
export const NEUTRAL_QUALITY = (MIN_SCORE + MAX_SCORE) / 2;

/** A set of ratings with nothing rated. */
export function emptyScores(): QualityScores {
  return { gameplay: null, visuals: null, sound: null, polish: null, fun: null };
}

/**
 * Narrow an untrusted value (a form field, a database cell) to a whole score in
 * 1-10, or `null` for anything else — including the empty string, which is how
 * the dashboard form says "not rated".
 */
export function toScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= MIN_SCORE && n <= MAX_SCORE ? n : null;
}

/** The average of the rated criteria to one decimal place, or `null` if none is rated. */
export function overallQuality(scores: Partial<Record<QualityKey, number | null>>): number | null {
  const rated = QUALITY_CRITERIA.map((c) => toScore(scores[c.key])).filter(
    (n): n is number => n !== null,
  );
  if (rated.length === 0) return null;
  const mean = rated.reduce((sum, n) => sum + n, 0) / rated.length;
  return Math.round(mean * 10) / 10;
}

/** `quality` as the ranking sees it: the rating, or neutral when there is none. */
export function effectiveQuality(quality: number | null | undefined): number {
  return typeof quality === "number" && Number.isFinite(quality)
    ? Math.min(MAX_SCORE, Math.max(MIN_SCORE, quality))
    : NEUTRAL_QUALITY;
}

/**
 * How much quality moves a game's for-you score at the extremes. Chosen to sit
 * well under the category-affinity term (1.2) and the player's own favourites,
 * and a little above the "new" nudge (0.35) at the top of the scale, so it breaks
 * ties between similarly relevant games without ever outranking a taste match.
 */
export const W_QUALITY = 0.4;

/** In [-W_QUALITY, +W_QUALITY]: 0 for neutral, positive above, negative below. */
export function qualityBoost(quality: number | null | undefined): number {
  const half = (MAX_SCORE - MIN_SCORE) / 2;
  return (W_QUALITY * (effectiveQuality(quality) - NEUTRAL_QUALITY)) / half;
}
