import { describe, expect, it } from "vitest";
import { chooseMoments, DAILY_CAP, parseLedger, recordPlay, utcDay } from "./moments";

const NOW = Date.UTC(2026, 9, 29, 12);
const fresh = parseLedger(null, NOW);

describe("chooseMoments", () => {
  it("takes turns across what the page has", () => {
    const present = new Set(["bat", "sign", "spider", "eyes"]);
    const seen = [0, 1, 2, 3].map((t) => chooseMoments(present, fresh, t));
    expect(seen.map((s) => s.primary)).toEqual(["sign", "bat", "sign", "bat"]);
    expect(seen.map((s) => s.extra)).toEqual(["spider", "eyes", "spider", "eyes"]);
  });

  it("plays nothing the page does not carry", () => {
    expect(chooseMoments(new Set(), fresh, 0)).toEqual({ primary: null, extra: null });
  });

  it("skips a moment that hit today's cap", () => {
    let l = fresh;
    for (let i = 0; i < DAILY_CAP; i++) l = recordPlay(l, "bat");
    expect(chooseMoments(new Set(["bat", "sign"]), l, 1).primary).toBe("sign");
  });
});

describe("ledger", () => {
  it("resets plays on a new UTC day but keeps the page-view count", () => {
    const old = JSON.stringify({ d: "2026-10-28", n: 7, c: { bat: 3 } });
    expect(parseLedger(old, NOW)).toEqual({ d: utcDay(NOW), n: 7, c: {} });
  });

  it("survives garbage", () => {
    expect(parseLedger("{nope", NOW)).toEqual({ d: "2026-10-29", n: 0, c: {} });
    expect(parseLedger(JSON.stringify({ d: "2026-10-29", n: -1, c: { bat: "x" } }), NOW)).toEqual({
      d: "2026-10-29",
      n: 0,
      c: {},
    });
  });
});
