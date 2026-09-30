import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests for `isCacheable` in `public/sw.js` — the gate in front of every
 * `cache.put` of a fetched response.
 *
 * Extracted from the real file by its markers rather than mirrored here, for the
 * reasons `sw-freshness.test.ts` and `sw-private-offline.test.ts` set out: a
 * service worker has no exports, and a hand-copied DECISION is how the tested
 * version and the shipped version quietly stop agreeing.
 *
 * What makes this worth a test: a staged game's files, and a tester's view of a
 * gated route, are sent `private, no-store`. If the worker cached one, a
 * device would keep serving an unreleased game after the tester lost access, or
 * to the next person on a shared browser.
 */
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const block = source.match(
  /\/\* @pure-start isCacheable \*\/([\s\S]*?)\/\* @pure-end \*\//,
);
if (!block) {
  throw new Error(
    "isCacheable markers not found in public/sw.js — did the fixture move?",
  );
}
const isCacheable = new Function(`${block[1]}; return isCacheable;`)() as (
  res: unknown,
) => boolean;

/** A minimal same-origin success; `Response` can't be built with `type: "basic"`. */
function res(cacheControl?: string, over: Record<string, unknown> = {}) {
  const headers = new Headers();
  if (cacheControl !== undefined) headers.set("cache-control", cacheControl);
  return { ok: true, redirected: false, type: "basic", headers, ...over };
}

describe("isCacheable", () => {
  it("still caches public responses", () => {
    expect(isCacheable(res())).toBe(true);
    expect(isCacheable(res("public, max-age=0, must-revalidate"))).toBe(true);
    expect(isCacheable(res("public, s-maxage=15, stale-while-revalidate"))).toBe(
      true,
    );
    expect(isCacheable(res("public, max-age=31536000, immutable"))).toBe(true);
    expect(isCacheable(res(undefined, { type: "default" }))).toBe(true);
  });

  it("refuses no-store", () => {
    expect(isCacheable(res("no-store"))).toBe(false);
    expect(isCacheable(res("max-age=0, no-store"))).toBe(false);
  });

  it("refuses private", () => {
    expect(isCacheable(res("private"))).toBe(false);
    expect(isCacheable(res("private, no-store"))).toBe(false);
    expect(isCacheable(res("private, max-age=60"))).toBe(false);
  });

  it("matches the directives case-insensitively", () => {
    expect(isCacheable(res("No-Store"))).toBe(false);
    expect(isCacheable(res("PRIVATE"))).toBe(false);
  });

  it("does not mistake a longer token for the directive", () => {
    expect(isCacheable(res("public, x-private-ish=1"))).toBe(true);
  });

  it("keeps the existing refusals", () => {
    expect(isCacheable(null)).toBe(false);
    expect(isCacheable(res(undefined, { ok: false }))).toBe(false);
    expect(isCacheable(res(undefined, { redirected: true }))).toBe(false);
    expect(isCacheable(res(undefined, { type: "opaque" }))).toBe(false);
  });
});
