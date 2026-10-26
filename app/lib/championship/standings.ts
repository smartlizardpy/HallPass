/**
 * HallPass — championship standings: per-board ranks, Fright Points and the
 * overall table. Pure; given the best accepted run per player per board, it
 * produces the whole table. Fully deterministic: the same runs always give the
 * same order, whatever order they arrive in.
 *
 * TWO SHAPES. The internal shape carries `playerId` (the `players.id` Google
 * subject) because rewards are granted against it. It must never reach a
 * browser: `toPublicStandings` is the only way out to the wire and drops it,
 * and the route test asserts no `playerId` key survives.
 */

import { countingGames, lineupFinal } from "./phase";
import type {
  ChampionshipConfig,
  ChampionshipPhase,
  GameState,
  GameStatus,
  MetricSpec,
  PointsTable,
} from "./types";

/** One player's best accepted run on one board, as the store reads it. */
export interface BestRun {
  runId: number;
  gameSlug: string;
  /** Internal `players.id`. Server-side only. */
  playerId: string;
  publicId: string;
  name: string;
  avatar: string;
  score: number;
  tiebreak: number | null;
  /** ISO-8601, database clock. */
  submittedAt: string;
}

export interface BoardEntry {
  rank: number;
  points: number;
  runId: number;
  playerId: string;
  publicId: string;
  name: string;
  avatar: string;
  score: number;
  tiebreak: number | null;
  submittedAt: string;
}

export interface Board {
  slug: string;
  board: string;
  title: string;
  mode: string;
  modeShort: string;
  metric: MetricSpec;
  rules: "verified" | "proposed";
  status: GameStatus;
  openedAt: string | null;
  /** Opened and not withdrawn: its ranks earn Fright Points. */
  counting: boolean;
  entries: BoardEntry[];
}

export interface OverallEntry {
  rank: number;
  playerId: string;
  publicId: string;
  name: string;
  avatar: string;
  points: number;
  /** Per counting board: this player's rank and points, or `null` for no result. */
  games: Record<string, { rank: number; points: number } | null>;
  gamesWithResult: number;
  /** A result on every counting board. Only an eligible player can be Overall Champion. */
  eligible: boolean;
  /** Counting boards with no result, by slug. */
  missing: string[];
  /** When the player's counting runs were all in (latest receipt), ISO. */
  reachedAt: string;
}

export interface Standings {
  championship: string;
  phase: ChampionshipPhase;
  /** Every configured game, in config order, counting or not. */
  boards: Board[];
  overall: OverallEntry[];
  /** The top eligible player, or `null`. Provisional until the phase is `finalised`. */
  championPublicId: string | null;
  lineupFinal: boolean;
}

const t = (iso: string) => {
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
};

/** The one ordering of runs on a board: metric, tiebreak (missing last), earlier receipt, lower run id. */
export function compareRuns(metric: MetricSpec) {
  return (a: Pick<BestRun, "score" | "tiebreak" | "submittedAt" | "runId">, b: typeof a): number => {
    if (a.score !== b.score) return metric.sort === "desc" ? b.score - a.score : a.score - b.score;
    if (a.tiebreak !== b.tiebreak) {
      if (a.tiebreak === null) return 1;
      if (b.tiebreak === null) return -1;
      return metric.tiebreakSort === "asc" ? a.tiebreak - b.tiebreak : b.tiebreak - a.tiebreak;
    }
    const ta = t(a.submittedAt);
    const tb = t(b.submittedAt);
    if (ta !== tb) return ta - tb;
    return a.runId - b.runId;
  };
}

/** Fright Points for a strict rank (1-based). */
export function pointsForRank(table: PointsTable, rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  return table.byRank[rank - 1] ?? table.others;
}

/** Rank one board: best run per player (defensively re-reduced), then strict ranks. */
export function rankBoard(metric: MetricSpec, table: PointsTable, runs: readonly BestRun[]): BoardEntry[] {
  const cmp = compareRuns(metric);
  const best = new Map<string, BestRun>();
  for (const r of runs) {
    const cur = best.get(r.playerId);
    if (!cur || cmp(r, cur) < 0) best.set(r.playerId, r);
  }
  return [...best.values()].sort(cmp).map((r, i) => ({
    rank: i + 1,
    points: pointsForRank(table, i + 1),
    runId: r.runId,
    playerId: r.playerId,
    publicId: r.publicId,
    name: r.name,
    avatar: r.avatar,
    score: r.score,
    tiebreak: r.tiebreak,
    submittedAt: r.submittedAt,
  }));
}

/** Lexicographic compare of two ascending rank lists: a better best-placing wins. */
function compareRankLists(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return b.length - a.length;
}

/**
 * The overall table from the counting boards. Order: points, then results on
 * more boards, then better best-placings, then whoever reached their total
 * first, then public id (so the order is always defined).
 */
export function rankOverall(boards: readonly Board[]): OverallEntry[] {
  const counting = boards.filter((b) => b.counting);
  const byPlayer = new Map<string, Omit<OverallEntry, "rank"> & { ranks: number[] }>();
  for (const board of counting) {
    for (const e of board.entries) {
      let p = byPlayer.get(e.playerId);
      if (!p) {
        p = {
          playerId: e.playerId,
          publicId: e.publicId,
          name: e.name,
          avatar: e.avatar,
          points: 0,
          games: Object.fromEntries(counting.map((b) => [b.slug, null])),
          gamesWithResult: 0,
          eligible: false,
          missing: [],
          reachedAt: e.submittedAt,
          ranks: [],
        };
        byPlayer.set(e.playerId, p);
      }
      p.points += e.points;
      p.games[board.slug] = { rank: e.rank, points: e.points };
      p.gamesWithResult += 1;
      p.ranks.push(e.rank);
      if (t(e.submittedAt) > t(p.reachedAt)) p.reachedAt = e.submittedAt;
    }
  }
  const rows = [...byPlayer.values()].map((p) => {
    p.ranks.sort((x, y) => x - y);
    p.missing = counting.filter((b) => p.games[b.slug] === null).map((b) => b.slug);
    p.eligible = counting.length > 0 && p.missing.length === 0;
    return p;
  });
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.gamesWithResult - a.gamesWithResult ||
      compareRankLists(a.ranks, b.ranks) ||
      t(a.reachedAt) - t(b.reachedAt) ||
      (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0),
  );
  return rows.map((p, i) => ({
    rank: i + 1,
    playerId: p.playerId,
    publicId: p.publicId,
    name: p.name,
    avatar: p.avatar,
    points: p.points,
    games: p.games,
    gamesWithResult: p.gamesWithResult,
    eligible: p.eligible,
    missing: p.missing,
    reachedAt: p.reachedAt,
  }));
}

/** Build the whole table. `games` is the stored lineup; configured games with no row are pending. */
export function buildStandings(
  c: ChampionshipConfig,
  phase: ChampionshipPhase,
  games: readonly GameState[],
  runs: readonly BestRun[],
): Standings {
  const lineup: GameState[] = c.games.map(
    (g) => games.find((s) => s.slug === g.slug) ?? { slug: g.slug, status: "pending", openedAt: null },
  );
  const counting = new Set(countingGames(lineup).map((g) => g.slug));
  const boards: Board[] = c.games.map((g) => {
    const state = lineup.find((s) => s.slug === g.slug)!;
    const isCounting = counting.has(g.slug);
    return {
      slug: g.slug,
      board: g.board,
      title: g.title,
      mode: g.mode,
      modeShort: g.modeShort,
      metric: g.metric,
      rules: g.rules,
      status: state.status,
      openedAt: state.openedAt,
      counting: isCounting,
      // A withdrawn or never-opened board shows no ranks: nothing it holds counts.
      entries: isCounting ? rankBoard(g.metric, c.points, runs.filter((r) => r.gameSlug === g.slug)) : [],
    };
  });
  const overall = rankOverall(boards);
  return {
    championship: c.id,
    phase,
    boards,
    overall,
    championPublicId: overall.find((o) => o.eligible)?.publicId ?? null,
    lineupFinal: lineupFinal(lineup, phase),
  };
}

// ── The wire shape ──────────────────────────────────────────────────────────

export type PublicBoardEntry = Omit<BoardEntry, "playerId" | "runId">;
export type PublicBoard = Omit<Board, "entries"> & { entries: PublicBoardEntry[] };
export type PublicOverallEntry = Omit<OverallEntry, "playerId">;
export interface PublicStandings extends Omit<Standings, "boards" | "overall"> {
  boards: PublicBoard[];
  overall: PublicOverallEntry[];
}

/** One board row without its internal ids. Fields are listed, not spread, so a new internal field cannot leak by default. */
export function publicEntry(e: BoardEntry): PublicBoardEntry {
  return {
    rank: e.rank,
    points: e.points,
    publicId: e.publicId,
    name: e.name,
    avatar: e.avatar,
    score: e.score,
    tiebreak: e.tiebreak,
    submittedAt: e.submittedAt,
  };
}

/** Strip every internal id. The only sanctioned path from `Standings` to a response. */
export function toPublicStandings(s: Standings, limits: { board: number; overall: number }): PublicStandings {
  return {
    championship: s.championship,
    phase: s.phase,
    championPublicId: s.championPublicId,
    lineupFinal: s.lineupFinal,
    boards: s.boards.map((b) => ({
      slug: b.slug,
      board: b.board,
      title: b.title,
      mode: b.mode,
      modeShort: b.modeShort,
      metric: b.metric,
      rules: b.rules,
      status: b.status,
      openedAt: b.openedAt,
      counting: b.counting,
      entries: b.entries.slice(0, limits.board).map(publicEntry),
    })),
    overall: s.overall.slice(0, limits.overall).map((o) => ({
      rank: o.rank,
      publicId: o.publicId,
      name: o.name,
      avatar: o.avatar,
      points: o.points,
      games: o.games,
      gamesWithResult: o.gamesWithResult,
      eligible: o.eligible,
      missing: o.missing,
      reachedAt: o.reachedAt,
    })),
  };
}
