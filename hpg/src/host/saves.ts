/**
 * Game saves and local leaderboards, owned by the launcher.
 *
 * A game never touches browser storage itself (its frame has none, see
 * guest/install.ts). It sends SAVE_REQUESTs, and this module decides where they
 * go: IndexedDB when available, memory otherwise. Either way the player can
 * EXPORT everything to a file and IMPORT it again (on another computer, or
 * after a browser that keeps nothing between visits). That is the guarantee
 * behind "no game loses progress silently": in memory mode the launcher says
 * so, and the export button is the way out.
 *
 * VERSIONING. Every stored record and every export carries a format number.
 * Records written by a NEWER launcher are refused on import with a clear
 * message rather than half-understood; older ones go through
 * {@link migrateSaveRecord}. There is only version 1 today, so the migration is
 * the identity, but the seam exists so version 2 never has to guess.
 */

import { LAUNCHER_VERSION } from "../format/constants";
import { PACKAGE_ID_RE } from "../format/manifest";
import { validateSaveData, type SaveData, type ScoreEntry } from "../protocol/messages";
import type { KvStore } from "./kv";

export const SAVE_FORMAT_VERSION = 1;
export const SAVE_EXPORT_FORMAT = "hpg-saves";
/** Kept per game after ranking (on every new score). */
const MAX_SCORES_PER_GAME = 50;
/**
 * Accepted per game in storage. An import may hold more than the ranked 50
 * because this module does not know a game's score order at import time (it
 * lives in the package); the next new score re-ranks and trims to 50.
 */
const MAX_STORED_SCORES = 100;

export type SaveRecord = {
  saveFormat: typeof SAVE_FORMAT_VERSION;
  gameId: string;
  gameVersion: string;
  updatedAt: number;
  data: SaveData;
};

export type SaveExport = {
  format: typeof SAVE_EXPORT_FORMAT;
  version: typeof SAVE_FORMAT_VERSION;
  exportedAt: string;
  launcherVersion: string;
  saves: SaveRecord[];
  scores: Record<string, ScoreEntry[]>;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Bring a stored or imported record up to the current format, or reject it. */
export function migrateSaveRecord(v: unknown): SaveRecord | { error: string } {
  if (!isObj(v)) return { error: "not a save record" };
  if (typeof v.saveFormat !== "number") return { error: "missing save format" };
  if (v.saveFormat > SAVE_FORMAT_VERSION) return { error: "made by a newer arcade" };
  if (typeof v.gameId !== "string" || !PACKAGE_ID_RE.test(v.gameId)) return { error: "invalid game id" };
  if (typeof v.gameVersion !== "string" || v.gameVersion.length > 64) return { error: "invalid game version" };
  if (typeof v.updatedAt !== "number" || !Number.isFinite(v.updatedAt)) return { error: "invalid timestamp" };
  const data = validateSaveData(v.data);
  if (!data) return { error: "save data is invalid or too large" };
  return { saveFormat: SAVE_FORMAT_VERSION, gameId: v.gameId, gameVersion: v.gameVersion, updatedAt: v.updatedAt, data };
}

function validScores(v: unknown): ScoreEntry[] | null {
  if (!Array.isArray(v) || v.length > MAX_STORED_SCORES) return null;
  const out: ScoreEntry[] = [];
  for (const s of v) {
    if (!isObj(s) || typeof s.score !== "number" || !Number.isFinite(s.score) || typeof s.handle !== "string" || typeof s.at !== "number") return null;
    out.push({ rank: 0, handle: s.handle.slice(0, 32), score: s.score, at: s.at });
  }
  return out;
}

export type ImportSavesResult = { imported: number; scores: number; rejected: { gameId: string; reason: string }[] };

export class SaveStore {
  constructor(
    private kv: KvStore,
    private now: () => number = Date.now,
  ) {}

  get persistent(): boolean {
    return this.kv.persistent;
  }

  async load(gameId: string): Promise<SaveRecord | null> {
    const raw = await this.kv.get<unknown>("saves", gameId);
    if (raw === undefined) return null;
    const r = migrateSaveRecord(raw);
    return "error" in r ? null : r;
  }

  async save(gameId: string, gameVersion: string, data: SaveData): Promise<SaveRecord> {
    const record: SaveRecord = { saveFormat: SAVE_FORMAT_VERSION, gameId, gameVersion, updatedAt: this.now(), data };
    await this.kv.put("saves", gameId, record);
    return record;
  }

  async remove(gameId: string): Promise<void> {
    await this.kv.delete("saves", gameId);
    await this.kv.delete("scores", gameId);
  }

  async scores(gameId: string, order: "desc" | "asc" = "desc"): Promise<ScoreEntry[]> {
    const list = validScores((await this.kv.get<unknown>("scores", gameId)) ?? []) ?? [];
    return rank(list, order);
  }

  /** Add a score and return its rank on the local board (1 = best). */
  async addScore(gameId: string, score: number, handle: string, order: "desc" | "asc" = "desc"): Promise<number> {
    const entry: ScoreEntry = { rank: 0, handle, score, at: this.now() };
    const sorted = sortScores([...(await this.scores(gameId, order)), entry], order);
    const position = sorted.indexOf(entry) + 1; // by identity, before rank() copies
    await this.kv.put("scores", gameId, rank(sorted, order).slice(0, MAX_SCORES_PER_GAME));
    return position;
  }

  async exportAll(): Promise<SaveExport> {
    const saves = (await this.kv.getAll<unknown>("saves"))
      .map(migrateSaveRecord)
      .filter((r): r is SaveRecord => !("error" in r));
    const scores: Record<string, ScoreEntry[]> = {};
    for (const gameId of await this.kv.keys("scores")) {
      const list = validScores((await this.kv.get<unknown>("scores", gameId)) ?? []);
      if (list && list.length > 0) scores[gameId] = list;
    }
    return {
      format: SAVE_EXPORT_FORMAT,
      version: SAVE_FORMAT_VERSION,
      exportedAt: new Date(this.now()).toISOString(),
      launcherVersion: LAUNCHER_VERSION,
      saves,
      scores,
    };
  }

  /**
   * Import an export file. The file is the player's explicit choice, so its
   * saves REPLACE the stored ones for the same games, and its scores are merged
   * in (duplicates by time and value are not doubled). Each game is checked
   * on its own: a bad record is reported and the rest still import.
   */
  async importAll(json: unknown): Promise<ImportSavesResult> {
    if (!isObj(json) || json.format !== SAVE_EXPORT_FORMAT) throw new Error("This is not a HallPass Offline Arcade save file.");
    if (typeof json.version !== "number" || json.version > SAVE_FORMAT_VERSION) {
      throw new Error("This save file was made by a newer version of the arcade.");
    }
    if (!Array.isArray(json.saves)) throw new Error("This save file is damaged.");
    const result: ImportSavesResult = { imported: 0, scores: 0, rejected: [] };
    for (const raw of json.saves) {
      const r = migrateSaveRecord(raw);
      if ("error" in r) {
        result.rejected.push({ gameId: isObj(raw) && typeof raw.gameId === "string" ? raw.gameId.slice(0, 64) : "?", reason: r.error });
        continue;
      }
      await this.kv.put("saves", r.gameId, r);
      result.imported++;
    }
    if (isObj(json.scores)) {
      for (const [gameId, raw] of Object.entries(json.scores)) {
        const list = PACKAGE_ID_RE.test(gameId) ? validScores(raw) : null;
        if (!list) {
          result.rejected.push({ gameId: gameId.slice(0, 64), reason: "scores are invalid" });
          continue;
        }
        const existing = validScores((await this.kv.get<unknown>("scores", gameId)) ?? []) ?? [];
        const seen = new Set(existing.map((s) => `${s.at}:${s.score}:${s.handle}`));
        const merged = [...existing, ...list.filter((s) => !seen.has(`${s.at}:${s.score}:${s.handle}`))];
        // Ranking needs the game's score order, which lives in its package;
        // boards are ranked on read, so here only the most recent are capped.
        merged.sort((a, b) => b.at - a.at);
        await this.kv.put("scores", gameId, merged.slice(0, MAX_STORED_SCORES));
        result.scores += list.length;
      }
    }
    return result;
  }
}

/** Best first; ties go to the earlier score. */
function sortScores(list: ScoreEntry[], order: "desc" | "asc"): ScoreEntry[] {
  return [...list].sort((a, b) => (order === "desc" ? b.score - a.score : a.score - b.score) || a.at - b.at);
}

function rank(list: ScoreEntry[], order: "desc" | "asc"): ScoreEntry[] {
  return sortScores(list, order).map((s, i) => ({ ...s, rank: i + 1 }));
}
