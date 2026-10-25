import type { ThemeWindow } from "./types";

/**
 * Human-readable dates for the event, DERIVED from the configured window so the
 * copy can never disagree with the clock. Formatted in UK time (the audience's
 * clocks) from the UTC instants in the config; `endAt` is exclusive, so the last
 * minute of the event is one minute earlier. Pure and clock-free: server
 * components may call it.
 */
const fmt = (opts: Intl.DateTimeFormatOptions, ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts }).format(ms);

export function eventDateLabels(theme: ThemeWindow) {
  const start = Date.parse(theme.startAt);
  const last = Date.parse(theme.endAt) - 60_000;
  const end = Date.parse(theme.endAt);
  const dm = { day: "numeric", month: "short" } as const;
  const wdm = { weekday: "short", day: "numeric", month: "short" } as const;
  return {
    /** "28 Oct" */
    startShort: fmt(dm, start),
    /** "31 Oct": the last day the skin is on */
    endShort: fmt(dm, last),
    /** "1 Nov": the day the normal site is back */
    restoreShort: fmt(dm, end),
    /** "Wed 28 to Sat 31 Oct" */
    range: `${fmt({ weekday: "short", day: "numeric" }, start)} to ${fmt(wdm, last)}`,
    /** "Sat 31 Oct, 23:59 UK" */
    endsAt: `${fmt(wdm, last)}, ${fmt({ hour: "2-digit", minute: "2-digit", hour12: false }, last)} UK`,
    /** "Sat 31 Oct" */
    lastDay: fmt(wdm, last),
  };
}
