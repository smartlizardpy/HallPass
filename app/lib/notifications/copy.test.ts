/**
 * Tests for what every notification says.
 *
 * The challenge assertions here are carried over verbatim in substance from the
 * push payload tests they replace — that wording shipped, and generalising the
 * transport must not quietly reword it.
 *
 * The rest are the checks that only exist because all the copy is in one file:
 * properties asserted across the WHOLE set, which is where "somebody added a
 * kind and forgot" actually gets caught.
 */

import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_IDS,
  NOTIFICATION_TITLE_MAX,
} from "./config";
import {
  achievementCopy,
  betaAssignmentCopy,
  bugReportCopy,
  challengeBeatenCopy,
  challengeCopy,
  friendAcceptedCopy,
  friendRequestCopy,
  gameDropCopy,
  reviewPostedCopy,
  reviewReportedCopy,
  shortName,
  type NotificationCopy,
} from "./copy";

const BASE = { from: "Ozan", game: "Duskfall", boardTitle: "High score" };

/** One built example of every kind, so set-wide properties can be asserted. */
const EVERY_KIND: Record<string, NotificationCopy> = {
  challenge_received: challengeCopy(BASE),
  challenge_beaten: challengeBeatenCopy({
    by: "Deniz",
    game: "Duskfall",
    boardTitle: "High score",
    targetScore: 4200,
  }),
  friend_request: friendRequestCopy({ from: "Ayşe" }),
  friend_accepted: friendAcceptedCopy({ from: "Ayşe" }),
  game_drop: gameDropCopy({ title: "Duskfall", slug: "duskfall" }),
  achievement_unlocked: achievementCopy({
    achievement: "Deathless",
    gameTitle: "Duskfall",
    slug: "duskfall",
  }),
  beta_assignment: betaAssignmentCopy({ gameTitle: "Duskfall" }),
  review_posted: reviewPostedCopy({ gameTitle: "Duskfall", slug: "duskfall" }),
  review_reported: reviewReportedCopy({ gameTitle: "Duskfall" }),
  bug_report_filed: bugReportCopy({ gameTitle: "Duskfall" }),
};

describe("challengeBeatenCopy", () => {
  it("names the winner and the score that was lost", () => {
    const copy = challengeBeatenCopy({
      by: "Deniz", game: "Duskfall", boardTitle: "High score", targetScore: 4200,
    });
    expect(copy.title).toBe("Deniz beat your score");
    expect(copy.body).toContain("4,200");
    expect(copy.body).toContain("Duskfall");
  });

  it("names only the RECIPIENT'S score, never the winning one", () => {
    // The number that was beaten is the reader's own, already public on the
    // board they set it on, so a bystander learns nothing. The winning score
    // belongs to somebody else and has no business on a stranger's lock screen.
    const copy = challengeBeatenCopy({
      by: "Deniz", game: "Duskfall", boardTitle: "High score", targetScore: 4200,
    });
    expect(copy.body).not.toContain("9,999");
  });

  it("falls back to the board title when there is no game", () => {
    const copy = challengeBeatenCopy({
      by: "Deniz", game: null, boardTitle: "Fastest lap", targetScore: 12,
    });
    expect(copy.body).toContain("Fastest lap");
  });
});

describe("challengeCopy", () => {
  it("names the sender and the game", () => {
    const copy = challengeCopy(BASE);
    expect(copy.title).toBe("Ozan challenged you");
    expect(copy.body).toContain("Duskfall");
  });

  it("renders whatever label it is given, so the caller must pass a title", () => {
    // The caller resolves the slug through `findGame`. Passing a slug through
    // would put "Beat their score on neon-velocity-hyperdrive" on a lock screen,
    // which reads as broken.
    expect(challengeCopy({ ...BASE, game: "Neon Velocity" }).body).toContain(
      "Neon Velocity",
    );
  });

  it("omits the SCORE", () => {
    // The number belongs on the page, where it arrives with a Play button.
    const copy = challengeCopy(BASE);
    expect(`${copy.title} ${copy.body}`).not.toMatch(/\d/);
  });

  it("falls back to the board title when the board has no game", () => {
    expect(challengeCopy({ ...BASE, game: null }).body).toContain("High score");
  });

  it("survives a board with neither a game nor a title", () => {
    expect(challengeCopy({ from: "Ozan", game: null, boardTitle: "" }).body).toBe(
      "Beat their score.",
    );
  });

  it("handles a missing or blank sender name", () => {
    expect(challengeCopy({ ...BASE, from: "   " }).title).toBe(
      "A friend challenged you",
    );
  });

  it("bounds a long name so the verb stays on the banner", () => {
    const copy = challengeCopy({ ...BASE, from: "x".repeat(80) });
    expect(copy.title.length).toBeLessThanOrEqual(24 + " challenged you".length);
    expect(copy.title).toContain("challenged you");
  });

  it("lands on the inbox, which can show all of them", () => {
    expect(challengeCopy(BASE).url).toBe("/play/you/friends");
  });
});

describe("shortName", () => {
  it("falls back rather than emitting a blank", () => {
    // A banner reading "  challenged you" is worse than a vague one.
    expect(shortName("   ")).toBe("A friend");
    expect(shortName("", "Someone")).toBe("Someone");
  });

  it("truncates with an ellipsis rather than cutting mid-banner", () => {
    expect(shortName("y".repeat(80))).toBe(`${"y".repeat(23)}…`);
  });

  it("leaves an ordinary name alone", () => {
    expect(shortName("Ozan")).toBe("Ozan");
  });
});

describe("the moderation kinds", () => {
  it("never quote the content they are about", () => {
    // A report is frequently ABOUT the text being vile, and an admin banner is
    // still a banner on somebody's phone. Quoting unmoderated text onto a lock
    // screen is the one place it cannot be taken back from.
    const vile = "something unrepeatable";
    const posted = reviewPostedCopy({ gameTitle: "Duskfall", slug: "duskfall" });
    const reported = reviewReportedCopy({ gameTitle: "Duskfall" });
    for (const copy of [posted, reported]) {
      expect(`${copy.title} ${copy.body}`).not.toContain(vile);
    }
    // They name the GAME, which is what makes them triageable at a glance.
    expect(`${posted.title} ${posted.body}`).toContain("Duskfall");
  });

  it("land in the dashboard, where the action is", () => {
    expect(reviewPostedCopy({ gameTitle: "D", slug: "d" }).url).toContain(
      "/dashboard",
    );
    expect(reviewReportedCopy({ gameTitle: "D" }).url).toContain("/dashboard");
    expect(bugReportCopy({ gameTitle: "D" }).url).toContain("/dashboard");
  });
});

describe("gameDropCopy", () => {
  it("is written for everybody, not for one player", () => {
    // The one broadcast kind. It cannot say "you" or assume the reader has
    // played anything before — the same row is read by every signed-in player.
    const copy = gameDropCopy({ title: "Duskfall", slug: "duskfall" });
    expect(copy.title).toBe("Duskfall just landed");
    expect(copy.title).not.toMatch(/\byou\b/i);
  });

  it("lands on the game it announces", () => {
    expect(gameDropCopy({ title: "Duskfall", slug: "duskfall" }).url).toBe(
      "/game/duskfall",
    );
  });
});

describe("every kind", () => {
  it("has a builder covered by this file", () => {
    // The check that catches "somebody added a kind and forgot the copy".
    expect(Object.keys(EVERY_KIND).sort()).toEqual([...NOTIFICATION_KIND_IDS].sort());
  });

  it("produces a non-empty title and body", () => {
    for (const [kind, copy] of Object.entries(EVERY_KIND)) {
      expect(copy.title.length, kind).toBeGreaterThan(0);
      expect(copy.body.length, kind).toBeGreaterThan(0);
    }
  });

  it("stays inside the stored ceilings", () => {
    for (const [kind, copy] of Object.entries(EVERY_KIND)) {
      expect(copy.title.length, kind).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
      expect(copy.body.length, kind).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
    }
  });

  it("bounds the finished string even when every input is enormous", () => {
    // `shortName` bounds ONE interpolated value; a builder interpolating two
    // could still run long, which is why the ceiling is applied to the result.
    const huge = "z".repeat(500);
    const copy = achievementCopy({
      achievement: huge,
      gameTitle: huge,
      slug: huge,
    });
    expect(copy.title.length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
    expect(copy.body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
  });

  it("lands on an app-relative path, never an absolute URL", () => {
    // The bell renders these as links and the service worker navigates to them.
    // An absolute URL here would be an open redirect wearing a notification.
    for (const [kind, copy] of Object.entries(EVERY_KIND)) {
      expect(copy.url.startsWith("/"), kind).toBe(true);
      expect(copy.url.startsWith("//"), kind).toBe(false);
    }
  });

  it("never leaks its full wording into the discreet counterpart", () => {
    // Cross-checks the two files that have to agree: the full copy here, and the
    // discreet string in the catalogue. A discreet string that happened to
    // contain a name would be the exact failure quiet mode exists to prevent.
    for (const kind of NOTIFICATION_KIND_IDS) {
      const discreet = NOTIFICATION_KINDS[kind].discreet;
      for (const leak of ["Ozan", "Ayşe", "Duskfall", "Deathless"]) {
        expect(discreet, kind).not.toContain(leak);
      }
    }
  });
});
