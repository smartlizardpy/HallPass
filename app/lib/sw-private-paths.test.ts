import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests for `isPrivatePath` in `public/sw.js` — the paths whose responses are
 * per-viewer and must never be stored in the cache every user of a browser
 * profile shares. Extracted from the real file by its markers, as
 * `sw-private-offline.test.ts` does, so the tested rule is the shipped one.
 */
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const block = source.match(/\/\* @pure-start isPrivatePath \*\/([\s\S]*?)\/\* @pure-end \*\//);
if (!block) {
  throw new Error("isPrivatePath markers not found in public/sw.js — did the fixture move?");
}
const isPrivatePath = new Function(`${block[1]}; return isPrivatePath;`)() as (pathname: string) => boolean;

describe("isPrivatePath", () => {
  it("covers every per-viewer surface", () => {
    for (const path of [
      "/play/you",
      "/play/you/friends",
      "/play/account",
      "/play/friends",
      "/u/ozan",
      "/embed/challenge",
      "/embed/invite",
      "/i/K7QXM3PDGHT9",
    ]) {
      expect(isPrivatePath(path), path).toBe(true);
    }
  });

  it("leaves public pages cacheable", () => {
    for (const path of ["/", "/game/last-bell", "/category/arcade", "/c/K7QXM3PDGH", "/games/last-bell/index.html", "/info"]) {
      expect(isPrivatePath(path), path).toBe(false);
    }
  });
});
