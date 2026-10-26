/**
 * HallPass — championship types. Pure data, no I/O, no `window`, safe to import
 * from client components.
 *
 * A CHAMPIONSHIP is a set of per-game boards with a shared window, whose ranks
 * become points on one overall table. Its DATES and RULES are code (reviewed and
 * versioned); its run-time STATE (a game opened, the event suspended or
 * finalised) is a database row an admin changes. `docs/championship-design.md`
 * has the argument.
 *
 * Nothing here knows about the seasonal skin, and the skin knows nothing about
 * this folder (`app/lib/events/events.test.ts` enforces both directions).
 */

/** Admin status of an event, as stored. Moves forward only. */
export type EventStatus = "scheduled" | "verification" | "finalised" | "archived";

/** Admin status of one game's board, as stored. */
export type GameStatus = "pending" | "open" | "paused" | "withdrawn";

/** A run's lifecycle, as stored. */
export type RunStatus = "issued" | "accepted" | "flagged" | "rejected" | "disqualified";

/**
 * Where an event is, derived from its configured window, its stored state and
 * the clock (`phase.ts`). `off` means the code switch is off: the championship
 * does not exist for players.
 */
export type ChampionshipPhase =
  | "off"
  | "upcoming"
  | "live"
  | "closed"
  | "verification"
  | "finalised"
  | "archived"
  | "suspended";

/** How a board orders and displays its metric. */
export interface MetricSpec {
  /** `desc`: higher is better. `asc`: lower is better. */
  sort: "asc" | "desc";
  /** Column label on the board, e.g. "Time left". */
  label: string;
  /** How the integer score is shown. */
  format: "clock" | "ms-clock" | "integer";
  /** What the tiebreak measures, e.g. "Escape time". */
  tiebreakLabel: string;
  /** `asc`: a lower tiebreak wins. `desc`: a higher one does. */
  tiebreakSort: "asc" | "desc";
  /** How the tiebreak is shown. */
  tiebreakFormat: "clock" | "seconds-2dp" | "integer";
}

/** What a validator is given: everything untrusted, plus the server's own clock evidence. */
export interface ValidationInput {
  /** The submitted score, untrusted. */
  score: unknown;
  /** The submitted `meta` object (token already removed), untrusted. */
  meta: Record<string, unknown>;
  /** Seconds between the run token being issued and this submission arriving, by the database clock. */
  elapsedSec: number;
  /** The seed the game declared when it asked for the token, if any. */
  startSeed: number | null;
}

/** Hard rejection: never ranked, never shown, recorded for the audit trail. */
export interface ValidationRejected {
  ok: false;
  reason: string;
  checks: Record<string, number | string | boolean | null>;
}

/** Plausible: `flags` empty → accepted; otherwise held for an admin. */
export interface ValidationPassed {
  ok: true;
  score: number;
  tiebreak: number | null;
  flags: string[];
  checks: Record<string, number | string | boolean | null>;
}

export type ValidationResult = ValidationRejected | ValidationPassed;

export interface ChampionshipGame {
  /** Catalogue slug. */
  slug: string;
  /** The board id the game submits to (`submitScore(…, { board })`). Never a `boards` row. */
  board: string;
  /** Game title, as on its store page. */
  title: string;
  /** Event mode name, e.g. "The Halloween Shift". */
  mode: string;
  /** Short mode name for chips and tabs. */
  modeShort: string;
  metric: MetricSpec;
  /**
   * `verified`: the owner has checked the game's event mode against these rules.
   * `proposed`: the rules are HallPass's proposal; the game must implement them
   * (docs/championship-integration.md) before an admin opens the board.
   */
  rules: "verified" | "proposed";
  /** One-paragraph "how to enter", shown on the rules page and the game page. */
  howToEnter: string;
  /** The ranking rule in one sentence, for the rules page. */
  rankingRule: string;
  /** Pure server-side check of one submission. */
  validate: (input: ValidationInput) => ValidationResult;
}

/** Fright Points: points for ranks 1..byRank.length, then `others` for any other ranked player. */
export interface PointsTable {
  byRank: readonly number[];
  others: number;
}

/** Pack ids (collectibles catalogue) paid out by the championship. */
export interface ChampionshipRewards {
  participation: string;
  gameChampion: Readonly<Record<string, string>>;
  overallChampion: string;
}

export interface ChampionshipConfig {
  /** Permanent key: run rows, grants and URLs use it. */
  id: string;
  title: string;
  /** Code master switch. `false` makes every surface behave as if the championship did not exist. */
  enabled: boolean;
  /** ISO-8601 with `Z`, inclusive. */
  opensAt: string;
  /** ISO-8601 with `Z`, exclusive. */
  closesAt: string;
  /** Display zone for every date the event shows. */
  timeZone: string;
  /** When results are expected, for the schedule ("by 5 Nov"); display only. */
  resultsBy: string;
  /** Public page for the event. */
  href: string;
  games: readonly ChampionshipGame[];
  points: PointsTable;
  rewards: ChampionshipRewards;
  /** Lifetime of a run token, seconds. */
  tokenTtlSec: number;
  /**
   * A run STARTED before the close may still be submitted this many seconds
   * after it, so nobody is cut off mid-run at midnight. A run started after the
   * close never gets a token at all.
   */
  submitGraceSec: number;
}

/** The stored state of an event, as the store reads it. `null` fields are absent values. */
export interface EventState {
  status: EventStatus;
  suspended: boolean;
  suspendedReason: string | null;
  closedEarlyAt: string | null;
  finalisedAt: string | null;
}

/** The stored state of one game in an event. */
export interface GameState {
  slug: string;
  status: GameStatus;
  openedAt: string | null;
}
