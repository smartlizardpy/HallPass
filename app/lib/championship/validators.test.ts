import { describe, expect, it } from "vitest";
import {
  LAST_BELL,
  SCP_HAUNTING,
  validateLastBell,
  validateScpLockdownHaunting,
  validateShadowCoreCursedDash,
  validateSurviveTillDawnBloodMoon,
} from "./validators";

/** A real-looking Last Bell escape: 5:12 left after 2:48 of play, 3 minutes of real time. */
const lb = (over: { score?: unknown; meta?: Record<string, unknown>; elapsedSec?: number; startSeed?: number | null } = {}) =>
  validateLastBell({
    score: "score" in over ? over.score : 312,
    meta: { event: "fright-fest-2026", v: 1, seed: 2026118, time: 168.2, wall: 169.4, bound: 41.3, flags: [], ...over.meta },
    elapsedSec: over.elapsedSec ?? 180,
    startSeed: over.startSeed === undefined ? 2026118 : over.startSeed,
  });

describe("validateLastBell", () => {
  it("accepts a clean escape and ties on game time", () => {
    const r = lb();
    expect(r).toMatchObject({ ok: true, score: 312, tiebreak: 168.2, flags: [] });
  });

  it("rejects anything off the 0–480 integer scale", () => {
    for (const score of [-1, 481, 312.5, "312", null, Infinity]) {
      expect(lb({ score })).toMatchObject({ ok: false, reason: "bad-score" });
    }
    expect(lb({ score: 0, meta: { time: 480 }, elapsedSec: 600 }).ok).toBe(true);
  });

  it("rejects the wrong event or school, whichever end declared it", () => {
    expect(lb({ meta: { event: "fright-fest-2025" } })).toMatchObject({ ok: false, reason: "wrong-event" });
    expect(lb({ meta: { seed: 1 } })).toMatchObject({ ok: false, reason: "wrong-school" });
    expect(lb({ startSeed: 1 })).toMatchObject({ ok: false, reason: "wrong-school" });
    expect(lb({ startSeed: null }).ok).toBe(true);
  });

  it("rejects an escape faster than the school's straight-line route", () => {
    const score = LAST_BELL.clock - LAST_BELL.routeFloorSec + 1; // 25 s used
    expect(lb({ score, meta: { time: 25 } })).toMatchObject({ ok: false, reason: "faster-than-route" });
  });

  it("rejects a clock that ran faster than the server's real time, allowing for latency", () => {
    // 168 s of clock used: fine with 160 s elapsed (8 s slack), impossible with 159.
    expect(lb({ elapsedSec: 160 }).ok).toBe(true);
    expect(lb({ elapsedSec: 159 })).toMatchObject({ ok: false, reason: "clock-faster-than-real-time" });
  });

  it("holds a run for review when the game's own numbers disagree", () => {
    expect(lb({ meta: { time: 150 } })).toMatchObject({ ok: true, flags: ["game-time-mismatch"] });
    expect(lb({ meta: { wall: 160 } })).toMatchObject({ ok: true, flags: ["game-time-ahead-of-wall"] });
    expect(lb({ meta: { bound: 200 } })).toMatchObject({ ok: true, flags: ["faster-than-game-route"] });
    expect(lb({ meta: { flags: ["speed", 3] } })).toMatchObject({ ok: true, flags: ["game:speed"] });
    expect(lb({ meta: { time: undefined } })).toMatchObject({ ok: true, flags: ["no-game-time"], tiebreak: 168 });
  });

  it("records the server's evidence for reviewers", () => {
    const r = lb();
    expect(r.checks).toMatchObject({ elapsedSec: 180, clockUsedSec: 168, gameTimeSec: 168.2, seed: 2026118 });
  });
});

describe("validateShadowCoreCursedDash (proposed)", () => {
  const splits = Array.from({ length: 15 }, () => 8_000);
  const sc = (over: Record<string, unknown> = {}, score: unknown = 120_000, elapsedSec = 400) =>
    validateShadowCoreCursedDash({
      score,
      meta: { event: "fright-fest-2026", mode: "cursed-dash", splits, deaths: 4, ...over },
      elapsedSec,
      startSeed: null,
    });

  it("accepts a consistent run, deaths break ties", () => {
    expect(sc()).toMatchObject({ ok: true, score: 120_000, tiebreak: 4, flags: [] });
  });
  it("rejects the impossible", () => {
    expect(sc({}, 1_000)).toMatchObject({ ok: false, reason: "bad-score" });
    expect(sc({ mode: "normal" })).toMatchObject({ ok: false, reason: "wrong-mode" });
    expect(sc({}, 120_000, 100)).toMatchObject({ ok: false, reason: "clock-faster-than-real-time" });
    expect(sc({ splits: splits.map((s, i) => (i ? s : s + 500)) })).toMatchObject({ ok: false, reason: "splits-do-not-add-up" });
  });
  it("flags what it cannot check", () => {
    expect(sc({ splits: undefined })).toMatchObject({ ok: true, flags: ["no-splits"] });
    expect(sc({ splits: splits.map(() => 4_000) }, 60_000).ok && sc({ splits: splits.map(() => 4_000) }, 60_000)).toMatchObject({
      flags: ["unusually-fast"],
    });
  });
});

describe("validateScpLockdownHaunting (proposed)", () => {
  /** A clean Normal-difficulty escape in 2:00 (120,000 ms) after 130 s of real time. */
  const scp = (over: { score?: unknown; meta?: Record<string, unknown>; elapsedSec?: number; startSeed?: number | null } = {}) =>
    validateScpLockdownHaunting({
      score: "score" in over ? over.score : 120_000,
      meta: {
        event: "fright-fest-2026",
        v: 1,
        mode: "haunt",
        diff: 1,
        seed: 20261031,
        coop: false,
        time: 120.05,
        wall: 121,
        banished: 3,
        flags: [],
        ...over.meta,
      },
      elapsedSec: over.elapsedSec ?? 130,
      startSeed: over.startSeed === undefined ? 20261031 : over.startSeed,
    });

  it("accepts a clean escape, ghosts banished break ties", () => {
    expect(scp()).toMatchObject({ ok: true, score: 120_000, tiebreak: 3, flags: [] });
    expect(scp({ meta: { banished: 0 } })).toMatchObject({ ok: true, tiebreak: 0, flags: [] });
  });

  it("rejects a score off the scale", () => {
    for (const score of [29_999, SCP_HAUNTING.maxEscapeMs + 1, 120_000.5, "120000", null, Infinity]) {
      expect(scp({ score, elapsedSec: 4000 })).toMatchObject({ ok: false, reason: "bad-score" });
    }
    expect(scp({ score: SCP_HAUNTING.minEscapeMs, meta: { time: 30 }, elapsedSec: 40 }).ok).toBe(true);
    expect(scp({ score: SCP_HAUNTING.maxEscapeMs, meta: { time: 3600 }, elapsedSec: 3600 }).ok).toBe(true);
  });

  it("rejects the wrong event, mode, co-op and difficulty", () => {
    expect(scp({ meta: { event: "fright-fest-2025" } })).toMatchObject({ ok: false, reason: "wrong-event" });
    expect(scp({ meta: { mode: "trick-or-treat" } })).toMatchObject({ ok: false, reason: "wrong-mode" });
    expect(scp({ meta: { coop: true } })).toMatchObject({ ok: false, reason: "co-op-not-ranked" });
    expect(scp({ meta: { diff: 2 } })).toMatchObject({ ok: false, reason: "wrong-difficulty" });
    expect(scp({ meta: { diff: undefined } })).toMatchObject({ ok: false, reason: "wrong-difficulty" });
  });

  it("rejects the wrong site layout, whichever end declared it", () => {
    expect(scp({ meta: { seed: 1 } })).toMatchObject({ ok: false, reason: "wrong-layout" });
    expect(scp({ startSeed: 1 })).toMatchObject({ ok: false, reason: "wrong-layout" });
    expect(scp({ startSeed: null }).ok).toBe(true);
  });

  it("rejects a clock that ran faster than the server's real time, allowing for latency", () => {
    // 120 s of clock: fine with 112 s elapsed (8 s slack), impossible with 111.
    expect(scp({ elapsedSec: 112 }).ok).toBe(true);
    expect(scp({ elapsedSec: 111 })).toMatchObject({ ok: false, reason: "clock-faster-than-real-time" });
  });

  it("checks in the documented order", () => {
    expect(scp({ score: 1, meta: { event: "x", mode: "x", coop: true, diff: 9, seed: 1 }, elapsedSec: 0 })).toMatchObject({ reason: "bad-score" });
    expect(scp({ meta: { event: "x", mode: "x", coop: true, diff: 9, seed: 1 }, elapsedSec: 0 })).toMatchObject({ reason: "wrong-event" });
    expect(scp({ meta: { mode: "x", coop: true, diff: 9, seed: 1 }, elapsedSec: 0 })).toMatchObject({ reason: "wrong-mode" });
    expect(scp({ meta: { coop: true, diff: 9, seed: 1 }, elapsedSec: 0 })).toMatchObject({ reason: "co-op-not-ranked" });
    expect(scp({ meta: { diff: 9, seed: 1 }, elapsedSec: 0 })).toMatchObject({ reason: "wrong-difficulty" });
    expect(scp({ meta: { seed: 1 }, elapsedSec: 0 })).toMatchObject({ reason: "wrong-layout" });
    expect(scp({ elapsedSec: 0 })).toMatchObject({ reason: "clock-faster-than-real-time" });
  });

  it("holds a run for review when the game's own numbers disagree", () => {
    expect(scp({ meta: { flags: ["speed", 3] } })).toMatchObject({ ok: true, flags: ["game:speed"] });
    expect(scp({ meta: { time: undefined } })).toMatchObject({ ok: true, flags: ["no-game-time"] });
    expect(scp({ meta: { time: 118.9 } })).toMatchObject({ ok: true, flags: ["game-time-mismatch"] });
    expect(scp({ meta: { time: 119.1, wall: 119.2 } }).flags).toEqual([]);
    expect(scp({ meta: { wall: 117 } })).toMatchObject({ ok: true, flags: ["game-time-ahead-of-wall"] });
    for (const banished of [undefined, -1, 2.5, "3"]) {
      expect(scp({ meta: { banished } })).toMatchObject({ ok: true, tiebreak: null, flags: ["no-banished"] });
    }
    expect(scp({ score: 45_000, meta: { time: 45 }, elapsedSec: 60 })).toMatchObject({ ok: true, flags: ["unusually-fast"] });
    expect(scp({ score: SCP_HAUNTING.reviewBelowMs, meta: { time: 60 }, elapsedSec: 70 }).flags).toEqual([]);
  });

  it("records the server's evidence for reviewers", () => {
    expect(scp().checks).toEqual({
      elapsedSec: 130,
      escapeMs: 120_000,
      gameTimeSec: 120.05,
      wallTimeSec: 121,
      seed: 20261031,
      diff: 1,
      banished: 3,
    });
  });
});

describe("validateSurviveTillDawnBloodMoon (proposed)", () => {
  const st = (over: Record<string, unknown> = {}, score: unknown = 900, elapsedSec = 1000) =>
    validateSurviveTillDawnBloodMoon({
      score,
      meta: { event: "fright-fest-2026", mode: "blood-moon", kills: 1400, coop: false, ...over },
      elapsedSec,
      startSeed: null,
    });

  it("accepts a solo night, kills break ties", () => {
    expect(st()).toMatchObject({ ok: true, score: 900, tiebreak: 1400, flags: [] });
    expect(st({}, 1200, 1300).ok).toBe(true);
  });
  it("rejects co-op, the wrong mode, past dawn, and fast clocks", () => {
    expect(st({ coop: true })).toMatchObject({ ok: false, reason: "co-op-not-ranked" });
    expect(st({ mode: "woods" })).toMatchObject({ ok: false, reason: "wrong-mode" });
    expect(st({}, 1201)).toMatchObject({ ok: false, reason: "bad-score" });
    expect(st({}, 900, 800)).toMatchObject({ ok: false, reason: "clock-faster-than-real-time" });
  });
  it("flags an implausible kill rate", () => {
    expect(st({ kills: 900 * 20 })).toMatchObject({ ok: true, flags: ["unusual-kill-rate"] });
  });
});
