/**
 * Tests for `scripts/lib/cover-mirror.mjs`, which decides what the deploy writes
 * to `public/games/<slug>/cover.png`. Lives here because vitest only includes
 * `app/**`. The load-bearing claims: staged is never mirrored, only PNG is, a
 * failed database read mirrors nothing, and no directory is invented.
 */

import { describe, expect, it } from "vitest";
import { fetchCoverRows, isPng, planCoverMirror } from "../../scripts/lib/cover-mirror.mjs";

const row = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  blob_url: `https://blob.test/${slug}.png`,
  content_type: "image/png",
  ...over,
});

const plan = (
  rows: ReturnType<typeof row>[] | null,
  opts: { staged?: string[]; registered?: string[] | null; dirs?: string[] } = {},
) =>
  planCoverMirror({
    coverRows: rows,
    staged: new Set(opts.staged ?? []),
    registered: opts.registered === null ? null : new Set(opts.registered ?? ["a", "b", "c"]),
    hasLocalDir: (s: string) => (opts.dirs ?? ["a", "b", "c"]).includes(s),
  });

describe("planCoverMirror", () => {
  it("mirrors a published PNG cover", () => {
    expect(plan([row("a")]).mirror).toEqual([{ slug: "a", url: "https://blob.test/a.png" }]);
  });

  it("never mirrors a staged game", () => {
    const out = plan([row("a"), row("b")], { staged: ["a"] });
    expect(out.mirror.map((m) => m.slug)).toEqual(["b"]);
    expect(out.skipped[0]).toMatchObject({ slug: "a" });
  });

  it("skips non-PNG covers and rows without a blob URL", () => {
    const out = plan([row("a", { content_type: "image/jpeg" }), row("b", { blob_url: null })]);
    expect(out.mirror).toEqual([]);
    expect(out.skipped).toHaveLength(2);
  });

  it("mirrors nothing when the database could not be read", () => {
    expect(plan(null).mirror).toEqual([]);
    expect(plan([row("a")], { registered: null }).mirror).toEqual([]);
  });

  it("does not invent a directory for an unknown slug, but does for a registered one", () => {
    expect(plan([row("z")], { dirs: [], registered: ["a"] }).mirror).toEqual([]);
    expect(plan([row("a")], { dirs: [], registered: ["a"] }).mirror).toHaveLength(1);
  });

  it("takes one cover per slug", () => {
    expect(plan([row("a"), row("a", { blob_url: "https://blob.test/other.png" })]).mirror).toHaveLength(1);
  });
});

describe("isPng / fetchCoverRows", () => {
  it("recognises the PNG signature only", () => {
    expect(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(isPng(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(false);
  });

  it("returns rows on success and null + error on failure", async () => {
    const ok = await fetchCoverRows((async () => [row("a")]) as never);
    expect(ok.rows).toHaveLength(1);
    const bad = await fetchCoverRows((async () => {
      throw new Error("no table");
    }) as never);
    expect(bad).toEqual({ rows: null, error: "no table" });
  });
});
