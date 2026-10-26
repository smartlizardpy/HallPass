import { describe, expect, it } from "vitest";
import { FRIGHT_FEST_2026 as C } from "./fright-fest-2026";
import { boundedMeta, hashToken, issueRun, newToken, submitRun, TOKEN_LIMIT } from "./intake";
import type { BestRun } from "./standings";
import type { ChampionshipStore, CompleteRunInput, EventSnapshot, RunForSubmission } from "./store";
import type { EventState, GameState, RunStatus } from "./types";

const LB = C.games[0];
const OPENS = Date.parse(C.opensAt);
const CLOSES = Date.parse(C.closesAt);

interface FakeRun {
  id: number;
  playerId: string;
  gameSlug: string;
  hash: string;
  seed: number | null;
  issuedMs: number;
  expiresMs: number;
  status: RunStatus;
  score: number | null;
  tiebreak: number | null;
  reason: string | null;
  submittedMs: number | null;
  meta?: Record<string, unknown>;
}

/** An in-memory store with the same guarded semantics as the SQL, and a settable clock. */
function fakeStore(opts: { state?: Partial<EventState>; games?: GameState[]; now?: number } = {}) {
  const runs: FakeRun[] = [];
  const db = {
    now: opts.now ?? OPENS + 3_600_000,
    state: { status: "scheduled", suspended: false, suspendedReason: null, closedEarlyAt: null, finalisedAt: null, ...opts.state } as EventState,
    games: opts.games ?? [{ slug: "last-bell", status: "open", openedAt: C.opensAt } as GameState],
    missing: false,
  };
  const store: Pick<ChampionshipStore, "readEvent" | "issueToken" | "findRun" | "completeRun" | "bestRuns"> = {
    async readEvent(): Promise<EventSnapshot | null> {
      return db.missing ? null : { state: db.state, games: db.games, nowMs: db.now };
    },
    async issueToken(i) {
      const recent = runs.filter((r) => r.playerId === i.playerId && r.issuedMs > db.now - i.windowSec * 1000).length;
      if (recent >= i.limit) return null;
      const r: FakeRun = {
        id: runs.length + 1,
        playerId: i.playerId,
        gameSlug: i.gameSlug,
        hash: i.tokenHash,
        seed: i.seed,
        issuedMs: db.now,
        expiresMs: db.now + i.ttlSec * 1000,
        status: "issued",
        score: null,
        tiebreak: null,
        reason: null,
        submittedMs: null,
      };
      runs.push(r);
      return { runId: r.id, issuedAt: new Date(r.issuedMs).toISOString(), expiresAt: new Date(r.expiresMs).toISOString() };
    },
    async findRun(i): Promise<RunForSubmission | null> {
      const r = runs.find((x) => x.hash === i.tokenHash && x.playerId === i.playerId && x.gameSlug === i.gameSlug);
      if (!r) return null;
      return {
        id: r.id,
        status: r.status,
        seed: r.seed,
        issuedAt: new Date(r.issuedMs).toISOString(),
        expired: db.now > r.expiresMs,
        elapsedSec: (db.now - r.issuedMs) / 1000,
        nowMs: db.now,
        score: r.score,
        tiebreak: r.tiebreak,
        flags: [],
        reason: r.reason,
        submittedAt: r.submittedMs === null ? null : new Date(r.submittedMs).toISOString(),
      };
    },
    async completeRun(i: CompleteRunInput) {
      const r = runs.find((x) => x.id === i.runId && x.playerId === i.playerId && x.status === "issued");
      if (!r) return null;
      const gap = runs.some(
        (o) => o.playerId === i.playerId && o.gameSlug === i.gameSlug && o.id !== i.runId && o.submittedMs !== null && o.submittedMs > db.now - i.minGapSec * 1000,
      );
      if (gap) return null;
      Object.assign(r, { status: i.status, score: i.score, tiebreak: i.tiebreak, reason: i.reason, submittedMs: db.now, meta: i.meta });
      return { id: r.id, status: r.status, submittedAt: new Date(db.now).toISOString() };
    },
    async bestRuns(): Promise<BestRun[]> {
      return runs
        .filter((r) => r.status === "accepted")
        .map((r) => ({
          runId: r.id,
          gameSlug: r.gameSlug,
          playerId: r.playerId,
          publicId: `pub-${r.playerId}`,
          name: r.playerId,
          avatar: "",
          score: r.score!,
          tiebreak: r.tiebreak,
          submittedAt: new Date(r.submittedMs!).toISOString(),
        }));
    },
  };
  return { store, db, runs };
}

/** Start a run, let `seconds` pass, then submit a Last Bell escape that used `used` seconds of clock. */
async function play(f: ReturnType<typeof fakeStore>, player: string, seconds: number, used: number, extra: Record<string, unknown> = {}) {
  const issued = await issueRun(f.store, C, LB, player, { seed: 2026118 });
  if (!issued.ok) throw new Error(`not issued: ${issued.reason}`);
  f.db.now += seconds * 1000;
  return {
    token: issued.token,
    result: await submitRun(f.store, C, LB, player, {
      score: 480 - used,
      meta: { event: "fright-fest-2026", v: 1, seed: 2026118, time: used + 0.4, wall: used + 1, bound: 40, flags: [], token: issued.token, ...extra },
    }),
  };
}

describe("tokens", () => {
  it("are 32 random bytes, and only their hash is stored", async () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
    const f = fakeStore();
    const issued = await issueRun(f.store, C, LB, "p1", { seed: 2026118 });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(f.runs[0].hash).toBe(hashToken(issued.token));
    expect(JSON.stringify(f.runs)).not.toContain(issued.token);
  });

  it("are refused outside the window, on a pending board, or when the tables are missing", async () => {
    expect(await issueRun(fakeStore({ now: OPENS - 1 }).store, C, LB, "p", {})).toEqual({ ok: false, reason: "upcoming" });
    expect(await issueRun(fakeStore({ now: CLOSES }).store, C, LB, "p", {})).toEqual({ ok: false, reason: "closed" });
    expect(await issueRun(fakeStore({ games: [] }).store, C, LB, "p", {})).toEqual({ ok: false, reason: "board-pending" });
    const f = fakeStore();
    f.db.missing = true;
    expect(await issueRun(f.store, C, LB, "p", {})).toEqual({ ok: false, reason: "unavailable" });
  });

  it("are rate-limited per player", async () => {
    const f = fakeStore();
    for (let i = 0; i < TOKEN_LIMIT; i++) expect((await issueRun(f.store, C, LB, "p1", {})).ok).toBe(true);
    expect(await issueRun(f.store, C, LB, "p1", {})).toEqual({ ok: false, reason: "rate-limited" });
    expect((await issueRun(f.store, C, LB, "p2", {})).ok).toBe(true);
  });

  it("ignore a non-integer seed", async () => {
    const f = fakeStore();
    await issueRun(f.store, C, LB, "p1", { seed: "2026118" });
    expect(f.runs[0].seed).toBeNull();
  });
});

describe("submitRun", () => {
  it("records a clean run, ranks it, and never stores the token", async () => {
    const f = fakeStore();
    const { result } = await play(f, "p1", 200, 180);
    expect(result).toEqual({ ok: true, status: "accepted", rank: 1, best: true, duplicate: false, late: false });
    expect(f.runs[0]).toMatchObject({ status: "accepted", score: 300 });
    expect(f.runs[0].meta).not.toHaveProperty("token");
  });

  it("needs a token, and only the player's own", async () => {
    const f = fakeStore();
    expect(await submitRun(f.store, C, LB, "p1", { score: 300, meta: {} })).toEqual({ ok: false, reason: "no-run" });
    expect(await submitRun(f.store, C, LB, "p1", { score: 300, meta: { token: "short" } })).toEqual({ ok: false, reason: "no-run" });
    const issued = await issueRun(f.store, C, LB, "p1", {});
    if (!issued.ok) throw new Error();
    f.db.now += 200_000;
    expect(await submitRun(f.store, C, LB, "thief", { score: 300, meta: { token: issued.token } })).toEqual({ ok: false, reason: "unknown-run" });
    expect(await submitRun(f.store, C, LB, "p1", { score: 300, meta: { token: newToken() } })).toEqual({ ok: false, reason: "unknown-run" });
  });

  it("is single-use: a retry replays the stored outcome, a changed score cannot overwrite it", async () => {
    const f = fakeStore();
    const { token } = await play(f, "p1", 200, 180);
    const again = await submitRun(f.store, C, LB, "p1", { score: 480, meta: { token, time: 1 } });
    expect(again).toEqual({ ok: true, status: "accepted", rank: null, best: false, duplicate: true, late: false });
    expect(f.runs[0].score).toBe(300);
  });

  it("rejects what the server's clock proves impossible, and spends the token", async () => {
    const f = fakeStore();
    const { token, result } = await play(f, "p1", 30, 180); // 180 s of clock in 30 s of real time
    expect(result).toEqual({ ok: false, reason: "rejected", detail: "clock-faster-than-real-time" });
    expect(f.runs[0].status).toBe("rejected");
    expect(await submitRun(f.store, C, LB, "p1", { score: 300, meta: { token } })).toEqual({
      ok: false,
      reason: "already-rejected",
      detail: "clock-faster-than-real-time",
    });
  });

  it("holds a run whose own numbers disagree for review, unranked", async () => {
    const f = fakeStore();
    const { result } = await play(f, "p1", 200, 180, { time: 100 });
    expect(result).toEqual({ ok: true, status: "flagged", rank: null, best: false, duplicate: false, late: false });
  });

  it("spends an expired token as rejected", async () => {
    const f = fakeStore();
    const { result } = await play(f, "p1", C.tokenTtlSec + 1, 180);
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(f.runs[0]).toMatchObject({ status: "rejected", reason: "expired" });
  });

  it("gives a run started before the close its grace, and refuses after it", async () => {
    const f = fakeStore({ now: CLOSES - 120_000 });
    const { result } = await play(f, "p1", 200, 180); // finishes 80 s after the close
    expect(result).toMatchObject({ ok: true, status: "accepted", late: true });
    const g = fakeStore({ now: CLOSES - 120_000 });
    const { result: tooLate } = await play(g, "p1", 120 + C.submitGraceSec + 1, 180);
    expect(tooLate).toEqual({ ok: false, reason: "closed" });
    expect(g.runs[0].status).toBe("issued");
  });

  it("refuses a run on a board paused mid-run without spending it", async () => {
    const f = fakeStore();
    const issued = await issueRun(f.store, C, LB, "p1", {});
    if (!issued.ok) throw new Error();
    f.db.now += 200_000;
    f.db.games = [{ slug: "last-bell", status: "paused", openedAt: C.opensAt }];
    expect(await submitRun(f.store, C, LB, "p1", { score: 300, meta: { token: issued.token, time: 180.4, seed: 2026118, event: "fright-fest-2026" } })).toEqual({
      ok: false,
      reason: "board-paused",
    });
    expect(f.runs[0].status).toBe("issued");
  });

  it("enforces the per-board gap between two recorded runs", async () => {
    const f = fakeStore();
    const a = await issueRun(f.store, C, LB, "p1", {});
    const b = await issueRun(f.store, C, LB, "p1", {});
    if (!a.ok || !b.ok) throw new Error();
    f.db.now += 200_000;
    const meta = { event: "fright-fest-2026", seed: 2026118, time: 180.4, wall: 181, bound: 40, flags: [] };
    expect((await submitRun(f.store, C, LB, "p1", { score: 300, meta: { ...meta, token: a.token } })).ok).toBe(true);
    expect(await submitRun(f.store, C, LB, "p1", { score: 300, meta: { ...meta, token: b.token } })).toEqual({ ok: false, reason: "rate-limited" });
  });

  it("ranks against other players and reports whether this run is the player's best", async () => {
    const f = fakeStore();
    await play(f, "p1", 200, 150);
    const { result } = await play(f, "p2", 200, 180);
    expect(result).toMatchObject({ ok: true, rank: 2, best: true });
    f.db.now += 60_000;
    const { result: worse } = await play(f, "p2", 300, 250);
    expect(worse).toMatchObject({ ok: true, rank: 2, best: false });
  });
});

describe("boundedMeta", () => {
  it("keeps small plain objects and drops oversized or odd ones whole", () => {
    expect(boundedMeta({ a: 1 })).toEqual({ a: 1 });
    expect(boundedMeta([1, 2])).toEqual({});
    expect(boundedMeta("x")).toEqual({});
    expect(boundedMeta({ big: "x".repeat(5000) })).toEqual({ truncated: true, bytes: expect.any(Number) });
  });
});
