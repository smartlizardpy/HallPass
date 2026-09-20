import { describe, expect, it } from "vitest";
import type { Game } from "@/app/lib/games";
import {
  CATALOG_SORTS,
  DEFAULT_CATALOG_SORT,
  sortCatalog,
  toCatalogSort,
} from "@/app/lib/catalog-order";

/** Only the fields the comparators read; the rest of `Game` is irrelevant here. */
const game = (partial: Partial<Game> & { slug: string }): Game =>
  ({ title: partial.slug, category: "Action", tags: [], ...partial }) as Game;

const slugs = (games: Game[]) => games.map((g) => g.slug);

describe("toCatalogSort", () => {
  it("accepts every value the toolbar can store", () => {
    for (const { value } of CATALOG_SORTS) {
      expect(toCatalogSort(value)).toBe(value);
    }
  });

  it("rejects anything else rather than trusting stored input", () => {
    expect(toCatalogSort("plays")).toBeNull();
    expect(toCatalogSort("")).toBeNull();
    expect(toCatalogSort(null)).toBeNull();
    expect(toCatalogSort(2)).toBeNull();
  });
});

describe("sortCatalog", () => {
  const games = [
    game({ slug: "atlas", title: "Atlas", plays: 10 }),
    game({ slug: "duskfall", title: "Duskfall", plays: 900, isNew: true }),
    game({ slug: "core", title: "core vs swarm", plays: 300 }),
    game({ slug: "rig10", title: "Rig 10", plays: 20, isNew: true }),
    game({ slug: "rig2", title: "Rig 2", plays: 20 }),
  ];

  it("leaves the list alone under the default order", () => {
    expect(slugs(sortCatalog(games, { sort: DEFAULT_CATALOG_SORT }))).toEqual(
      slugs(games),
    );
  });

  it("never mutates or filters the list it was given", () => {
    const before = slugs(games);
    const out = sortCatalog(games, { sort: "alpha" });
    expect(slugs(games)).toEqual(before);
    expect(out).toHaveLength(games.length);
    expect([...slugs(out)].sort()).toEqual([...before].sort());
  });

  it("ranks Most played on the live count, falling back to the seed", () => {
    // `core` has the biggest seed but a tiny live count; `atlas` the reverse.
    const playCounts = { atlas: 5000, core: 1 };
    expect(slugs(sortCatalog(games, { sort: "played", playCounts }))).toEqual([
      "atlas",
      "duskfall",
      "rig10",
      "rig2",
      "core",
    ]);
  });

  it("keeps catalogue order between games on the same play count", () => {
    // rig10 and rig2 both seed 20 and neither has a live count.
    const out = slugs(sortCatalog(games, { sort: "played" }));
    expect(out.indexOf("rig10")).toBeLessThan(out.indexOf("rig2"));
  });

  it("puts the new games first without reshuffling either group", () => {
    expect(slugs(sortCatalog(games, { sort: "new" }))).toEqual([
      "duskfall",
      "rig10",
      "atlas",
      "core",
      "rig2",
    ]);
  });

  it("sorts A-Z case-insensitively and numerically", () => {
    // "core vs swarm" is lowercase and must not sort after "Rig"; Rig 2 is a
    // smaller rig than Rig 10 however the strings compare.
    expect(slugs(sortCatalog(games, { sort: "alpha" }))).toEqual([
      "atlas",
      "core",
      "duskfall",
      "rig2",
      "rig10",
    ]);
  });
});

describe("sortCatalog and the device ranking", () => {
  const games = [
    game({ slug: "zeta", title: "Zeta" }),
    game({ slug: "alpha", title: "Alpha", platform: "mobile" }),
    game({ slug: "mid", title: "Mid" }),
  ];
  /** Stand-in for `Arcade`'s pass: a mobile-only game is unplayable here. */
  const rank = (g: Game) => (g.platform === "mobile" ? 2 : 0);

  it("puts the unplayable games last under the default order", () => {
    expect(slugs(sortCatalog(games, { sort: "featured", rank }))).toEqual([
      "zeta",
      "mid",
      "alpha",
    ]);
  });

  it("lets a chosen order outrank the device, so A-Z really is A-Z", () => {
    expect(slugs(sortCatalog(games, { sort: "alpha", rank }))).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("still breaks a tie in the chosen order on the device ranking", () => {
    const tied = [
      game({ slug: "phone", title: "Same", platform: "mobile" }),
      game({ slug: "laptop", title: "Same" }),
    ];
    expect(slugs(sortCatalog(tied, { sort: "alpha", rank }))).toEqual([
      "laptop",
      "phone",
    ]);
  });
});
