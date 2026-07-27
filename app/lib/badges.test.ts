import { describe, expect, it } from "vitest";
import { ALL_BADGES, earnedBadges, lockedBadges, type BadgeStats } from "./badges";

const NOTHING: BadgeStats = {
  gamesPlayed: 0,
  totalPlays: 0,
  firstPlaces: 0,
  boardsEntered: 0,
  reviewsWritten: 0,
  bestReviewHelpful: 0,
  friends: 0,
  accountAgeDays: 0,
  achievementPoints: 0,
};

describe("earnedBadges", () => {
  it("gives a brand-new player nothing", () => {
    expect(earnedBadges(NOTHING)).toEqual([]);
  });

  it("awards on the threshold, not above it", () => {
    expect(earnedBadges({ ...NOTHING, gamesPlayed: 4 }).map((b) => b.id)).toEqual([]);
    expect(earnedBadges({ ...NOTHING, gamesPlayed: 5 }).map((b) => b.id)).toEqual([
      "explorer",
    ]);
  });

  it("stacks tiers — a higher tier does not replace the lower one", () => {
    const ids = earnedBadges({ ...NOTHING, gamesPlayed: 20 }).map((b) => b.id);
    expect(ids).toContain("explorer");
    expect(ids).toContain("completionist");
  });

  it("awards the rare score badges", () => {
    expect(earnedBadges({ ...NOTHING, firstPlaces: 1 }).map((b) => b.id)).toEqual([
      "champion",
    ]);
    const three = earnedBadges({ ...NOTHING, firstPlaces: 3 }).map((b) => b.id);
    expect(three).toEqual(["champion", "triple-crown"]);
  });

  it("returns badges in the declared display order, rarest first", () => {
    const everything: BadgeStats = {
      gamesPlayed: 50,
      totalPlays: 500,
      firstPlaces: 5,
      boardsEntered: 10,
      reviewsWritten: 10,
      bestReviewHelpful: 20,
      friends: 20,
      accountAgeDays: 400,
      achievementPoints: 1000,
    };
    expect(earnedBadges(everything)).toHaveLength(ALL_BADGES.length);
    expect(earnedBadges(everything)[0].id).toBe("champion");
  });

  it("never exposes the rule function to the UI", () => {
    // The rules are internal; a badge handed to a component must be plain data.
    for (const badge of earnedBadges({ ...NOTHING, gamesPlayed: 5 })) {
      expect(badge).not.toHaveProperty("earned");
    }
  });
});

describe("lockedBadges", () => {
  it("is the exact complement of earned", () => {
    const stats = { ...NOTHING, gamesPlayed: 5, friends: 5 };
    const earned = earnedBadges(stats).map((b) => b.id);
    const locked = lockedBadges(stats).map((b) => b.id);
    expect(earned.length + locked.length).toBe(ALL_BADGES.length);
    expect(earned.filter((id) => locked.includes(id))).toEqual([]);
  });
});

describe("achievement badges", () => {
  // The bridge between the two systems: everything else in BadgeStats is derived
  // from rows the platform can see for itself, whereas achievement points come
  // from games reporting unlocks through the SDK. Worth its own block because it
  // is the one input that arrives from outside.
  it("awards on points, not on how many achievements were collected", () => {
    // One hard achievement worth 100 beats ten trivial ones worth 5.
    expect(earnedBadges({ ...NOTHING, achievementPoints: 99 }).map((b) => b.id)).toEqual([]);
    expect(earnedBadges({ ...NOTHING, achievementPoints: 100 }).map((b) => b.id)).toEqual([
      "achiever",
    ]);
  });

  it("stacks the tiers like the other badge families", () => {
    const ids = earnedBadges({ ...NOTHING, achievementPoints: 500 }).map((b) => b.id);
    expect(ids).toContain("achiever");
    expect(ids).toContain("trophy-hunter");
  });

  it("leaves them locked for a player whose games ship no achievements", () => {
    // Most games will never define any, so this must read as "not yet", not as a
    // permanently empty shelf.
    const locked = lockedBadges(NOTHING).map((b) => b.id);
    expect(locked).toContain("achiever");
    expect(locked).toContain("trophy-hunter");
  });
});
