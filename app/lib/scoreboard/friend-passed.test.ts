import { describe, expect, it } from "vitest";
import { friendPassedDedupeKey } from "./friend-passed";

const base = { boardId: "neon-snake", passerId: "p1", passedBest: 110 };

describe("friendPassedDedupeKey", () => {
  it("is stable for the same overtake", () => {
    expect(friendPassedDedupeKey(base)).toBe(friendPassedDedupeKey({ ...base }));
  });

  it("differs per passed score, so a re-overtake is a new event", () => {
    expect(friendPassedDedupeKey(base)).not.toBe(
      friendPassedDedupeKey({ ...base, passedBest: 150 }),
    );
  });

  it("differs per board and per passer", () => {
    const key = friendPassedDedupeKey(base);
    expect(friendPassedDedupeKey({ ...base, boardId: "other" })).not.toBe(key);
    expect(friendPassedDedupeKey({ ...base, passerId: "p2" })).not.toBe(key);
  });
});
