/**
 * Tests for the notification catalogue.
 *
 * The properties pinned here are the ones whose failure is SILENT rather than
 * loud: an admin kind leaking into a player's settings page, a kind shipping
 * without discreet copy so a stealth device gets the full wording anyway, or two
 * kinds sharing a service worker tag so one banner quietly replaces another.
 * None of those throw — they just do the wrong thing.
 */

import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_KIND_IDS,
  NOTIFICATION_KINDS,
  NOTIFICATION_TITLE_MAX,
  deliversToBell,
  deliversToPush,
  isAtLeast,
  isNotificationKind,
  kindDef,
  kindsForAudience,
  notificationTag,
  resolveChannel,
  toChannel,
} from "./config";

describe("channels", () => {
  it("is ordered quietest first", () => {
    // `isAtLeast` and the settings scale both depend on this order.
    expect(NOTIFICATION_CHANNELS).toEqual(["off", "bell", "push"]);
  });

  it("treats push as implying bell", () => {
    // There is no "push but not inbox" — that would be a message you cannot go
    // back and re-read, which is the exact gap this feature was built to close.
    expect(deliversToBell("push")).toBe(true);
    expect(deliversToPush("push")).toBe(true);
  });

  it("delivers bell but not push at the middle setting", () => {
    expect(deliversToBell("bell")).toBe(true);
    expect(deliversToPush("bell")).toBe(false);
  });

  it("delivers nothing at all when off", () => {
    expect(deliversToBell("off")).toBe(false);
    expect(deliversToPush("off")).toBe(false);
  });

  it("orders correctly through isAtLeast", () => {
    expect(isAtLeast("push", "bell")).toBe(true);
    expect(isAtLeast("bell", "bell")).toBe(true);
    expect(isAtLeast("off", "bell")).toBe(false);
  });

  it("narrows untrusted values and rejects everything else", () => {
    expect(toChannel("push")).toBe("push");
    expect(toChannel("PUSH")).toBe(null);
    expect(toChannel("email")).toBe(null);
    expect(toChannel(null)).toBe(null);
    expect(toChannel(undefined)).toBe(null);
    expect(toChannel(3)).toBe(null);
  });
});

describe("the catalogue", () => {
  it("gives every kind discreet copy", () => {
    // A kind without it would fall back to the full wording on a device with
    // quiet notifications on — the failure the stealth feature exists to stop,
    // and one nothing else in the stack would catch.
    for (const kind of NOTIFICATION_KIND_IDS) {
      expect(NOTIFICATION_KINDS[kind].discreet.length).toBeGreaterThan(0);
    }
  });

  it("never names a player or a game in the discreet copy", () => {
    // The discreet rendering must name nobody and nothing. Interpolation is the
    // way that breaks, so no entry may carry a placeholder.
    for (const kind of NOTIFICATION_KIND_IDS) {
      expect(NOTIFICATION_KINDS[kind].discreet).not.toMatch(/[{$%]/);
    }
  });

  it("keeps every kind in a group the settings page renders", () => {
    const groups = new Set(NOTIFICATION_GROUPS.map((g) => g.id));
    for (const kind of NOTIFICATION_KIND_IDS) {
      expect(groups.has(NOTIFICATION_KINDS[kind].group)).toBe(true);
    }
  });

  it("gives every kind a distinct service worker tag", () => {
    // A shared tag would let a friend request replace the challenge banner
    // underneath it, and the player would never learn the challenge existed.
    const tags = NOTIFICATION_KIND_IDS.map(notificationTag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("keeps the site-wide kinds to broadcasts and everything else personal", () => {
    // A broadcast is the nullable-player_id row. Scope is a property of the KIND
    // so a producer cannot send a game drop to one person, or a challenge to
    // everybody.
    expect(NOTIFICATION_KINDS.game_drop.scope).toBe("broadcast");
    expect(NOTIFICATION_KINDS.challenge_received.scope).toBe("personal");
  });

  it("never broadcasts an admin kind", () => {
    // A broadcast row has no owner, so it is readable by every signed-in player.
    // An admin kind delivered that way would publish the moderation queue.
    for (const kind of NOTIFICATION_KIND_IDS) {
      const def = NOTIFICATION_KINDS[kind];
      if (def.audience === "admin") expect(def.scope).toBe("personal");
    }
  });

  it("defaults the site-wide kind to the bell, not to push", () => {
    // A default-on push for every player at once is how an arcade teaches people
    // to turn notifications off altogether.
    expect(NOTIFICATION_KINDS.game_drop.defaultChannel).toBe("bell");
  });

  it("defaults the kinds that are about you personally to push", () => {
    expect(NOTIFICATION_KINDS.challenge_received.defaultChannel).toBe("push");
    expect(NOTIFICATION_KINDS.friend_request.defaultChannel).toBe("push");
  });

  it("never ships a kind defaulted to off", () => {
    // A kind nobody is told about by default is a producer written for nothing.
    // If it is not worth a bell it should not be emitted.
    for (const kind of NOTIFICATION_KIND_IDS) {
      expect(NOTIFICATION_KINDS[kind].defaultChannel).not.toBe("off");
    }
  });
});

describe("audiences", () => {
  it("hides the admin kinds from a player", () => {
    const forPlayer = kindsForAudience("player");
    for (const kind of forPlayer) {
      expect(NOTIFICATION_KINDS[kind].audience).toBe("player");
    }
    expect(forPlayer).not.toContain("review_reported");
  });

  it("shows an admin both sets — they are a player too", () => {
    const forAdmin = kindsForAudience("admin");
    expect(forAdmin).toContain("review_reported");
    expect(forAdmin).toContain("challenge_received");
    expect(forAdmin.length).toBe(NOTIFICATION_KIND_IDS.length);
  });
});

describe("resolveChannel", () => {
  it("uses the kind's default when nothing is stored", () => {
    // `notification_prefs` is sparse: no row means no opinion, not silence.
    expect(resolveChannel("challenge_received", null)).toBe("push");
    expect(resolveChannel("game_drop", null)).toBe("bell");
  });

  it("honours a stored deviation", () => {
    expect(resolveChannel("game_drop", "push")).toBe("push");
    expect(resolveChannel("challenge_received", "off")).toBe("off");
  });

  it("falls back to the default on an unreadable value, never to silence", () => {
    // A row written by a newer deploy, or a corrupt one, must not be able to
    // mute somebody.
    expect(resolveChannel("challenge_received", "carrier-pigeon")).toBe("push");
    expect(resolveChannel("challenge_received", undefined)).toBe("push");
  });
});

describe("unknown kinds", () => {
  it("degrades rather than throwing", () => {
    // `kind` is free TEXT with no CHECK, so an older deploy can read a row a
    // newer one wrote. The worst case must be a row that does not render.
    expect(isNotificationKind("from_the_future")).toBe(false);
    expect(kindDef("from_the_future")).toBe(null);
    expect(kindDef("challenge_received")).not.toBe(null);
  });
});

describe("limits", () => {
  it("bounds stored copy", () => {
    // Producers interpolate player-supplied text — a handle, a game title — and
    // the ceiling is what stops one long handle bloating every bell poll for the
    // rest of that player's retention window.
    expect(NOTIFICATION_TITLE_MAX).toBeGreaterThan(0);
    expect(NOTIFICATION_BODY_MAX).toBeGreaterThan(NOTIFICATION_TITLE_MAX);
  });
});
