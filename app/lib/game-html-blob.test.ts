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
  chooseGameSource,
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

describe("chooseGameSource", () => {
  const url = "https://blob.example/games/x/index.html";
  const STAMP = 1000;

  it("proxies a blob uploaded since the last sync, even when a static twin exists", () => {
    // The whole freshness contract: an admin edit is newer than the deployed
    // mirror, so it must be served live rather than from the stale CDN twin.
    expect(
      chooseGameSource({
        staticExists: true,
        blob: { url, uploadedAt: STAMP + 1 },
        mirrorSyncedAt: STAMP,
      }),
    ).toEqual({ kind: "proxy", url });
  });

  it("serves the static twin when the blob is not newer than the mirror", () => {
    // Already baked into public/games/ — the free CDN path, no Blob transfer.
    expect(
      chooseGameSource({
        staticExists: true,
        blob: { url, uploadedAt: STAMP },
        mirrorSyncedAt: STAMP,
      }),
    ).toEqual({ kind: "static" });
  });

  it("serves the static twin when there is no blob at all (reset to default)", () => {
    expect(
      chooseGameSource({
        staticExists: true,
        blob: null,
        mirrorSyncedAt: STAMP,
      }),
    ).toEqual({ kind: "static" });
  });

  it("proxies a blob-only game that has no static twin, regardless of age", () => {
    // Uploaded but never mirrored into the repo (sync skips slugs with no
    // public/games/<slug>/ dir). Not newer than the mirror, yet redirecting to a
    // non-existent static path would 404 — so it must proxy.
    expect(
      chooseGameSource({
        staticExists: false,
        blob: { url, uploadedAt: STAMP - 1 },
        mirrorSyncedAt: STAMP,
      }),
    ).toEqual({ kind: "proxy", url });
  });

  it("redirects to static when neither a blob nor a twin exists (CDN answers 404)", () => {
    expect(
      chooseGameSource({
        staticExists: false,
        blob: null,
        mirrorSyncedAt: STAMP,
      }),
    ).toEqual({ kind: "static" });
  });

  it("prefers Blob for everything at the default stamp of 0", () => {
    // MIRROR_SYNCED_AT = 0 (nothing synced yet) must reproduce the old blob-first
    // behaviour: any real upload has uploadedAt > 0.
    expect(
      chooseGameSource({
        staticExists: true,
        blob: { url, uploadedAt: 1 },
        mirrorSyncedAt: 0,
      }),
    ).toEqual({ kind: "proxy", url });
  });
});
