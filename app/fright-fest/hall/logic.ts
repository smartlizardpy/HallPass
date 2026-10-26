/**
 * The hall's words and arithmetic, pure: what the ticker says in each phase,
 * what each cabinet says about itself, which board rows fit the board and where
 * you are pinned. No clock, no DOM, no fetch (the islands supply those), so every
 * state is a unit test.
 *
 * Nothing here invents a number: every figure is a row from the API or a label
 * the summary already carries.
 */

import { ordinal } from "@/app/lib/championship/format";
import type { PublicOverallEntry } from "@/app/lib/championship/standings";
import type { ChampionshipSummary } from "@/app/lib/championship/summary";
import type { ChampionshipPhase } from "@/app/lib/championship/types";
import type { GamePlatform } from "@/app/lib/games";
import type { CabinetProps } from "./props";

/** `null` is "not known yet": the server render and the first client render. */
export type HallPhase = ChampionshipPhase | null;

export type Tone = "idle" | "soon" | "live" | "final";

export interface TickerLine {
  text: string;
  tone: Tone;
  /** The word that introduces a countdown after the text ("in", "ends in"), or null when none belongs (before the opening, and while live). */
  countdownLabel: string | null;
}

const short = (s: ChampionshipSummary) => ({
  /** "28 Oct" */
  opens: s.labels.opensDay.replace(/^\w+ /, ""),
  /** "1 Nov" */
  closes: s.labels.closesDate,
  /** "Wed 4 Nov" */
  resultsBy: s.labels.resultsBy.replace(/, .*$/, ""),
});

/**
 * The marquee ticker. With no summary the championship is switched off (the
 * page stays up, nothing is scored). With no phase it is the date range, the
 * same words for everyone, which is what the prerendered page says. `compact`
 * is the phone's narrower plate.
 */
export function tickerLine(phase: HallPhase, s: ChampionshipSummary | null, compact: boolean): TickerLine {
  if (!s) return { text: compact ? "Rewards to be announced" : "Scoring and rewards: to be announced", tone: "idle", countdownLabel: null };
  const d = short(s);
  switch (phase) {
    case "upcoming":
      return { text: `Opens ${d.opens}`, tone: "soon", countdownLabel: "in" };
    case "live":
      return { text: "Live", tone: "live", countdownLabel: "ends in" };
    case "closed":
      return { text: compact ? "Closed · checking" : "Closed · checking the results", tone: "idle", countdownLabel: null };
    case "verification":
      return { text: compact ? `Closed · final ${d.resultsBy}` : `Closed · results final by ${d.resultsBy}`, tone: "idle", countdownLabel: null };
    case "finalised":
    case "archived":
      return { text: "Final results are in", tone: "final", countdownLabel: null };
    case "suspended":
      return { text: compact ? "Paused" : "Paused · runs are not ranked", tone: "idle", countdownLabel: null };
    default:
      return { text: s.labels.range.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /g, ""), tone: "idle", countdownLabel: null };
  }
}

/** "1d 02:03:04", or "02:03:04" inside the last day. */
export function countdownText(c: { d: number; h: number; m: number; s: number }): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${c.d > 0 ? `${c.d}d ` : ""}${p(c.h)}:${p(c.m)}:${p(c.s)}`;
}

export interface CabinetStatus {
  /** The small label above the title: "Ranked · live". */
  chip: string;
  /** One sentence under the ranking rule. */
  line: string;
}

/** What a cabinet says about its game right now. The mystery cabinet says nothing about any game. */
export function cabinetStatus(cab: CabinetProps, phase: HallPhase, s: ChampionshipSummary | null): CabinetStatus {
  if (!cab.open) {
    return {
      chip: "Mystery cabinet",
      line: "A game joins when its Fright Fest mode is ready and its board opens. Its Fright Points count from that moment.",
    };
  }
  if (!s) return { chip: cab.modeShort, line: `Play ${cab.mode} any time. Scoring and rewards: to be announced.` };
  switch (phase) {
    case "upcoming":
      return { chip: `Opens ${short(s).opens}`, line: `Ranked runs open ${s.labels.opens} UK time. Practise now; nothing counts until then.` };
    case "live":
      return { chip: "Ranked · live", line: `Ranked until ${s.labels.lastMinute} UK time. Your best run counts.` };
    case "closed":
    case "verification":
      return { chip: "Board closed", line: `Ranked runs have closed. Results are checked and final by ${s.labels.resultsBy} UK time.` };
    case "finalised":
    case "archived":
      return { chip: "Final", line: "The results are final. The mode stays open for fun." };
    case "suspended":
      return { chip: "Paused", line: "Fright Fest is paused while we sort something out. Runs are not being ranked right now." };
    default:
      return { chip: cab.modeShort, line: `Ranked runs count ${s.labels.range} (UK time). Your best run counts.` };
  }
}

/** Whether a game's board has opened (it has rows to see): not before the opening, not while the rest is unknown. */
export const boardIsOpen = (phase: HallPhase): boolean =>
  phase === "live" || phase === "closed" || phase === "verification" || phase === "finalised" || phase === "archived" || phase === "suspended";

/** The cabinet's accessible name: "Last Bell: The Halloween Shift. Cabinet 1 of 3". */
export function cabinetLabel(cab: CabinetProps, index: number, total: number): string {
  return cab.open ? `${cab.title}: ${cab.mode}. Cabinet ${index + 1} of ${total}` : `Mystery cabinet, not announced. Cabinet ${index + 1} of ${total}`;
}

/** The sentence a screen reader hears after a cabinet is chosen. */
export function selectedAnnouncement(cab: CabinetProps, status: CabinetStatus): string {
  return cab.open ? `${cab.title} selected. ${status.chip}.` : "Mystery cabinet selected. Not announced yet.";
}

/**
 * "Play on a laptop": only when the catalogue says the game cannot be played on
 * the device in hand (`platform` is "desktop" and the device is a phone).
 * Unknown (no platform tag) is never a reason to refuse: it plays as before.
 */
export function needsLaptop(platform: GamePlatform | null, device: "desktop" | "mobile" | null): boolean {
  if (!platform || !device) return false;
  return !(platform === "both" || platform === device);
}

// ── The board ──────────────────────────────────────────────────────────────

export interface BoardRow {
  rank: number;
  name: string;
  points: number;
  publicId: string;
  champion: boolean;
  you: boolean;
}

export interface BoardView {
  rows: BoardRow[];
  /** Your row, pinned under the rows when you are ranked and not among them. */
  you: BoardRow | null;
}

export interface BoardMe {
  publicId: string;
  rank: number;
  points: number;
}

/** Row sizes in CSS px, mirrored in hall.css (`--hl-row`, `--hl-board-chrome`). */
export const BOARD_ROW_PX = 24;
export const BOARD_CHROME_PX = 38;
export const BOARD_LINK_PX = { fine: 44, coarse: 48 } as const;
export const BOARD_MAX_ROWS = 8;

/** How many rows (your pinned row included) fit a board screen this tall. At least one, so a board is never just a heading. */
export function boardCapacity(heightPx: number, coarse: boolean): number {
  const room = heightPx - BOARD_CHROME_PX - (coarse ? BOARD_LINK_PX.coarse : BOARD_LINK_PX.fine);
  return Math.max(1, Math.min(BOARD_MAX_ROWS, Math.floor(room / BOARD_ROW_PX)));
}

/**
 * The rows to show: the top of the overall table, as many as fit. If you are
 * ranked and below them, your row takes the last place and is pinned. The crown
 * goes to the champion only once the results are final.
 */
export function boardRows(
  overall: readonly PublicOverallEntry[],
  me: BoardMe | null,
  capacity: number,
  championPublicId: string | null,
  final: boolean,
): BoardView {
  const cap = Math.max(1, capacity);
  const row = (e: PublicOverallEntry): BoardRow => ({
    rank: e.rank,
    name: e.name,
    points: e.points,
    publicId: e.publicId,
    champion: final && e.publicId === championPublicId,
    you: !!me && e.publicId === me.publicId,
  });
  const top = overall.slice(0, cap);
  if (!me || top.some((e) => e.publicId === me.publicId)) return { rows: top.map(row), you: null };
  const pinned: BoardRow = { rank: me.rank, name: "You", points: me.points, publicId: me.publicId, champion: false, you: true };
  return { rows: overall.slice(0, Math.max(0, cap - 1)).map(row), you: pinned };
}

// ── The gap to the next place ──────────────────────────────────────────────

/** "The next place up, 13th, is 15 Fright Points ahead." Only while the table can still move. */
export function gapToNextPlace(overall: readonly PublicOverallEntry[], me: { rank: number; points: number } | null, phase: HallPhase): string | null {
  if (!me || phase !== "live" || me.rank <= 1) return null;
  const above = overall.filter((e) => e.rank < me.rank);
  const next = above.reduce<PublicOverallEntry | null>((best, e) => (!best || e.rank > best.rank ? e : best), null);
  // The public table is capped, and a place the page cannot see is not worth guessing at.
  if (!next || next.rank !== me.rank - 1) return null;
  const gap = next.points - me.points;
  if (gap > 0) return `The next place up, ${ordinal(next.rank)}, is ${gap} Fright Points ahead.`;
  return `The next place up, ${ordinal(next.rank)}, has the same Fright Points and is ahead on the tiebreak.`;
}
