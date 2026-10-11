import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AVATAR_COLOURS,
  MEME_AVATARS,
  avatarImage,
  cutoutStyle,
  memeAvatarFor,
  normaliseAvatarColour,
  parseAvatarChoice,
  parseAvatarRef,
  resolveAvatar,
} from "./avatars";

describe("catalogue", () => {
  it("has unique slug ids and a shipped image for each", () => {
    const ids = MEME_AVATARS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(existsSync(join(process.cwd(), "public", "avatars", `${id}.png`))).toBe(true);
    }
  });

  it("uses only palette colours as defaults", () => {
    for (const m of MEME_AVATARS) expect(AVATAR_COLOURS).toContain(m.colour);
    expect(AVATAR_COLOURS).toHaveLength(8);
  });
});

describe("parseAvatarChoice", () => {
  it("accepts a known meme and palette colour, normalising case", () => {
    expect(parseAvatarChoice({ meme: "doge", colour: "#A5DECF" })).toEqual({
      meme: "doge",
      colour: "#a5decf",
    });
  });

  it("rejects unknown memes, off-palette colours and non-strings", () => {
    expect(parseAvatarChoice({ meme: "nope", colour: "#a5decf" })).toBeNull();
    expect(parseAvatarChoice({ meme: "doge", colour: "#123456" })).toBeNull();
    expect(parseAvatarChoice({ meme: "doge", colour: "red" })).toBeNull();
    expect(parseAvatarChoice({ meme: "doge", colour: null })).toBeNull();
    expect(parseAvatarChoice({ meme: 3, colour: "#a5decf" })).toBeNull();
    expect(parseAvatarChoice({ meme: "../doge", colour: "#a5decf" })).toBeNull();
  });
});

describe("resolveAvatar / memeAvatarFor", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("is deterministic and case-insensitive when nothing is stored", () => {
    expect(memeAvatarFor(id)).toBe(memeAvatarFor(id));
    expect(memeAvatarFor(id.toUpperCase())).toBe(memeAvatarFor(id));
    expect(memeAvatarFor("")).toMatch(/^\/avatars\/[a-z0-9-]+\.png\?bg=[0-9a-f]{6}$/);
  });

  it("spreads defaults over the catalogue", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      seen.add(resolveAvatar(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).meme.id);
    }
    expect(seen.size).toBe(MEME_AVATARS.length);
  });

  it("honours a stored choice", () => {
    expect(memeAvatarFor(id, { meme: "doge", colour: "#ffd982" })).toBe("/avatars/doge.png?bg=ffd982");
  });

  it("treats stale stored values as unset, field by field", () => {
    // Placeholder ids from before the real art pack, and a colour not in the palette.
    const legacy = resolveAvatar(id, { meme: "meme-03", colour: "#000000" });
    const fresh = resolveAvatar(id);
    expect(legacy.meme.id).toBe(fresh.meme.id);
    expect(legacy.colour).toBe(fresh.colour);
    const colourOnly = resolveAvatar(id, { meme: "doge", colour: "#000000" });
    expect(colourOnly.meme.id).toBe("doge");
    expect(colourOnly.colour).toBe(colourOnly.meme.colour);
  });
});

describe("avatarImage", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  it("prefers a photo the query already privacy-gated", () => {
    expect(avatarImage("https://lh3.example/p.png", id, "doge", "#ffd982")).toBe(
      "https://lh3.example/p.png",
    );
  });
  it("returns null when nothing is stored so the default applies", () => {
    expect(avatarImage(null, id, null, null)).toBeNull();
    expect(avatarImage(null, null, "doge", "#ffd982")).toBeNull();
  });
  it("builds a ref from a stored choice", () => {
    expect(avatarImage(null, id, "doge", "#ffd982")).toBe("/avatars/doge.png?bg=ffd982");
  });
});

describe("parseAvatarRef", () => {
  it("round-trips a ref", () => {
    const ref = memeAvatarFor("x", { meme: "totoro", colour: "#eee9db" });
    expect(parseAvatarRef(ref)?.meme.id).toBe("totoro");
    expect(parseAvatarRef(ref)?.colour).toBe("#eee9db");
  });
  it("rejects photos, unknown ids and legacy placeholder files", () => {
    expect(parseAvatarRef("https://lh3.googleusercontent.com/a.png")).toBeNull();
    expect(parseAvatarRef("/avatars/meme-01.png")).toBeNull();
    expect(parseAvatarRef(null)).toBeNull();
  });
  it("falls back to the meme's colour for a bad bg", () => {
    expect(parseAvatarRef("/avatars/doge.png?bg=123456")?.colour).toBe(
      MEME_AVATARS.find((m) => m.id === "doge")!.colour,
    );
  });
  it("normalises colour helper input", () => {
    expect(normaliseAvatarColour(" #C5B8FF ")).toBe("#c5b8ff");
  });
});

describe("cutoutStyle", () => {
  it("centres an unshifted cutout and offsets by x/y", () => {
    const base = MEME_AVATARS.find((m) => m.scale === 1 && m.x === 0 && m.y === 0)!;
    expect(cutoutStyle(base)).toEqual({ width: "100%", height: "100%", left: "0%", top: "0%" });
    const harold = MEME_AVATARS.find((m) => m.id === "harold")!;
    expect(parseFloat(cutoutStyle(harold).width)).toBeCloseTo(81);
  });
});
