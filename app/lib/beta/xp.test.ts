import { describe, expect, it } from "vitest";
import {
  BUG_SEVERITIES,
  BUG_XP,
  COVER_PROMOTION_XP,
  DUPLICATE_XP,
  FEATURE_XP,
  RANKS,
  SHOT_XP,
} from "./config";
import { rankFor, xpForReport, xpForShot } from "./xp";

describe("RANKS is well-formed", () => {
  // rankFor() assumes both of these. Asserting them here rather than trusting the
  // literal means a careless edit to the ladder fails a test instead of quietly
  // producing a divide-by-zero fraction or an unreachable bottom rank.
  it("starts at 0", () => {
    expect(RANKS[0].min).toBe(0);
  });

  it("is strictly ascending", () => {
    for (let i = 1; i < RANKS.length; i += 1) {
      expect(RANKS[i].min).toBeGreaterThan(RANKS[i - 1].min);
    }
  });
});

describe("xpForReport", () => {
  it("pays nothing for an untriaged or rejected report", () => {
    for (const status of ["open", "rejected"] as const) {
      expect(
        xpForReport({ kind: "bug", severity: "blocker", status }),
      ).toBe(0);
    }
  });

  it("pays the duplicate rate regardless of severity", () => {
    for (const severity of BUG_SEVERITIES) {
      expect(
        xpForReport({ kind: "bug", severity, status: "duplicate" }),
      ).toBe(DUPLICATE_XP);
    }
  });

  it("pays each accepted bug its severity band", () => {
    for (const severity of BUG_SEVERITIES) {
      expect(
        xpForReport({ kind: "bug", severity, status: "accepted" }),
      ).toBe(BUG_XP[severity]);
    }
  });

  it("pays accepted features a flat rate and ignores any severity", () => {
    expect(
      xpForReport({ kind: "feature", severity: null, status: "accepted" }),
    ).toBe(FEATURE_XP);
    expect(
      xpForReport({ kind: "feature", severity: "blocker", status: "accepted" }),
    ).toBe(FEATURE_XP);
  });

  it("falls back to the lowest band for an accepted bug with no severity", () => {
    // A triage bug must not become a free top-band award, and must not throw and
    // roll back the admin's whole action.
    expect(
      xpForReport({ kind: "bug", severity: null, status: "accepted" }),
    ).toBe(BUG_XP.cosmetic);
  });

  it("keeps a blocker worth more than ten cosmetics", () => {
    // The anti-volume property the curve exists for. This caught the original
    // 10/25/50/100 curve, where ten cosmetics paid EXACTLY a blocker.
    expect(BUG_XP.blocker).toBeGreaterThan(BUG_XP.cosmetic * 10);
  });

  it("keeps the severity bands strictly ascending", () => {
    for (let i = 1; i < BUG_SEVERITIES.length; i += 1) {
      expect(BUG_XP[BUG_SEVERITIES[i]]).toBeGreaterThan(
        BUG_XP[BUG_SEVERITIES[i - 1]],
      );
    }
  });

  it("prices a feature between a minor and a major bug", () => {
    expect(FEATURE_XP).toBeGreaterThan(BUG_XP.minor);
    expect(FEATURE_XP).toBeLessThan(BUG_XP.major);
  });
});

describe("xpForShot", () => {
  it("pays the flat rate for a gallery image", () => {
    expect(xpForShot({ promotedToCover: false })).toBe(SHOT_XP);
  });

  it("adds the promotion bonus on top rather than replacing it", () => {
    expect(xpForShot({ promotedToCover: true })).toBe(
      SHOT_XP + COVER_PROMOTION_XP,
    );
  });

  it("values a promoted cover the same as a major bug", () => {
    // Stated intent in config.ts. Pinned so retuning one side cannot silently
    // break the parity the comment promises.
    expect(xpForShot({ promotedToCover: true })).toBe(BUG_XP.major);
  });
});

describe("rankFor", () => {
  it("puts a brand-new tester at the bottom of the ladder", () => {
    const rank = rankFor(0);
    expect(rank.name).toBe(RANKS[0].name);
    expect(rank.min).toBe(0);
    expect(rank.fraction).toBe(0);
  });

  it("clamps nonsense input to the bottom rather than falling off it", () => {
    for (const xp of [-1, -9999, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(rankFor(xp).name).toBe(RANKS[0].name);
    }
  });

  it("lands exactly on each threshold", () => {
    for (const entry of RANKS) {
      const rank = rankFor(entry.min);
      expect(rank.name).toBe(entry.name);
      expect(rank.min).toBe(entry.min);
    }
  });

  it("stays on the lower rank one XP below a threshold", () => {
    for (let i = 1; i < RANKS.length; i += 1) {
      expect(rankFor(RANKS[i].min - 1).name).toBe(RANKS[i - 1].name);
    }
  });

  it("reports the gap to the next rank", () => {
    const rank = rankFor(RANKS[0].min);
    expect(rank.next?.name).toBe(RANKS[1].name);
    expect(rank.toNext).toBe(RANKS[1].min);
  });

  it("saturates at the top rank instead of showing a partial meter", () => {
    const top = RANKS[RANKS.length - 1];
    const rank = rankFor(top.min + 100_000);
    expect(rank.name).toBe(top.name);
    expect(rank.next).toBeNull();
    expect(rank.toNext).toBe(0);
    expect(rank.fraction).toBe(1);
  });

  it("keeps fraction within 0..1 across the whole ladder", () => {
    const top = RANKS[RANKS.length - 1].min;
    for (let xp = 0; xp <= top + 500; xp += 37) {
      const { fraction } = rankFor(xp);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it("advances the fraction monotonically inside a band", () => {
    const lo = RANKS[1].min;
    const hi = RANKS[2].min;
    expect(rankFor(lo).fraction).toBeLessThan(rankFor(Math.floor((lo + hi) / 2)).fraction);
    expect(rankFor(Math.floor((lo + hi) / 2)).fraction).toBeLessThan(
      rankFor(hi - 1).fraction,
    );
  });

  it("ignores a fractional XP total", () => {
    expect(rankFor(RANKS[1].min + 0.9).name).toBe(RANKS[1].name);
  });
});
