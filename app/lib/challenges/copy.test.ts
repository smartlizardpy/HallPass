import { describe, expect, it } from "vitest";
import { CHALLENGE_REASONS } from "./config";
import { CHALLENGE_REFUSAL_TEXT, challengeRefusalText } from "./copy";

/**
 * The exhaustiveness of {@link CHALLENGE_REFUSAL_TEXT} is enforced by
 * `satisfies Record<ChallengeReason, string>` at compile time, so the runtime
 * check below is not redundant with it — it catches the case the type cannot,
 * where `CHALLENGE_REASONS` gains a member and the map gains a key that is
 * present but empty.
 */
describe("challenge refusal copy", () => {
  it("says something for every reason the server can return", () => {
    for (const reason of CHALLENGE_REASONS) {
      const text = CHALLENGE_REFUSAL_TEXT[reason];
      expect(text, `no copy for "${reason}"`).toBeTruthy();
      expect(text.trim(), `blank copy for "${reason}"`).not.toBe("");
    }
  });

  it("keeps every refusal to one short, punctuated sentence", () => {
    // These render in a small panel that can sit over a running game. A refusal
    // that wraps to four lines pushes its own Close button off the card.
    for (const reason of CHALLENGE_REASONS) {
      const text = CHALLENGE_REFUSAL_TEXT[reason];
      expect(text.length, `"${reason}" is too long for the panel`).toBeLessThan(80);
      expect(text, `"${reason}" is not punctuated`).toMatch(/[.!?]$/);
    }
  });

  /**
   * THE SAFETY ASSERTION. `config.ts` documents at length why there is no
   * `"blocked"` reason — a block deletes the friendship, so it is unreachable
   * behind `not-friends`, and naming it would confirm to somebody that a
   * particular person had blocked them. That argument is only worth anything if
   * the WORDING keeps the secret too, which is what this pins.
   */
  it("never tells a player they have been blocked", () => {
    for (const reason of CHALLENGE_REASONS) {
      expect(
        CHALLENGE_REFUSAL_TEXT[reason].toLowerCase(),
        `"${reason}" leaks the block`,
      ).not.toMatch(/block/);
    }
  });

  it("resolves a known reason to its own sentence", () => {
    expect(challengeRefusalText("not-friends")).toBe(
      CHALLENGE_REFUSAL_TEXT["not-friends"],
    );
  });

  /**
   * An older client against a newer route, and the ordinary case of a body that
   * carried no reason at all. Both must read as vague-but-true rather than
   * rendering `undefined` into the panel.
   */
  it("degrades an unknown or absent reason to `unavailable`", () => {
    const fallback = CHALLENGE_REFUSAL_TEXT.unavailable;
    expect(challengeRefusalText("something-new")).toBe(fallback);
    expect(challengeRefusalText(undefined)).toBe(fallback);
    expect(challengeRefusalText(null)).toBe(fallback);
    expect(challengeRefusalText(42)).toBe(fallback);
    expect(challengeRefusalText({})).toBe(fallback);
  });

  /**
   * `Object.prototype` is reachable through a bare index signature, so a body
   * carrying `{"reason":"constructor"}` must not render a function into the
   * panel. `?? unavailable` does not catch this — `constructor` is not nullish.
   */
  it("does not resolve inherited Object properties to copy", () => {
    expect(challengeRefusalText("constructor")).toBe(
      CHALLENGE_REFUSAL_TEXT.unavailable,
    );
    expect(challengeRefusalText("toString")).toBe(
      CHALLENGE_REFUSAL_TEXT.unavailable,
    );
  });
});
