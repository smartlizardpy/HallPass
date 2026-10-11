import { describe, expect, it } from "vitest";
import { MEME_AVATAR_COUNT, memeAvatarFor } from "./avatars";

describe("memeAvatarFor", () => {
  it("is deterministic and case-insensitive", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(memeAvatarFor(id)).toBe(memeAvatarFor(id));
    expect(memeAvatarFor(id.toUpperCase())).toBe(memeAvatarFor(id));
  });

  it("only ever returns one of the six files", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const url = memeAvatarFor(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      expect(url).toMatch(/^\/avatars\/meme-0[1-6]\.png$/);
      seen.add(url);
    }
    expect(seen.size).toBe(MEME_AVATAR_COUNT);
  });

  it("copes with an empty id", () => {
    expect(memeAvatarFor("")).toMatch(/^\/avatars\/meme-0[1-6]\.png$/);
  });
});
