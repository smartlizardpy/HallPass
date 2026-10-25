/**
 * HallPass — the ambient "moment" budget for the haunted skin. Pure.
 *
 * Strength C plays TWO moments per page view, taken in turn from what the page
 * actually has, so moving around the site shows something different each time
 * and nothing ever moves in a crowd. One is drawn from the "primary" pool (a
 * ghost, the marquee, the bat, the moon) and one from the "extra" pool (the
 * spider, the eyes). Each moment is also capped per device per UTC day, so a
 * player who reloads all lesson never sees the same trick more than a few times.
 *
 * The DOM and timing live in `components/events/Moments.tsx`; this file only
 * decides WHICH names, so the rule is testable without a browser.
 */

/** Names match `data-ha-moment` on the decorations. Order is the rotation order. */
export const PRIMARY_MOMENTS = [
  "ghost-side",
  "ghost-tab",
  "ghost-heading",
  "sign",
  "bat",
  "ghost-card",
  "moon",
] as const;
export const EXTRA_MOMENTS = ["spider", "eyes"] as const;

/** Most times one moment may play on one device per UTC day. */
export const DAILY_CAP = 3;

export type MomentLedger = {
  /** UTC day (YYYY-MM-DD) the counts belong to. */
  d: string;
  /** Page views so far (drives the rotation); never reset by the day. */
  n: number;
  /** Plays today, by moment name. */
  c: Record<string, number>;
};

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Tolerantly parse a stored ledger; anything malformed starts a fresh one. */
export function parseLedger(raw: string | null | undefined, nowMs: number): MomentLedger {
  const day = utcDay(nowMs);
  try {
    const v = raw ? JSON.parse(raw) : null;
    const n = v && Number.isInteger(v.n) && v.n >= 0 ? v.n : 0;
    const c =
      v && v.d === day && v.c && typeof v.c === "object"
        ? Object.fromEntries(
            Object.entries(v.c).filter(([, x]) => Number.isInteger(x) && (x as number) >= 0),
          )
        : {};
    return { d: day, n, c: c as Record<string, number> };
  } catch {
    return { d: day, n: 0, c: {} };
  }
}

function pickFrom(pool: readonly string[], present: ReadonlySet<string>, ledger: MomentLedger, turn: number): string | null {
  const usable = pool.filter((m) => present.has(m) && (ledger.c[m] ?? 0) < DAILY_CAP);
  return usable.length ? usable[turn % usable.length] : null;
}

/** The (up to) two moments for this page view; `turn` is the ledger's page-view count. */
export function chooseMoments(
  present: ReadonlySet<string>,
  ledger: MomentLedger,
  turn: number,
): { primary: string | null; extra: string | null } {
  return {
    primary: pickFrom(PRIMARY_MOMENTS, present, ledger, turn),
    extra: pickFrom(EXTRA_MOMENTS, present, ledger, turn),
  };
}

/** Record one play, returning a new ledger. */
export function recordPlay(ledger: MomentLedger, name: string): MomentLedger {
  return { ...ledger, c: { ...ledger.c, [name]: (ledger.c[name] ?? 0) + 1 } };
}
