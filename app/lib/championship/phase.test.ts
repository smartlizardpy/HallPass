import { describe, expect, it } from "vitest";
import { championshipBoard, championshipById, championshipsForGame, CHAMPIONSHIPS } from "./config";
import { clock, formatLastMinute, formatScore, formatTiebreak, msClock, ordinal } from "./format";
import { FRIGHT_FEST_2026 as C } from "./fright-fest-2026";
import { boardAccepting, championshipPhase, closeAtMs } from "./phase";
import { games as catalogue } from "../games";
import type { EventState, GameState } from "./types";

const OPENS = Date.parse(C.opensAt);
const CLOSES = Date.parse(C.closesAt);
const state = (over: Partial<EventState> = {}): EventState => ({
  status: "scheduled",
  suspended: false,
  suspendedReason: null,
  closedEarlyAt: null,
  finalisedAt: null,
  ...over,
});
const lb: GameState = { slug: "last-bell", status: "open", openedAt: C.opensAt };

describe("the Fright Fest 2026 window", () => {
  it("is 28 Oct 00:00 UTC to 2 Nov 00:00 UTC, five days", () => {
    expect(OPENS).toBe(Date.UTC(2026, 9, 28));
    expect(CLOSES).toBe(Date.UTC(2026, 10, 2));
    expect((CLOSES - OPENS) / 86_400_000).toBe(5);
  });
});

describe("championshipPhase", () => {
  it("moves upcoming → live → closed at the exact milliseconds", () => {
    expect(championshipPhase(C, state(), OPENS - 1)).toBe("upcoming");
    expect(championshipPhase(C, state(), OPENS)).toBe("live");
    expect(championshipPhase(C, state(), CLOSES - 1)).toBe("live");
    expect(championshipPhase(C, state(), CLOSES)).toBe("closed");
  });
  it("follows an admin's early close, verification, finalisation and archive", () => {
    const early = new Date(OPENS + 3_600_000).toISOString();
    expect(closeAtMs(C, state({ closedEarlyAt: early }))).toBe(OPENS + 3_600_000);
    expect(championshipPhase(C, state({ closedEarlyAt: early }), OPENS + 3_600_000)).toBe("closed");
    // An "early" close after the configured one changes nothing.
    expect(closeAtMs(C, state({ closedEarlyAt: "2027-01-01T00:00:00Z" }))).toBe(CLOSES);
    expect(championshipPhase(C, state({ status: "verification" }), CLOSES)).toBe("verification");
    expect(championshipPhase(C, state({ status: "finalised" }), OPENS + 1)).toBe("finalised");
    expect(championshipPhase(C, state({ status: "archived" }), CLOSES + 1)).toBe("archived");
  });
  it("lets suspension beat the clock but not a finalised result", () => {
    expect(championshipPhase(C, state({ suspended: true }), OPENS + 1)).toBe("suspended");
    expect(championshipPhase(C, state({ suspended: true, status: "finalised" }), OPENS + 1)).toBe("finalised");
  });
  it("is off when the code switch is off, and follows the clock when the row is unreadable", () => {
    expect(championshipPhase({ ...C, enabled: false }, state(), OPENS + 1)).toBe("off");
    expect(championshipPhase(C, null, OPENS + 1)).toBe("live");
  });
});

describe("boardAccepting", () => {
  it("takes runs only while live, on an open board, after the board's own opening", () => {
    expect(boardAccepting(C, state(), lb, OPENS)).toEqual({ ok: true });
    expect(boardAccepting(C, state(), lb, OPENS - 1)).toEqual({ ok: false, reason: "upcoming" });
    expect(boardAccepting(C, state(), lb, CLOSES)).toEqual({ ok: false, reason: "closed" });
    expect(boardAccepting(C, state({ suspended: true }), lb, OPENS)).toEqual({ ok: false, reason: "suspended" });
    expect(boardAccepting(C, state(), { ...lb, status: "paused" }, OPENS)).toEqual({ ok: false, reason: "board-paused" });
    expect(boardAccepting(C, state(), { ...lb, status: "withdrawn" }, OPENS)).toEqual({ ok: false, reason: "board-withdrawn" });
    expect(boardAccepting(C, state(), { slug: "x", status: "pending", openedAt: null }, OPENS)).toEqual({ ok: false, reason: "board-pending" });
    expect(boardAccepting(C, state(), undefined, OPENS)).toEqual({ ok: false, reason: "board-pending" });
    const later = { ...lb, openedAt: new Date(OPENS + 86_400_000).toISOString() };
    expect(boardAccepting(C, state(), later, OPENS + 1)).toEqual({ ok: false, reason: "board-not-open-yet" });
    expect(boardAccepting(C, state(), later, OPENS + 86_400_000)).toEqual({ ok: true });
  });
});

describe("the registry", () => {
  it("finds championship boards and nothing else", () => {
    expect(championshipBoard("last-bell-halloween-shift")?.game.slug).toBe("last-bell");
    expect(championshipBoard("last-bell")).toBeUndefined();
    expect(championshipBoard("haloween-fastest-level-time")).toBeUndefined();
    expect(championshipById("fright-fest-2026")).toBe(C);
    expect(championshipsForGame("last-bell").map((c) => c.id)).toEqual(["fright-fest-2026"]);
    expect(championshipsForGame("neon-snake")).toEqual([]);
  });

  it("every configured game is a real catalogue game, every board id is unique and valid", () => {
    const slugs = new Set(catalogue.map((g) => g.slug));
    const boards = CHAMPIONSHIPS.flatMap((c) => c.games.map((g) => g.board));
    expect(new Set(boards).size).toBe(boards.length);
    for (const c of CHAMPIONSHIPS) {
      expect(c.id).toMatch(/^[a-z0-9][a-z0-9-]{1,63}$/);
      expect(Date.parse(c.opensAt)).toBeLessThan(Date.parse(c.closesAt));
      for (const g of c.games) {
        expect(slugs.has(g.slug), g.slug).toBe(true);
        expect(g.board).toMatch(/^[a-z0-9][a-z0-9-]{1,63}$/);
        expect(g.board).not.toBe(g.slug); // never the game's ordinary board
        expect(c.rewards.gameChampion[g.slug], `champion pack for ${g.slug}`).toBeTruthy();
      }
    }
  });

  it("marks only Last Bell's rules as verified", () => {
    expect(C.games.filter((g) => g.rules === "verified").map((g) => g.slug)).toEqual(["last-bell"]);
  });
});

describe("format", () => {
  it("writes clocks, splits and ordinals", () => {
    expect(clock(312)).toBe("5:12");
    expect(msClock(83_456)).toBe("1:23.456");
    expect(formatScore(C.games[0].metric, 312)).toBe("5:12");
    expect(formatTiebreak(C.games[0].metric, 168.27)).toBe("2:48.27");
    expect(formatTiebreak(C.games[2].metric, 1400)).toBe("1,400");
    expect(formatTiebreak(C.games[0].metric, null)).toBeNull();
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
  it("writes an exclusive close as its last minute, in UK time", () => {
    expect(formatLastMinute(C.closesAt, C.timeZone)).toBe("Sun 1 Nov, 23:59");
  });
});
