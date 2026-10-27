/**
 * HallPass — the plain-data face of a championship, for client components.
 *
 * `ChampionshipConfig` carries each game's validator, so importing it into a
 * client bundle would ship the anti-cheat code to every homepage visitor. Server
 * components call `championshipSummary()` and pass the result down as a prop:
 * serialisable, small, and nothing a player could not read on the rules page.
 *
 * It names NO games: the lineup comes from the API, which leaves out a game
 * still waiting for verification. A game's own page gets its entry from
 * `summaryGame()`, which is no secret there.
 *
 * Pure and client-safe: imports types and formatting only.
 */

import { formatDay, formatInstant, formatLastMinute } from "./format";
import type { ChampionshipConfig, ChampionshipPhase, MetricSpec } from "./types";

export interface SummaryGame {
  slug: string;
  board: string;
  title: string;
  mode: string;
  modeShort: string;
  metric: MetricSpec;
  rules: "verified" | "proposed";
}

export interface ChampionshipSummary {
  id: string;
  title: string;
  href: string;
  opensAt: string;
  closesAt: string;
  resultsBy: string;
  timeZone: string;
  submitGraceMin: number;
  points: { byRank: number[]; others: number };
  /** Pre-formatted dates, so server and client print the same words. */
  labels: {
    opens: string;
    opensDay: string;
    lastMinute: string;
    closesDay: string;
    /** "2 Nov": the last day, without the weekday. */
    closesDate: string;
    resultsBy: string;
    range: string;
  };
}

export function championshipSummary(c: ChampionshipConfig): ChampionshipSummary {
  const tz = c.timeZone;
  const lastDay = new Date(Date.parse(c.closesAt) - 1).toISOString();
  return {
    id: c.id,
    title: c.title,
    href: c.href,
    opensAt: c.opensAt,
    closesAt: c.closesAt,
    resultsBy: c.resultsBy,
    timeZone: tz,
    submitGraceMin: Math.round(c.submitGraceSec / 60),
    points: { byRank: [...c.points.byRank], others: c.points.others },
    labels: {
      opens: formatInstant(c.opensAt, tz),
      opensDay: formatDay(c.opensAt, tz),
      lastMinute: formatLastMinute(c.closesAt, tz),
      closesDay: formatDay(lastDay, tz),
      closesDate: new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(Date.parse(lastDay)),
      resultsBy: formatLastMinute(c.resultsBy, tz),
      range: `${formatDay(c.opensAt, tz)} to ${formatDay(lastDay, tz)}`,
    },
  };
}

/** One game's public entry, for that game's own page. */
export function summaryGame(c: ChampionshipConfig, slug: string): SummaryGame | null {
  const g = c.games.find((x) => x.slug === slug);
  return g ? { slug: g.slug, board: g.board, title: g.title, mode: g.mode, modeShort: g.modeShort, metric: g.metric, rules: g.rules } : null;
}

/**
 * The phase from the clock alone: what a page shows before (or without) the
 * server's answer. The server's phase, which knows about suspension, early
 * close and finalisation, always replaces it once it arrives.
 */
export function clockPhase(s: ChampionshipSummary, nowMs: number): ChampionshipPhase {
  if (nowMs < Date.parse(s.opensAt)) return "upcoming";
  if (nowMs < Date.parse(s.closesAt)) return "live";
  return "closed";
}

/** Points for a 1-based rank, from the published table. */
export function pointsFor(s: ChampionshipSummary, rank: number): number {
  return s.points.byRank[rank - 1] ?? s.points.others;
}

/**
 * The published points table as bands ("4th–5th: 40"), merged from the per-rank
 * list so the page cannot drift from the code.
 */
export function pointBands(s: ChampionshipSummary): { from: number; to: number | null; points: number }[] {
  const bands: { from: number; to: number | null; points: number }[] = [];
  s.points.byRank.forEach((points, i) => {
    const last = bands[bands.length - 1];
    if (last && last.points === points) last.to = i + 1;
    else bands.push({ from: i + 1, to: i + 1, points });
  });
  bands.push({ from: s.points.byRank.length + 1, to: null, points: s.points.others });
  return bands;
}

/** One sentence for where the championship is. Never invents a number. */
export function phaseLine(s: ChampionshipSummary, phase: ChampionshipPhase): string {
  switch (phase) {
    case "upcoming":
      return `Ranked runs open ${s.labels.opens} UK time. Practise now; nothing counts until then.`;
    case "live":
      return `Live now. Ranked runs count until ${s.labels.lastMinute} UK time.`;
    case "closed":
      return `Submissions are closed. Runs already started have ${s.submitGraceMin} minutes to finish, then every result is checked.`;
    case "verification":
      return `Results are being checked. Final standings by ${s.labels.resultsBy} UK time.`;
    case "finalised":
    case "archived":
      return "These are the final results. Thanks to everyone who played.";
    case "suspended":
      return "Fright Fest is paused while we sort something out. Runs are not being ranked right now.";
    default:
      return "";
  }
}
