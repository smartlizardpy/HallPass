import { describe, expect, it } from "vitest";
import type { PublicOverallEntry } from "@/app/lib/championship/standings";
import { championshipSummary } from "@/app/lib/championship/summary";
import { FRIGHT_FEST_2026 } from "@/app/lib/championship/fright-fest-2026";
import type { ChampionshipPhase } from "@/app/lib/championship/types";
import { boardCapacity, countdownText, boardIsOpen, boardRows, cabinetLabel, cabinetStatus, needsLaptop, selectedAnnouncement, tickerCountdownLabel, tickerLine } from "./logic";
import type { CabinetProps } from "./props";

const S = championshipSummary(FRIGHT_FEST_2026);
const LAST_BELL: CabinetProps = {
  open: true,
  slug: "last-bell",
  art: "lastbell",
  title: "Last Bell",
  mode: "The Halloween Shift",
  modeShort: "Halloween Shift",
  rankingRule: "Escape with the most time left.",
  playHref: "/game/last-bell",
  platform: "desktop",
};
const MYSTERY: CabinetProps = { open: false };
const PHASES: ChampionshipPhase[] = ["upcoming", "live", "closed", "verification", "finalised", "archived", "suspended"];

const entry = (rank: number, points: number, publicId = `p${rank}`): PublicOverallEntry => ({
  rank,
  publicId,
  name: `Player ${rank}`,
  avatar: "",
  points,
  games: {},
  gamesWithResult: 1,
  eligible: true,
  missing: [],
  reachedAt: "2026-10-29T10:00:00Z",
});
const TABLE = [entry(1, 100), entry(2, 80), entry(3, 65), entry(4, 40), entry(5, 40), entry(6, 20), entry(7, 20)];

describe("tickerLine", () => {
  it("says the dates, the same for everyone, before the phase is known", () => {
    expect(tickerLine(null, S, false)).toEqual({ text: "28 Oct to 2 Nov", tone: "idle", countdownLabel: null });
  });

  it("has a line for every phase, with a countdown only before the opening and while live", () => {
    const line = (p: ChampionshipPhase) => tickerLine(p, S, false);
    expect(line("upcoming")).toEqual({ text: "Opens 28 Oct", tone: "soon", countdownLabel: "in" });
    expect(line("live")).toEqual({ text: "Live", tone: "live", countdownLabel: "ends in" });
    expect(line("closed").text).toMatch(/Closed/);
    expect(line("verification").text).toBe("Closed · results final by Thu 5 Nov");
    expect(line("finalised")).toMatchObject({ text: "Final results are in", tone: "final" });
    expect(line("archived").text).toBe("Final results are in");
    expect(line("suspended").text).toMatch(/Paused/);
    for (const p of PHASES) expect(line(p).text.length).toBeGreaterThan(3);
    expect(PHASES.filter((p) => line(p).countdownLabel)).toEqual(["upcoming", "live"]);
  });

  it("is shorter on a phone's plate and says 'to be announced' while the championship is off", () => {
    expect(tickerLine("verification", S, true).text.length).toBeLessThan(tickerLine("verification", S, false).text.length);
    expect(tickerLine("live", null, false)).toEqual({ text: "Scoring and rewards: to be announced", tone: "idle", countdownLabel: null });
  });

  it("shows the countdown only when the phase and the clock point at the same moment", () => {
    const at = (p: ChampionshipPhase | null, to: "start" | "end" | null) => tickerCountdownLabel(tickerLine(p, S, false), true, to);
    expect(at("upcoming", "start")).toBe("in");
    expect(at("live", "end")).toBe("ends in");
    // The API still says upcoming in the minute after the opening: no "Opens 28 Oct · ends in 4d".
    expect(at("upcoming", "end")).toBeNull();
    expect(at("live", "start")).toBeNull();
    for (const p of [null, "closed", "verification", "finalised", "archived", "suspended"] as const) {
      expect(at(p, "start")).toBeNull();
      expect(at(p, "end")).toBeNull();
    }
    expect(at("live", null)).toBeNull();
  });

  it("lets the clock alone decide while the championship is off", () => {
    const off = tickerLine(null, null, false);
    expect(tickerCountdownLabel(off, false, "start")).toBe("in");
    expect(tickerCountdownLabel(off, false, "end")).toBe("ends in");
    expect(tickerCountdownLabel(off, false, null)).toBeNull();
  });

  it("writes a countdown", () => {
    expect(countdownText({ d: 1, h: 2, m: 3, s: 4 })).toBe("1d 02:03:04");
    expect(countdownText({ d: 0, h: 23, m: 59, s: 59 })).toBe("23:59:59");
  });

  it("invents no numbers: every digit comes from the summary's own labels", () => {
    for (const p of PHASES) expect(tickerLine(p, S, false).text.replace(/\d+ (Oct|Nov)|23:59/g, "")).not.toMatch(/\d/);
  });
});

describe("cabinetStatus", () => {
  it("a mystery cabinet says nothing about any game", () => {
    const st = cabinetStatus(MYSTERY, "live", S);
    expect(st.chip).toBe("Mystery cabinet");
    expect(JSON.stringify(st)).not.toMatch(/Bell|Shift/);
    expect(cabinetLabel(MYSTERY, 1, 3)).toBe("Mystery cabinet, not announced. Cabinet 2 of 3");
    expect(selectedAnnouncement(MYSTERY, st)).toBe("Mystery cabinet selected. Not announced yet.");
  });

  it("follows the phase for an open game", () => {
    expect(cabinetStatus(LAST_BELL, "upcoming", S)).toMatchObject({ chip: "Opens 28 Oct" });
    expect(cabinetStatus(LAST_BELL, "upcoming", S).line).toMatch(/Practise now; nothing counts until then\./);
    expect(cabinetStatus(LAST_BELL, "live", S).chip).toBe("Ranked · live");
    expect(cabinetStatus(LAST_BELL, "closed", S).chip).toBe("Board closed");
    expect(cabinetStatus(LAST_BELL, "finalised", S).chip).toBe("Final");
    expect(cabinetStatus(LAST_BELL, "suspended", S).chip).toBe("Paused");
    expect(cabinetStatus(LAST_BELL, null, S).chip).toBe("Halloween Shift");
    expect(cabinetStatus(LAST_BELL, "live", null).line).toMatch(/to be announced/);
    expect(selectedAnnouncement(LAST_BELL, cabinetStatus(LAST_BELL, "live", S))).toBe("Last Bell selected. Ranked · live.");
    expect(cabinetLabel(LAST_BELL, 0, 3)).toBe("Last Bell: The Halloween Shift. Cabinet 1 of 3");
  });

  it("opens its board from the opening on, never before", () => {
    expect(boardIsOpen("upcoming")).toBe(false);
    expect(boardIsOpen(null)).toBe(false);
    for (const p of ["live", "closed", "verification", "finalised", "archived", "suspended"] as const) expect(boardIsOpen(p)).toBe(true);
  });
});

describe("needsLaptop", () => {
  it("only when the catalogue says the game does not play on this device", () => {
    expect(needsLaptop("desktop", "mobile")).toBe(true);
    expect(needsLaptop("desktop", "desktop")).toBe(false);
    expect(needsLaptop("both", "mobile")).toBe(false);
    expect(needsLaptop("mobile", "mobile")).toBe(false);
    expect(needsLaptop(null, "mobile")).toBe(false);
    expect(needsLaptop("desktop", null)).toBe(false);
  });
});

describe("boardCapacity", () => {
  it("fits five rows in the laptop board at 3x and fewer as the room shrinks, never none", () => {
    expect(boardCapacity(68 * 3, false)).toBe(5);
    expect(boardCapacity(68 * 2.5, false)).toBe(3);
    expect(boardCapacity(68 * 2, false)).toBe(2);
    expect(boardCapacity(10, false)).toBe(1);
    expect(boardCapacity(68 * 3, true)).toBe(4);
    expect(boardCapacity(5000, false)).toBe(8);
  });
});

describe("boardRows", () => {
  it("shows the top rows that fit and nothing else when you are not ranked", () => {
    const v = boardRows(TABLE, null, 3, null, false);
    expect(v.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(v.you).toBeNull();
  });

  it("marks your row where you stand among the top rows, without pinning a second one", () => {
    const v = boardRows(TABLE, { publicId: "p2", rank: 2, points: 80 }, 3, null, false);
    expect(v.rows.find((r) => r.you)?.rank).toBe(2);
    expect(v.you).toBeNull();
  });

  it("pins your row in the last place when you are below the rows, and keeps one fewer table row", () => {
    const v = boardRows(TABLE, { publicId: "me", rank: 14, points: 5 }, 3, null, false);
    expect(v.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(v.you).toMatchObject({ rank: 14, name: "You", points: 5, you: true });
  });

  it("crowns the champion only when the results are final", () => {
    expect(boardRows(TABLE, null, 3, "p1", false).rows[0].champion).toBe(false);
    expect(boardRows(TABLE, null, 3, "p1", true).rows[0].champion).toBe(true);
    expect(boardRows(TABLE, null, 3, "p1", true).rows[1].champion).toBe(false);
  });

  it("copes with an empty table and a one-row board", () => {
    expect(boardRows([], null, 5, null, false)).toEqual({ rows: [], you: null });
    const v = boardRows(TABLE, { publicId: "me", rank: 9, points: 5 }, 1, null, false);
    expect(v.rows).toEqual([]);
    expect(v.you?.rank).toBe(9);
  });
});
