/**
 * HallPass — the championship barrel: the live store bound to the shared Neon
 * client, and the reads every surface uses.
 *
 * Mirrors `achievements/index.ts`: the factory stays testable with a fake `sql`;
 * this module holds the real connection, so it is `server-only`.
 *
 * FAIL-SOFT READS. Migration 048 is applied by hand, so this code can be live
 * against a database without the championship tables. Reads then say
 * `available: false` (the UI shows "standings unavailable") instead of 500ing
 * the page they sit on. Unexpected errors are logged on the way past; a missing
 * table or unconfigured database is expected and stays quiet.
 *
 * AFTER FINALISATION the official table is the frozen snapshot, not a fresh
 * computation: a later account deletion must not re-rank a decided result. The
 * snapshot holds public ids; names and avatars are looked up at read time, so a
 * deleted account's name disappears from the record too ("Former player").
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { championshipPhase, countingGames } from "./phase";
import { buildStandings, toPublicStandings, type PublicStandings, type Standings } from "./standings";
import { createChampionshipStore, type EventSnapshot, type PlayerRun } from "./store";
import type { ChampionshipConfig, ChampionshipPhase } from "./types";

export const championshipStore = createChampionshipStore(sql);

export const PUBLIC_LIMITS = { board: 25, overall: 50 } as const;
const FORMER_PLAYER = "Former player";
const FORMER_AVATAR = "/avatars/no-face.png?bg=8a8494";

function expected(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

function degrade<T>(where: string, error: unknown, fallback: T): T {
  if (!expected(error)) console.error(`championship.${where} failed; degrading:`, error);
  return fallback;
}

/** The event snapshot, or `null` when the tables are missing or unreachable. */
export async function readEventSoft(c: ChampionshipConfig): Promise<EventSnapshot | null> {
  try {
    return await championshipStore.readEvent(c.id);
  } catch (error) {
    return degrade("readEvent", error, null);
  }
}

/** The live table with internal ids. Server-side only (finalisation, rewards, /me). Throws on DB errors. */
export async function computeStandings(c: ChampionshipConfig, snap: EventSnapshot): Promise<Standings> {
  const phase = championshipPhase(c, snap.state, snap.nowMs);
  const counting = new Set(countingGames(snap.games).map((g) => g.slug));
  const games = c.games.filter((g) => counting.has(g.slug)).map((g) => ({ slug: g.slug, metric: g.metric }));
  const runs = await championshipStore.bestRuns(c.id, games);
  return buildStandings(c, phase, snap.games, runs);
}

export interface PublicChampionship {
  available: boolean;
  phase: ChampionshipPhase;
  /** The database clock when this was built, ISO. */
  generatedAt: string;
  /** True when this is the frozen official result. */
  final: boolean;
  standings: PublicStandings | null;
}

/** Re-resolve names and avatars on a frozen table; drop nothing, rename the departed. */
async function refreshNames(s: PublicStandings): Promise<PublicStandings> {
  const ids = new Set<string>();
  for (const b of s.boards) for (const e of b.entries) ids.add(e.publicId);
  for (const o of s.overall) ids.add(o.publicId);
  const live = await championshipStore.publicPlayers([...ids]);
  const who = (publicId: string) => live.get(publicId) ?? { name: FORMER_PLAYER, avatar: FORMER_AVATAR };
  return {
    ...s,
    boards: s.boards.map((b) => ({ ...b, entries: b.entries.map((e) => ({ ...e, ...who(e.publicId) })) })),
    overall: s.overall.map((o) => ({ ...o, ...who(o.publicId) })),
  };
}

function isPublicStandings(v: unknown): v is PublicStandings {
  return !!v && typeof v === "object" && Array.isArray((v as PublicStandings).boards) && Array.isArray((v as PublicStandings).overall);
}

/** What the public API and pages show. Never throws. */
export async function getPublicChampionship(c: ChampionshipConfig): Promise<PublicChampionship> {
  const snap = await readEventSoft(c);
  const nowIso = new Date(snap?.nowMs ?? Date.now()).toISOString();
  if (!snap) {
    return { available: false, phase: championshipPhase(c, null, Date.now()), generatedAt: nowIso, final: false, standings: null };
  }
  const phase = championshipPhase(c, snap.state, snap.nowMs);
  try {
    if (phase === "finalised" || phase === "archived") {
      const frozen = await championshipStore.finalStandings(c.id);
      if (isPublicStandings(frozen)) {
        const named = await refreshNames(frozen);
        return {
          available: true,
          phase,
          generatedAt: nowIso,
          final: true,
          standings: {
            ...named,
            phase,
            boards: named.boards.map((b) => ({ ...b, entries: b.entries.slice(0, PUBLIC_LIMITS.board) })),
            overall: named.overall.slice(0, PUBLIC_LIMITS.overall),
          },
        };
      }
    }
    const standings = await computeStandings(c, snap);
    return { available: true, phase, generatedAt: nowIso, final: false, standings: toPublicStandings(standings, PUBLIC_LIMITS) };
  } catch (error) {
    return degrade("standings", error, { available: false, phase, generatedAt: nowIso, final: false, standings: null });
  }
}

export interface MyBoard {
  slug: string;
  counting: boolean;
  rank: number | null;
  points: number;
  score: number | null;
  tiebreak: number | null;
}

export interface MyProgress {
  available: boolean;
  phase: ChampionshipPhase;
  publicId: string | null;
  rank: number | null;
  points: number;
  eligible: boolean;
  missing: string[];
  boards: MyBoard[];
  runs: PlayerRun[];
}

/** One signed-in player's own view. Never throws; never includes anyone else's data. */
export async function getMyProgress(c: ChampionshipConfig, playerId: string): Promise<MyProgress> {
  const snap = await readEventSoft(c);
  const phase = championshipPhase(c, snap?.state ?? null, snap?.nowMs ?? Date.now());
  const empty: MyProgress = {
    available: false,
    phase,
    publicId: null,
    rank: null,
    points: 0,
    eligible: false,
    missing: [],
    boards: [],
    runs: [],
  };
  if (!snap) return empty;
  try {
    const [standings, runs] = await Promise.all([computeStandings(c, snap), championshipStore.playerRuns(c.id, playerId, 20)]);
    const me = standings.overall.find((o) => o.playerId === playerId);
    return {
      available: true,
      phase,
      publicId: me?.publicId ?? null,
      rank: me?.rank ?? null,
      points: me?.points ?? 0,
      eligible: me?.eligible ?? false,
      missing: me?.missing ?? standings.boards.filter((b) => b.counting).map((b) => b.slug),
      boards: standings.boards.map((b) => {
        const e = b.entries.find((x) => x.playerId === playerId);
        return {
          slug: b.slug,
          counting: b.counting,
          rank: e?.rank ?? null,
          points: e?.points ?? 0,
          score: e?.score ?? null,
          tiebreak: e?.tiebreak ?? null,
        };
      }),
      runs,
    };
  } catch (error) {
    return degrade("myProgress", error, empty);
  }
}

export type { EventSnapshot, PlayerRun } from "./store";
export type { PublicStandings } from "./standings";
