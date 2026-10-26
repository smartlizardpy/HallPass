/**
 * HallPass Scoreboard — the event SEASON: the window in which a game's board
 * counts only the scores posted inside it.
 *
 * ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 * During Fright Fest every PLAYER-FACING read of a game's board (the top scores,
 * the rank returned by a submit, the friends panel, "a friend passed you")
 * ignores scores older than `from`. Nothing is deleted: the rows stay, and every
 * admin, moderation and profile read still sees all-time. Outside the window
 * everything is exactly as it always was.
 *
 * ── THE DATABASE DECIDES WHETHER IT IS OPEN ────────────────────────────────
 * This module is data plus one pure helper. The store never asks the app clock
 * whether the window is open; it binds `from`/`until` and lets Postgres compare
 * them with its own `now()`, in the one expression documented in `store.ts`.
 * That is the championship's rule too: a wrong device or server clock cannot
 * flip a board. {@link seasonFloor} below is the in-memory mirror of that SQL,
 * for tests and for reasoning, not something a query depends on.
 *
 * ── WHY THE DATES ARE REPEATED HERE ────────────────────────────────────────
 * They equal the championship's `opensAt`/`closesAt`
 * (`championship/fright-fest-2026.ts`) and candy's earning window. They are NOT
 * imported from there: that config carries the anti-cheat validators, and the
 * scoreboard is the lower layer. `season.test.ts` asserts the three agree, so
 * moving the event means editing all of them and the test says which one you
 * missed.
 */

/** A window in which boards count only scores posted inside it. */
export interface Season {
  id: string;
  /** ISO UTC, inclusive: the first instant that counts. */
  from: string;
  /** ISO UTC, exclusive: from this instant boards are all-time again. */
  until: string;
}

/** Fright Fest 2026: 28 Oct 00:00 UK to 2 Nov 00:00 UK (UTC offset 0 then). */
export const FRIGHT_FEST_SEASON: Season = {
  id: "fright-fest-2026",
  from: "2026-10-28T00:00:00Z",
  until: "2026-11-02T00:00:00Z",
};

/**
 * The earliest `created_at` a player-facing read counts at `now`: the season's
 * `from` while it is open, else `null` (no floor, i.e. all-time). Pure mirror of
 * the SQL expression in `store.ts`.
 */
export function seasonFloor(season: Season, now: Date): Date | null {
  const from = new Date(season.from).getTime();
  const until = new Date(season.until).getTime();
  const t = now.getTime();
  return t >= from && t < until ? new Date(from) : null;
}
