/**
 * Tests for the push envelope.
 *
 * These are assertions with a safety argument behind them rather than a
 * correctness one. The discreet version exists so that a bystander glancing at a
 * school laptop learns nothing, and every way of leaking through it is a
 * one-word edit somebody could make in good faith — so each is pinned by name.
 *
 * The WORDING each kind carries is tested in `notifications/copy.test.ts`. What
 * is pinned here is the ENVELOPE: that both branches are always populated, that
 * the discreet title cannot be varied, and that the object is exactly the shape
 * `public/sw.js` reads.
 */

import { describe, expect, it } from "vitest";
import { notificationPush } from "./payload";

const BASE = {
  kind: "challenge_received",
  title: "Ozan challenged you",
  body: "Beat their score on Duskfall.",
  url: "/play/you/friends",
  discreet: "You have a new challenge.",
  tag: "hp-challenge_received",
};

describe("notificationPush", () => {
  it("always populates BOTH versions", () => {
    // The service worker picks one at display time and DROPS a payload missing
    // either — so a builder that skipped a branch would be silence, not an
    // error. This is the assertion that makes the indirection worth having.
    const push = notificationPush(BASE);
    for (const copy of [push.full, push.discreet]) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("emits exactly the keys the service worker reads", () => {
    // `sw.js` checks `data.full && data.discreet`, then reads `tag` and
    // `data.url`. A renamed key here is a notification that never shows.
    const push = notificationPush(BASE);
    expect(Object.keys(push).sort()).toEqual(
      ["discreet", "full", "kind", "tag", "url"].sort(),
    );
  });

  it("carries the caller's full wording through untouched", () => {
    const push = notificationPush(BASE);
    expect(push.full.title).toBe("Ozan challenged you");
    expect(push.full.body).toBe("Beat their score on Duskfall.");
  });

  it("names the app and nothing else in the discreet version", () => {
    // The whole point. Anyone who switched this on did so to stop a bystander
    // learning the sender, the game, or that this is a games site at all beyond
    // the app's own name.
    const push = notificationPush(BASE);
    const text = `${push.discreet.title} ${push.discreet.body}`;
    expect(text).not.toContain("Ozan");
    expect(text).not.toContain("Duskfall");
  });

  it("gives every kind the SAME discreet title", () => {
    // A discreet title that varied with the kind would leak by shape: a
    // bystander seeing "HallPass" one moment and "Moderation" the next learns
    // more than either banner says alone. It is a constant, and there is no
    // input that can vary it — the same reason `sw.js` refuses to vary the icon.
    const challenge = notificationPush(BASE);
    const moderation = notificationPush({
      ...BASE,
      kind: "review_reported",
      title: "A review was reported",
      body: "On Duskfall.",
      discreet: "Something needs moderating.",
      tag: "hp-review_reported",
    });
    expect(challenge.discreet.title).toBe(moderation.discreet.title);
  });

  it("keeps the tag the caller chose, so kinds cannot collapse together", () => {
    // Same-kind collapsing is a feature — four challenges while a phone is in a
    // bag should be one banner. Cross-kind collapsing is data loss.
    expect(notificationPush(BASE).tag).toBe("hp-challenge_received");
  });

  it("passes the destination through", () => {
    expect(notificationPush(BASE).url).toBe("/play/you/friends");
  });
});
