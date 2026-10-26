/**
 * HallPass — the championship intake: issuing run tokens and recording runs.
 *
 * The store is injected, so every rule here is unit-tested without a database;
 * the routes bind the live store. Nothing here trusts the browser: the clock is
 * the database's, the score is checked by the game's validator against the
 * server-measured run time, and a token is good for one run by one player on
 * one board.
 *
 * THE FLOW. `issueRun` hands the game a random token (only its SHA-256 is
 * stored) when a run starts. `submitRun` looks the run up by that hash AND the
 * signed-in player, so a token that leaks to somebody else is useless to them;
 * validates; then completes it in one guarded UPDATE that only succeeds while
 * the run is still `issued`. A retry of the same submission returns the stored
 * outcome instead of a second entry.
 */

import { createHash, randomBytes } from "node:crypto";
import { boardAccepting, submissionAccepting, type NotAccepting, type NotRecording } from "./phase";
import { rankBoard } from "./standings";
import type { ChampionshipStore } from "./store";
import type { ChampionshipConfig, ChampionshipGame, RunStatus } from "./types";

/** Per player, across the championship: how many runs may start in the window. */
export const TOKEN_LIMIT = 20;
export const TOKEN_WINDOW_SEC = 600;
/** Per player per board: the minimum gap between two recorded runs. */
export const SUBMIT_GAP_SEC = 20;
/** The largest `meta` object kept with a run (JSON bytes). */
export const META_MAX_BYTES = 4096;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

type Store = Pick<ChampionshipStore, "readEvent" | "issueToken" | "findRun" | "completeRun" | "bestRuns">;

export type IssueOutcome =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; reason: NotAccepting | "unavailable" | "rate-limited" };

export async function issueRun(
  store: Store,
  c: ChampionshipConfig,
  game: ChampionshipGame,
  playerId: string,
  opts: { seed?: unknown },
): Promise<IssueOutcome> {
  const snap = await store.readEvent(c.id);
  if (!snap) return { ok: false, reason: "unavailable" };
  const gate = boardAccepting(
    c,
    snap.state,
    snap.games.find((g) => g.slug === game.slug),
    snap.nowMs,
  );
  if (!gate.ok) return gate;
  const seed = typeof opts.seed === "number" && Number.isSafeInteger(opts.seed) ? opts.seed : null;
  const token = newToken();
  const issued = await store.issueToken({
    eventId: c.id,
    gameSlug: game.slug,
    playerId,
    tokenHash: hashToken(token),
    seed,
    ttlSec: c.tokenTtlSec,
    limit: TOKEN_LIMIT,
    windowSec: TOKEN_WINDOW_SEC,
  });
  if (!issued) return { ok: false, reason: "rate-limited" };
  return { ok: true, token, expiresAt: issued.expiresAt };
}

export type SubmitOutcome =
  | {
      ok: true;
      status: Extract<RunStatus, "accepted" | "flagged">;
      /** The player's place on the board after this run (accepted runs only). */
      rank: number | null;
      /** True when this run is now the player's best on the board. */
      best: boolean;
      /** True when this answer replays an earlier submission of the same token. */
      duplicate: boolean;
      /** True when recorded inside the post-close grace. */
      late: boolean;
    }
  | {
      ok: false;
      reason:
        | NotRecording
        | "unavailable"
        | "no-run"
        | "unknown-run"
        | "expired"
        | "rejected"
        | "rate-limited"
        | "already-rejected";
      /** For `rejected`: the validator's reason code. */
      detail?: string;
    };

/** Keep `meta` small and plain: drop it whole if it is too big rather than store half of it. */
export function boundedMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  try {
    const json = JSON.stringify(meta);
    if (json.length > META_MAX_BYTES) return { truncated: true, bytes: json.length };
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function placeOf(store: Store, c: ChampionshipConfig, game: ChampionshipGame, playerId: string, runId: number) {
  const runs = await store.bestRuns(c.id, [{ slug: game.slug, metric: game.metric }]);
  const entries = rankBoard(game.metric, c.points, runs);
  const mine = entries.find((e) => e.playerId === playerId);
  return { rank: mine?.rank ?? null, best: mine?.runId === runId };
}

/** What a stored, already-completed run says to a retry of it. */
function replay(status: RunStatus, detail: string | null): SubmitOutcome {
  if (status === "accepted" || status === "flagged") {
    return { ok: true, status, rank: null, best: false, duplicate: true, late: false };
  }
  return { ok: false, reason: "already-rejected", ...(detail ? { detail } : {}) };
}

export async function submitRun(
  store: Store,
  c: ChampionshipConfig,
  game: ChampionshipGame,
  playerId: string,
  body: { score: unknown; meta?: unknown },
): Promise<SubmitOutcome> {
  const meta = boundedMeta(body.meta);
  const token = typeof meta.token === "string" ? meta.token : null;
  if (!token || !TOKEN_RE.test(token)) return { ok: false, reason: "no-run" };
  delete meta.token; // never store the secret, even though it is now spent

  const snap = await store.readEvent(c.id);
  if (!snap) return { ok: false, reason: "unavailable" };
  const run = await store.findRun({ tokenHash: hashToken(token), playerId, eventId: c.id, gameSlug: game.slug });
  if (!run) return { ok: false, reason: "unknown-run" };
  if (run.status !== "issued") return replay(run.status, run.reason);

  const finish = (input: {
    status: "accepted" | "flagged" | "rejected";
    score: number | null;
    tiebreak: number | null;
    checks: Record<string, unknown>;
    flags: string[];
    reason: string | null;
  }) =>
    store.completeRun({
      runId: run.id,
      playerId,
      eventId: c.id,
      gameSlug: game.slug,
      meta,
      minGapSec: SUBMIT_GAP_SEC,
      ...input,
    });

  // An expired token is spent as rejected, so it cannot be tried again.
  if (run.expired) {
    await finish({ status: "rejected", score: null, tiebreak: null, checks: { elapsedSec: run.elapsedSec }, flags: [], reason: "expired" });
    return { ok: false, reason: "expired" };
  }

  const gate = submissionAccepting(
    c,
    snap.state,
    snap.games.find((g) => g.slug === game.slug),
    Date.parse(run.issuedAt),
    run.nowMs,
  );
  // Not recordable now. The token stays unspent: a paused board may resume
  // within its lifetime, and otherwise it simply expires.
  if (!gate.ok) return gate;

  const verdict = game.validate({ score: body.score, meta, elapsedSec: run.elapsedSec, startSeed: run.seed });
  if (!verdict.ok) {
    const done = await finish({
      status: "rejected",
      score: typeof body.score === "number" && Number.isSafeInteger(body.score) ? body.score : null,
      tiebreak: null,
      checks: verdict.checks,
      flags: [],
      reason: verdict.reason,
    });
    if (!done) return settle();
    return { ok: false, reason: "rejected", detail: verdict.reason };
  }

  const status = verdict.flags.length ? "flagged" : "accepted";
  const done = await finish({
    status,
    score: verdict.score,
    tiebreak: verdict.tiebreak,
    checks: { ...verdict.checks, ...(gate.late ? { late: true } : {}) },
    flags: verdict.flags,
    reason: null,
  });
  if (!done) return settle();
  if (status === "flagged") return { ok: true, status, rank: null, best: false, duplicate: false, late: gate.late };
  const place = await placeOf(store, c, game, playerId, run.id).catch(() => ({ rank: null, best: false }));
  return { ok: true, status, rank: place.rank, best: place.best, duplicate: false, late: gate.late };

  /** The guarded UPDATE matched nothing: a concurrent retry won, or the gap applies. */
  async function settle(): Promise<SubmitOutcome> {
    const again = await store.findRun({ tokenHash: hashToken(token!), playerId, eventId: c.id, gameSlug: game.slug });
    if (again && again.status !== "issued") return replay(again.status, again.reason);
    return { ok: false, reason: "rate-limited" };
  }
}
