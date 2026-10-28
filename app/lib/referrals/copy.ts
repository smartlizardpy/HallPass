/**
 * Fright Fest referrals — the text a player copies. PURE.
 *
 * The three texts are built from the event's dates and the player's link, so
 * they cannot drift from the championship window. They are written to sound like
 * a player sharing something they found, not an advert, and use no platform
 * formatting (plain text and emoji paste anywhere: HoYoLAB, Reddit, Discord).
 */

import type { ReferralConfig } from "./config";
import { SITE_URL } from "./config";

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));

export interface EventDates {
  /** "October 28 to November 2" */
  long: string;
  /** "Oct 28 – Nov 2" */
  short: string;
  /** "November 2" */
  endLong: string;
  /** "Nov 2" */
  endShort: string;
}

/**
 * The first and last FULL UK days of the window. `closesAt` is exclusive (3 Nov
 * 00:00), so the last day is the one before it. UK is UTC for the event (BST
 * ended 25 Oct), so UTC dates are the UK dates.
 */
export function eventDates(config: Pick<ReferralConfig, "opensAt" | "closesAt">): EventDates {
  const start = new Date(config.opensAt);
  const end = new Date(Date.parse(config.closesAt) - 1);
  const s = { m: start.getUTCMonth(), d: start.getUTCDate() };
  const e = { m: end.getUTCMonth(), d: end.getUTCDate() };
  return {
    long: `${MONTHS_LONG[s.m]} ${s.d} to ${MONTHS_LONG[e.m]} ${e.d}`,
    short: `${MONTHS_SHORT[s.m]} ${s.d} – ${MONTHS_SHORT[e.m]} ${e.d}`,
    endLong: `${MONTHS_LONG[e.m]} ${e.d}`,
    endShort: `${MONTHS_SHORT[e.m]} ${e.d}`,
  };
}

/** The event URL, with the player's token when they have one. Absolute, on the canonical origin. */
export function referralLink(config: Pick<ReferralConfig, "path" | "param">, token: string | null, origin: string = SITE_URL): string {
  const base = `${origin}${config.path}`;
  return token ? `${base}?${config.param}=${encodeURIComponent(token)}` : base;
}

export function buildPost(config: ReferralConfig, link: string): string {
  const d = eventDates(config);
  return [
    "🎃 HALLOWEEN GAMING EVENT — FREE TO JOIN!",
    "",
    `Found this little browser arcade called HallPass, and they're running a Halloween event from ${d.long}!`,
    "",
    "👻 Play games",
    "🏆 Compete for points",
    "🎁 Win event prizes",
    "🃏 Discover special Halloween collectibles",
    "",
    "No downloads needed. Just open it in your browser and play.",
    "",
    "Come join Fright Fest! 🎃",
    "",
    `🔗 ${link}`,
    "",
    "#Halloween #Gaming #BrowserGames #FrightFest",
  ].join("\n");
}

export function buildComment(config: ReferralConfig, link: string): string {
  const d = eventDates(config);
  return `🎃 HallPass is hosting a free Halloween gaming event from ${d.short}! Play browser games, earn points and compete for prizes 👻 Come check it out: ${link}`;
}

export function buildInviteMessage(config: ReferralConfig, link: string): string {
  const d = eventDates(config);
  return `🎃 Hey! HallPass is doing a Halloween gaming event until ${d.endLong}, with games, points and prizes!\n\nCome play with me 👻\n\n${link}`;
}
