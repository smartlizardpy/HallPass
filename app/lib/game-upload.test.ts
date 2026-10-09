/**
 * Unit tests for `game-upload.ts` — the temporary-path naming that the browser
 * form, the token route and the upload actions all share. The load-bearing
 * claims are that a path the browser makes is one the server accepts, and that
 * nothing the browser could send instead parses as a different game's upload.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_UPLOAD_BYTES,
  UPLOAD_PREFIX,
  newUploadPath,
  parseUploadPath,
  uploadLimitLabel,
} from "./game-upload";

describe("newUploadPath", () => {
  it("round-trips through parseUploadPath for both kinds", () => {
    for (const kind of ["html", "zip"] as const) {
      const path = newUploadPath("neon-snake", kind);
      expect(path.startsWith(`${UPLOAD_PREFIX}neon-snake/`)).toBe(true);
      expect(parseUploadPath(path)).toEqual({ slug: "neon-snake", kind });
    }
  });

  it("does not repeat between two uploads", () => {
    expect(newUploadPath("g", "zip")).not.toBe(newUploadPath("g", "zip"));
  });

  it("refuses something that is not a slug", () => {
    expect(() => newUploadPath("../games/g", "html")).toThrow();
    expect(() => newUploadPath("Neon", "html")).toThrow();
    expect(() => newUploadPath("", "zip")).toThrow();
  });
});

describe("parseUploadPath", () => {
  it.each([
    ["the published copy", "games/neon-snake/index.html"],
    ["another prefix", "beta-clips/neon-snake/abcdefgh.html"],
    ["a nested path", "game-uploads/neon-snake/x/abcdefgh.zip"],
    ["traversal", "game-uploads/../games/neon-snake/abcdefgh.html"],
    ["an encoded slash", "game-uploads/neon-snake%2Fx/abcdefgh.zip"],
    ["an unknown extension", "game-uploads/neon-snake/abcdefgh.js"],
    ["a short id", "game-uploads/neon-snake/abc.zip"],
    ["an uppercase slug", "game-uploads/Neon/abcdefgh.zip"],
    ["a trailing suffix", "game-uploads/neon-snake/abcdefgh.zip.html"],
    ["a leading slash", "/game-uploads/neon-snake/abcdefgh.zip"],
  ])("rejects %s", (_label, path) => {
    expect(parseUploadPath(path)).toBeNull();
  });
});

describe("limits", () => {
  it("are 10 MB for HTML and 50 MB for a zip", () => {
    expect(MAX_UPLOAD_BYTES.html).toBe(10 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES.zip).toBe(50 * 1024 * 1024);
    expect(uploadLimitLabel("html")).toBe("10 MB");
    expect(uploadLimitLabel("zip")).toBe("50 MB");
  });
});
