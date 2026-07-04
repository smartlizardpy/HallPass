/**
 * Unit tests for the pure helpers in `game-html-blob.ts` — the path/segment
 * validation and content-type resolution that the game-serving route, the
 * dashboard bundle upload, and the blob→repo sync script all funnel through.
 * `listGameFiles` needs a live blob store and is intentionally NOT covered.
 */

import { describe, expect, it } from "vitest";

import {
  blobPathForAsset,
  blobPathForSlug,
  blobPrefixForSlug,
  contentTypeForPath,
  isSafeSegment,
} from "./game-html-blob";

describe("blob path helpers", () => {
  it("compose the games/<slug>/ namespace consistently", () => {
    expect(blobPrefixForSlug("neon-snake")).toBe("games/neon-snake/");
    expect(blobPathForAsset("neon-snake", "js/main.js")).toBe(
      "games/neon-snake/js/main.js",
    );
    expect(blobPathForAsset("neon-snake", "index.html")).toBe(
      blobPathForSlug("neon-snake"),
    );
  });
});

describe("isSafeSegment", () => {
  it("accepts ordinary file and directory names", () => {
    expect(isSafeSegment("index.html")).toBe(true);
    expect(isSafeSegment("main.js")).toBe(true);
    expect(isSafeSegment("assets")).toBe(true);
    expect(isSafeSegment("Sprite Sheet 2.png")).toBe(true);
    expect(isSafeSegment("a")).toBe(true);
    expect(isSafeSegment("x".repeat(128))).toBe(true);
  });

  it("rejects traversal and dotfiles", () => {
    expect(isSafeSegment("..")).toBe(false);
    expect(isSafeSegment(".")).toBe(false);
    expect(isSafeSegment(".env")).toBe(false);
    expect(isSafeSegment(".hidden")).toBe(false);
  });

  it("rejects separators, empties, and oversized segments", () => {
    expect(isSafeSegment("")).toBe(false);
    expect(isSafeSegment("a/b")).toBe(false);
    expect(isSafeSegment("a\\b")).toBe(false);
    expect(isSafeSegment("a\0b")).toBe(false);
    expect(isSafeSegment(" leading-space")).toBe(false);
    expect(isSafeSegment("-leading-dash")).toBe(false);
    expect(isSafeSegment("_leading-underscore")).toBe(false);
    expect(isSafeSegment("x".repeat(129))).toBe(false);
  });
});

describe("contentTypeForPath", () => {
  it("maps common game asset extensions", () => {
    expect(contentTypeForPath("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("js/main.js")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(contentTypeForPath("mod.mjs")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(contentTypeForPath("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForPath("data.json")).toBe(
      "application/json; charset=utf-8",
    );
    expect(contentTypeForPath("sprites.png")).toBe("image/png");
    expect(contentTypeForPath("photo.jpg")).toBe("image/jpeg");
    expect(contentTypeForPath("icon.svg")).toBe("image/svg+xml");
    expect(contentTypeForPath("music.mp3")).toBe("audio/mpeg");
    expect(contentTypeForPath("engine.wasm")).toBe("application/wasm");
    expect(contentTypeForPath("font.woff2")).toBe("font/woff2");
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeForPath("SPRITES.PNG")).toBe("image/png");
  });

  it("falls back to octet-stream for unknown or missing extensions", () => {
    expect(contentTypeForPath("weird.xyz")).toBe("application/octet-stream");
    expect(contentTypeForPath("noextension")).toBe(
      "application/octet-stream",
    );
  });
});
