/**
 * Tests for what a challenge notification says.
 *
 * These are the assertions with a safety argument behind them rather than a
 * correctness one. The discreet version exists so that a bystander glancing at a
 * school laptop learns nothing, and every way of leaking through it is a
 * one-word edit somebody could make in good faith — so each is pinned here by
 * name.
 */

import { describe, expect, it } from "vitest";
import { CHALLENGE_NOTIFICATION_TAG } from "./config";
import { challengeNotification } from "./payload";

const BASE = { from: "Ozan", game: "Duskfall", boardTitle: "High score" };

describe("challengeNotification", () => {
  it("names the sender and the game in the full version", () => {
    const push = challengeNotification(BASE);
    expect(push.full.title).toBe("Ozan challenged you");
    expect(push.full.body).toContain("Duskfall");
  });

  it("renders whatever label it is given, so the caller must pass a title", () => {
    // The caller resolves the slug through `findGame`. Passing a slug through
    // would put "Beat their score on neon-velocity-hyperdrive" on a lock
    // screen, which reads as broken.
    expect(
      challengeNotification({ ...BASE, game: "Neon Velocity" }).full.body,
    ).toContain("Neon Velocity");
  });

  it("omits the SCORE even from the full version", () => {
    // The number belongs on the page, where it arrives with a Play button.
    const push = challengeNotification(BASE);
    expect(`${push.full.title} ${push.full.body}`).not.toMatch(/\d/);
  });

  it("names NOBODY and NOTHING in the discreet version", () => {
    // The whole point. Anyone who switched this on did so to stop a bystander
    // learning the sender, the game, or that this is a games site at all
    // beyond the app's own name.
    const push = challengeNotification(BASE);
    const text = `${push.discreet.title} ${push.discreet.body}`;
    expect(text).not.toContain("Ozan");
    expect(text).not.toContain("Duskfall");
    expect(text).not.toContain("High score");
  });

  it("keeps the discreet version identical whoever it is from", () => {
    // A discreet notification that varied with the sender would leak by shape:
    // a bystander seeing two different banners learns there are two people.
    const a = challengeNotification({ from: "Ozan", game: "duskfall", boardTitle: "A" });
    const b = challengeNotification({ from: "Ayşe", game: "crimson", boardTitle: "B" });
    expect(a.discreet).toEqual(b.discreet);
  });

  it("always populates BOTH versions", () => {
    // The service worker picks one at display time; a missing branch would
    // render an empty banner rather than falling back.
    const push = challengeNotification(BASE);
    for (const copy of [push.full, push.discreet]) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the board title when the board has no game", () => {
    const push = challengeNotification({ ...BASE, game: null });
    expect(push.full.body).toContain("High score");
  });

  it("survives a board with neither a game nor a title", () => {
    const push = challengeNotification({ from: "Ozan", game: null, boardTitle: "" });
    expect(push.full.body).toBe("Beat their score.");
  });

  it("handles a missing or blank sender name", () => {
    expect(challengeNotification({ ...BASE, from: "   " }).full.title).toBe(
      "A friend challenged you",
    );
  });

  it("bounds a long name so the verb stays on the banner", () => {
    const push = challengeNotification({ ...BASE, from: "x".repeat(80) });
    expect(push.full.title.length).toBeLessThanOrEqual(24 + " challenged you".length);
    expect(push.full.title).toContain("challenged you");
  });

  it("collapses onto one tag so four challenges are one banner", () => {
    // A player whose phone was in a bag should find one notification, not four.
    expect(challengeNotification(BASE).tag).toBe(CHALLENGE_NOTIFICATION_TAG);
  });

  it("lands on the inbox, which can show all of them", () => {
    expect(challengeNotification(BASE).url).toBe("/play/you/friends");
  });
});
