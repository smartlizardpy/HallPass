/**
 * Tests for the referrer allowlist.
 *
 * The case that matters most is the LAST one: a game that suppresses its own
 * referrer must still be rejected. That is the difference between an allowlist
 * and a denylist, and it is the reason this is written the way it is.
 */

import { describe, expect, it } from "vitest";
import { isTrustedOrigin } from "./origin";

const ORIGIN = "https://hallpass.example";

function reqWithReferer(referer: string | null): Request {
  const headers = new Headers();
  if (referer !== null) headers.set("referer", referer);
  return new Request(`${ORIGIN}/api/v1/me/friends`, { method: "POST", headers });
}

describe("isTrustedOrigin", () => {
  it("allows our own pages", () => {
    for (const path of [
      "/",
      "/play/friends",
      "/play/account",
      "/u/ozan",
      "/game/duskfall",
      "/category/shooter",
      "/beta/session/duskfall",
    ]) {
      expect(isTrustedOrigin(reqWithReferer(`${ORIGIN}${path}`))).toBe(true);
    }
  });

  it("allows the tester session screen to post its required review", () => {
    // REGRESSION. `/beta/` shipped without being added here, so the review a
    // tester MUST leave to finish an assignment 403'd every time — and since
    // `forbidden()` sends no `reason`, the composer could only say "Could not
    // post that". The whole programme was blocked on four missing characters.
    expect(isTrustedOrigin(reqWithReferer(`${ORIGIN}/beta/session/neon-well`))).toBe(true);
  });

  it("still REJECTS the game frame inside a tester session", () => {
    // The session screen embeds the game exactly like the store page does, so
    // widening the allowlist to `/beta/` must not widen it to what the beta page
    // is hosting. A fetch from the frame still carries `/game-html/…`.
    expect(isTrustedOrigin(reqWithReferer(`${ORIGIN}/game-html/neon-well/`))).toBe(false);
  });

  it("REJECTS a call from inside the game iframe", () => {
    // The whole point: a game runs same-origin with the player's cookie, so this
    // is the request shape that would otherwise let it act as the player.
    expect(isTrustedOrigin(reqWithReferer(`${ORIGIN}/game-html/duskfall/`))).toBe(false);
    expect(
      isTrustedOrigin(reqWithReferer(`${ORIGIN}/game-html/duskfall/index.html`)),
    ).toBe(false);
  });

  it("REJECTS a request with no referrer at all", () => {
    // A game can suppress its own referrer with
    // `<meta name="referrer" content="no-referrer">`, which would sail past a
    // "reject if it looks like a game" denylist. Failing closed is the point.
    expect(isTrustedOrigin(reqWithReferer(null))).toBe(false);
  });

  it("rejects a cross-origin referrer", () => {
    expect(isTrustedOrigin(reqWithReferer("https://evil.example/game/duskfall"))).toBe(false);
  });

  it("rejects a malformed referrer without throwing", () => {
    expect(isTrustedOrigin(reqWithReferer("not a url"))).toBe(false);
  });

  it("is not fooled by an allowed path on another origin", () => {
    expect(isTrustedOrigin(reqWithReferer("https://evil.example/play/friends"))).toBe(false);
  });

  it("is not fooled by an allowed prefix appearing later in the path", () => {
    expect(
      isTrustedOrigin(reqWithReferer(`${ORIGIN}/game-html/x/play/friends`)),
    ).toBe(false);
  });

  it("ignores the query string and hash of an otherwise-allowed page", () => {
    expect(isTrustedOrigin(reqWithReferer(`${ORIGIN}/?q=racing`))).toBe(true);
    expect(isTrustedOrigin(reqWithReferer(`${ORIGIN}/game/duskfall#top`))).toBe(true);
  });

  it("accepts the challenge picker, which is framed BY a game", () => {
    // The picker looks like the thing this list excludes, but it is a
    // first-party page on our origin that the game can neither see into nor
    // script, and it sends its OWN referrer. Without this the popup 403s with
    // the deliberately vague body and reads as a broken feature — which is
    // exactly how the /beta/ outage in the module header presented.
    expect(isTrustedOrigin(reqWithReferer(`${ORIGIN}/embed/challenge`))).toBe(true);
    expect(
      isTrustedOrigin(reqWithReferer(`${ORIGIN}/embed/challenge?board=duskfall`)),
    ).toBe(true);
  });

  it("still rejects the game frame itself", () => {
    // The distinction the whole allowlist rests on.
    expect(
      isTrustedOrigin(reqWithReferer(`${ORIGIN}/game-html/duskfall/`)),
    ).toBe(false);
  });
});
