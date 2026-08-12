import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests for `pickFresher` in `public/sw.js`.
 *
 * ── WHY THE FUNCTION IS EXTRACTED FROM THE FILE RATHER THAN IMPORTED ───────
 * `public/sw.js` is a service worker, not a module: it has no exports, and it
 * registers `install`/`activate`/`fetch` listeners at the top level, so merely
 * importing it would throw outside a worker. It is also not covered by
 * `vitest.config.ts`'s `include`, which is `app/**` and `sdk/**`.
 *
 * The alternative was to keep a second copy of the rule somewhere testable and
 * hand-mirror it, the way `SIGNAL_KEY` is mirrored between the SDK and the
 * embed page. A mirrored CONSTANT is one thing; a mirrored decision is how the
 * tested version and the shipped version quietly stop agreeing. So this reads
 * the real file and evaluates the real function, delimited by markers — if
 * somebody edits the rule, this test sees the edit.
 *
 * If the markers ever vanish the test FAILS rather than silently passing on
 * nothing, which is the point of asserting on the match before using it.
 */
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const block = source.match(
  /\/\* @pure-start pickFresher \*\/([\s\S]*?)\/\* @pure-end \*\//,
);
if (!block) {
  throw new Error(
    "pickFresher markers not found in public/sw.js — did the fixture move?",
  );
}
const pickFresher = new Function(
  `${block[1]}; return pickFresher;`,
)() as (a: unknown, b: unknown) => unknown;

/** A stand-in for a cached `Response`, carrying only what the rule reads. */
function res(label: string, date: string | null) {
  return {
    label,
    headers: { get: (k: string) => (k === "date" && date ? date : null) },
  };
}

const EARLY = "Wed, 06 Aug 2026 10:00:00 GMT";
const LATE = "Wed, 12 Aug 2026 10:00:00 GMT";

describe("pickFresher", () => {
  it("returns whichever one exists when only one does", () => {
    const only = res("precached", EARLY);
    expect(pickFresher(only, undefined)).toBe(only);
    const warm = res("warm", EARLY);
    expect(pickFresher(undefined, warm)).toBe(warm);
  });

  it("is null when neither cache has the URL", () => {
    expect(pickFresher(undefined, undefined)).toBeNull();
    expect(pickFresher(null, null)).toBeNull();
  });

  /**
   * THE BUG THIS EXISTS FOR. A page regenerated during the deploy — an ISR
   * revalidation, a dashboard edit — is picked up by an online visit and stored
   * in the runtime cache. Offline must then serve THAT, not the copy the
   * install handler fetched before the change.
   */
  it("prefers a runtime copy written later in the same deploy", () => {
    const precached = res("precached", EARLY);
    const warm = res("warm", LATE);
    expect(pickFresher(precached, warm)).toBe(warm);
  });

  /**
   * THE BUG THE PREVIOUS RULE EXISTED FOR, which must stay fixed. `hp-runtime`
   * is never swept, so it can hold HTML from a previous deploy whose asset
   * hashes no longer exist. This deploy's precache wins that one.
   */
  it("prefers the precache over a runtime copy from a previous deploy", () => {
    const precached = res("precached", LATE);
    const warm = res("warm", EARLY);
    expect(pickFresher(precached, warm)).toBe(precached);
  });

  it("prefers the precache on an exact tie", () => {
    const precached = res("precached", LATE);
    const warm = res("warm", LATE);
    // Same instant means the same deploy's install; nothing is gained by
    // switching, and the precache is the copy guaranteed to match this build.
    expect(pickFresher(precached, warm)).toBe(precached);
  });

  it("falls back to the precache when either date is missing", () => {
    const precached = res("precached", EARLY);
    expect(pickFresher(precached, res("warm", null))).toBe(precached);
    // Even a LATER runtime copy loses when the precache carries no date —
    // there is nothing to compare it against, so the conservative side wins.
    const undated = res("precached", null);
    expect(pickFresher(undated, res("warm", LATE))).toBe(undated);
  });

  it("falls back to the precache when a date cannot be parsed", () => {
    const precached = res("precached", EARLY);
    expect(pickFresher(precached, res("warm", "not a date"))).toBe(precached);
  });

  it("tolerates a response with no usable headers object", () => {
    const precached = res("precached", EARLY);
    expect(pickFresher(precached, { label: "warm" })).toBe(precached);
    expect(pickFresher(precached, { label: "warm", headers: {} })).toBe(precached);
  });
});
