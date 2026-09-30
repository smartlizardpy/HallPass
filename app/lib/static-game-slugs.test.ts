import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicStaticSlugs } from "../../scripts/lib/static-game-slugs.mjs";
import { games, publicGames } from "./games";

const sample = `
// slug: "in-a-comment-before-the-array", staged: true
export const games: Game[] = [
  { slug: "a", title: "A" },
  { slug: 'b', staged: true, title: "B" },
  { slug: "c", staged: false },
  { slug: "d", title: "D", staged: true },
  { slug: "e" },
];
/** docs mention slug: "x" and staged: true */
`;

describe("publicStaticSlugs (sw-manifest fallback)", () => {
  it("skips staged entries and ignores text outside the array", () => {
    expect(publicStaticSlugs(sample)).toEqual(["a", "c", "e"]);
  });

  it("returns nothing when the array is not found", () => {
    expect(publicStaticSlugs("const x = 1;")).toEqual([]);
  });

  it("agrees with publicGames on the real games.ts", () => {
    const src = readFileSync(resolve(__dirname, "games.ts"), "utf8");
    const got = publicStaticSlugs(src);
    expect(got).toEqual(publicGames.map((g) => g.slug));
    expect(got.length).toBe(games.filter((g) => g.staged !== true).length);
  });
});
