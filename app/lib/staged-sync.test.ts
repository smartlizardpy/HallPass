/**
 * Tests for `scripts/lib/staged.mjs`, the deploy scripts' view of which games
 * are staged. The module is plain Node and lives under `scripts/`, but vitest's
 * `include` only covers `app/**` and `sdk/**`, so its tests sit here.
 *
 * The real-file test is the important one: the parser is a regex over
 * `games.ts`, and this is what stops the two drifting apart silently.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideSlug,
  fetchStagedRows,
  parseStaticGames,
  resolveStaged,
} from "../../scripts/lib/staged.mjs";

const SOURCE = `
export const games: Game[] = [
  {
    slug: "alpha",
    title: "Alpha",
    description:
      "Mentions staged: true inside prose, which must not count.",
    tags: ["Arcade"],
  },
  {
    slug: "beta",
    staged: true,
    title: "Beta",
  },
  {
    slug: "gamma",
    title: "Gamma",
    staged: false,
  },
];

const other = {
  slug: "not-a-game",
  staged: true,
};
`;

describe("parseStaticGames", () => {
  it("reads slugs and only a top-level staged: true", () => {
    expect(parseStaticGames(SOURCE)).toEqual([
      { slug: "alpha", staged: false },
      { slug: "beta", staged: true },
      { slug: "gamma", staged: false },
    ]);
  });

  it("returns nothing when there is no games array", () => {
    expect(parseStaticGames("export const x = 1;")).toEqual([]);
  });

  it("finds every entry of the real games.ts", () => {
    const real = readFileSync(
      path.join(process.cwd(), "app", "lib", "games.ts"),
      "utf8",
    );
    const literals = real.match(/^ {4}slug:\s*"/gm)?.length ?? 0;
    const parsed = parseStaticGames(real);
    expect(literals).toBeGreaterThan(0);
    expect(parsed).toHaveLength(literals);
  });
});

const STATIC = parseStaticGames(SOURCE);

describe("resolveStaged", () => {
  it("uses only the static flag, and registers nothing, without the DB", () => {
    const r = resolveStaged({
      staticGames: STATIC,
      overrides: null,
      externals: null,
    });
    expect([...r.staged]).toEqual(["beta"]);
    expect(r.registered).toBeNull();
  });

  it("lets an override publish a static-staged game", () => {
    const r = resolveStaged({
      staticGames: STATIC,
      overrides: [{ slug: "beta", staged: false }],
      externals: [],
    });
    expect(r.staged.has("beta")).toBe(false);
    expect(r.registered?.has("beta")).toBe(true);
  });

  it("lets an override stage a published game", () => {
    const r = resolveStaged({
      staticGames: STATIC,
      overrides: [{ slug: "alpha", staged: true }],
      externals: [],
    });
    expect(r.staged.has("alpha")).toBe(true);
  });

  it("inherits the static flag for a NULL override", () => {
    const r = resolveStaged({
      staticGames: STATIC,
      overrides: [{ slug: "beta", staged: null }],
      externals: [],
    });
    expect(r.staged.has("beta")).toBe(true);
  });

  it("honours an external game's flag but does not register it", () => {
    const r = resolveStaged({
      staticGames: STATIC,
      overrides: [],
      externals: [
        { slug: "ext-live", staged: false },
        { slug: "ext-beta", staged: true },
      ],
    });
    // No mirrored files: a stray blob under an external slug must not get a dir.
    expect(r.registered?.has("ext-live")).toBe(false);
    expect(r.registered?.has("ext-beta")).toBe(false);
    expect(r.staged.has("ext-beta")).toBe(true);
    expect(r.staged.has("ext-live")).toBe(false);
  });

  it("degrades to the static flag if only one query failed", () => {
    const r = resolveStaged({
      staticGames: STATIC,
      overrides: [{ slug: "beta", staged: false }],
      externals: null,
    });
    expect(r.staged.has("beta")).toBe(true);
    expect(r.registered).toBeNull();
  });
});

describe("decideSlug", () => {
  const staged = new Set(["beta"]);
  const registered = new Set(["alpha", "beta", "gamma"]);

  it("never mirrors a staged slug, even when a directory exists", () => {
    expect(
      decideSlug({ slug: "beta", hasLocalDir: true, staged, registered }),
    ).toBe("skip-staged");
  });

  it("mirrors into an existing directory", () => {
    expect(
      decideSlug({ slug: "alpha", hasLocalDir: true, staged, registered: null }),
    ).toBe("mirror");
  });

  it("creates a directory for a registered, published slug", () => {
    expect(
      decideSlug({ slug: "gamma", hasLocalDir: false, staged, registered }),
    ).toBe("mirror");
  });

  it("skips an unregistered slug with no directory", () => {
    expect(
      decideSlug({ slug: "ghost", hasLocalDir: false, staged, registered }),
    ).toBe("skip-no-dir");
  });

  it("never creates a directory when the DB was unreachable", () => {
    expect(
      decideSlug({
        slug: "gamma",
        hasLocalDir: false,
        staged: new Set(),
        registered: null,
      }),
    ).toBe("skip-no-dir");
  });
});

describe("fetchStagedRows", () => {
  it("returns both lists on success", async () => {
    let n = 0;
    const sql = async () => (n++ === 0 ? [{ slug: "a", staged: true }] : []);
    const r = await fetchStagedRows(sql);
    expect(r.error).toBeNull();
    expect(r.overrides).toEqual([{ slug: "a", staged: true }]);
    expect(r.externals).toEqual([]);
  });

  it("returns nulls and the message when a query throws", async () => {
    const sql = async () => {
      throw new Error('column "staged" does not exist');
    };
    const r = await fetchStagedRows(sql);
    expect(r.overrides).toBeNull();
    expect(r.externals).toBeNull();
    expect(r.error).toContain("does not exist");
  });
});
