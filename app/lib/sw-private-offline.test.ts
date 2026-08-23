import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests for `privateOfflineDoc` in `public/sw.js` — the rule that decides which
 * URLs are shown the offline card when a navigation cannot reach the network.
 *
 * Extracted from the real file by its markers rather than mirrored here, for the
 * reasons `sw-freshness.test.ts` sets out at length: a service worker has no
 * exports and registers listeners at import time, and a hand-copied DECISION is
 * how the tested version and the shipped version quietly stop agreeing.
 *
 * What makes this worth a test at all: the function decides what a URL is SHOWN.
 * Widening it by accident would tell someone looking at another player's profile
 * that "your profile needs a connection", and narrowing it would put the dead end
 * back under the You tab.
 */
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const block = source.match(
  /\/\* @pure-start privateOfflineDoc \*\/([\s\S]*?)\/\* @pure-end \*\//,
);
if (!block) {
  throw new Error(
    "privateOfflineDoc markers not found in public/sw.js — did the fixture move?",
  );
}
const privateOfflineDoc = new Function(
  `${block[1]}; return privateOfflineDoc;`,
)() as (pathname: string) => string | null;

describe("privateOfflineDoc", () => {
  it("answers the player's own pages with the You card", () => {
    expect(privateOfflineDoc("/play/you")).toBe("/offline/you");
    expect(privateOfflineDoc("/play/you/friends")).toBe("/offline/you");
    expect(privateOfflineDoc("/play/you/notifications")).toBe("/offline/you");
    expect(privateOfflineDoc("/play/you/settings")).toBe("/offline/you");
  });

  it("covers the legacy URLs that redirect into the subtree", () => {
    // A tap on an old bookmark must not land on the browser's error page either.
    expect(privateOfflineDoc("/play/account")).toBe("/offline/you");
    expect(privateOfflineDoc("/play/friends")).toBe("/offline/you");
  });

  it("leaves the other private paths alone", () => {
    // Somebody else's profile, and a panel inside a game: different journeys,
    // different right answers, deliberately unchanged.
    expect(privateOfflineDoc("/u/remzi")).toBeNull();
    expect(privateOfflineDoc("/embed/challenge")).toBeNull();
  });

  it("never claims a public page", () => {
    expect(privateOfflineDoc("/")).toBeNull();
    expect(privateOfflineDoc("/game/silence")).toBeNull();
    expect(privateOfflineDoc("/category/arcade")).toBeNull();
  });

  it("does not mistake a sibling that merely shares the prefix", () => {
    // `isPrivatePath` matches these with its looser `startsWith` — harmless
    // there, wrong here.
    expect(privateOfflineDoc("/play/younger")).toBeNull();
    expect(privateOfflineDoc("/play/accountant")).toBeNull();
    expect(privateOfflineDoc("/play/friendship")).toBeNull();
  });
});
