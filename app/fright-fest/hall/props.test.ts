import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRIGHT_FEST_GAMES, type FrightFestGame } from "@/app/components/events/fright-fest/registry";
import { FRIGHT_FEST_2026 } from "@/app/lib/championship/fright-fest-2026";
import { games as GAMES } from "@/app/lib/games";
import { buildCabinets, buildRewards } from "./props";

const C = FRIGHT_FEST_2026;
const ART = join(__dirname, "../../../public/events/fright-fest/hall");
/** Every word that names a game other than Last Bell (its title, mode, slug or cover). */
const SECRETS = /shadow|cursed|survive|blood moon|dawn|halloween dash|\bstd\b|shadowcore|\bscp\b|lockdown|haunting/i;
const registry = (announced: (slug: string) => boolean): FrightFestGame[] => FRIGHT_FEST_GAMES.map((g) => ({ ...g, announced: announced(g.slug) }));
/** The registry as it stood before SCP and Blood Moon were announced: only Last Bell named. */
const LAST_BELL_ONLY = registry((slug) => slug === "last-bell");

describe("the cabinets", () => {
  it("names all three games now that each is announced", () => {
    const cabinets = buildCabinets(C, FRIGHT_FEST_GAMES, GAMES);
    expect(cabinets.map((c) => c.open && c.slug)).toEqual(["last-bell", "scp-lockdown", "survive-till-dawn-pixel-edition"]);
  });

  it("names only the announced game and leaves the others as bare mystery cabinets", () => {
    const cabinets = buildCabinets(C, LAST_BELL_ONLY, GAMES);
    expect(cabinets).toHaveLength(3);
    expect(cabinets.filter((c) => c.open).map((c) => c.open && c.slug)).toEqual(["last-bell"]);
    expect(cabinets.filter((c) => !c.open)).toEqual([{ open: false }, { open: false }]);
    expect(JSON.stringify(cabinets)).not.toMatch(SECRETS);
  });

  it("drops every game when none is announced, and still builds three cabinets", () => {
    const cabinets = buildCabinets(C, registry(() => false), GAMES);
    expect(cabinets).toEqual([{ open: false }, { open: false }, { open: false }]);
  });

  it("names a game only because the registry says it is announced, in the registry's order", () => {
    const cabinets = buildCabinets(C, registry((slug) => slug !== "last-bell"), GAMES);
    expect(cabinets[0]).toEqual({ open: false });
    expect(cabinets.filter((c) => c.open)).toHaveLength(2);
  });

  it("carries the play link, the ranking rule and the platform of Last Bell, and no validator", () => {
    const [lastBell] = buildCabinets(C, FRIGHT_FEST_GAMES, GAMES);
    expect(lastBell).toMatchObject({ open: true, slug: "last-bell", title: "Last Bell", mode: "The Halloween Shift", playHref: "/game/last-bell", art: "lastbell", platform: "desktop" });
    expect(JSON.stringify(lastBell)).not.toMatch(/validate|function/);
  });

  it("has cabinet art on disk for every announced game, in both seasons' sets", () => {
    for (const c of buildCabinets(C, FRIGHT_FEST_GAMES, GAMES)) {
      if (!c.open) continue;
      for (const f of [`cab-${c.art}-off.png`, `cab-${c.art}-on.png`, `scr-${c.art}.png`]) expect(existsSync(join(ART, f)), f).toBe(true);
    }
  });

  it("ships no cabinet art for a game that is not announced", () => {
    for (const g of FRIGHT_FEST_GAMES.filter((x) => !x.announced)) {
      for (const art of ["shadowcore", "std", "scp"]) {
        expect(existsSync(join(ART, `cab-${art}-on.png`)), `${g.slug} ${art}`).toBe(false);
      }
    }
  });
});

describe("the rewards", () => {
  it("lists every announced game's champion pack between the participation and overall packs", () => {
    expect(buildRewards(C, FRIGHT_FEST_GAMES).map((r) => r.packId)).toEqual([
      "ff26-participation",
      "ff26-winner-last-bell",
      "ff26-winner-scp-lockdown",
      "ff26-winner-survive-till-dawn",
      "ff26-overall-winner",
    ]);
  });

  it("lists the participation pack, an announced game's champion pack and the overall champion pack", () => {
    const rewards = buildRewards(C, LAST_BELL_ONLY);
    expect(rewards.map((r) => r.packId)).toEqual(["ff26-participation", "ff26-winner-last-bell", "ff26-overall-winner"]);
    for (const r of rewards) expect(r.print).toBe(`/collectibles/packs/print/${r.packId}.png`);
  });

  it("keeps guaranteed cards and random slots apart, and gives the random slots no odds or card", () => {
    const rewards = buildRewards(C, FRIGHT_FEST_GAMES);
    const [participation, overall] = [rewards[0], rewards[rewards.length - 1]];
    expect(overall.packId).toBe("ff26-overall-winner");
    expect(participation.slots.map((s) => s.kind)).toEqual(["fixed", "random", "random"]);
    expect(overall.slots.map((s) => s.kind)).toEqual(["fixed", "random", "random"]);
    for (const s of [...participation.slots, ...overall.slots]) {
      if (s.kind === "random") expect(s).toEqual({ kind: "random" });
      else expect(s.card && s.rarity).toBeTruthy();
    }
  });

  it("never names an unannounced game's champion pack, its card or its print", () => {
    expect(JSON.stringify(buildRewards(C, LAST_BELL_ONLY))).not.toMatch(SECRETS);
    const none = buildRewards(C, registry(() => false));
    expect(none.map((r) => r.packId)).toEqual(["ff26-participation", "ff26-overall-winner"]);
    expect(JSON.stringify(none)).not.toMatch(SECRETS);
  });

  it("has no runner-up reward", () => {
    expect(JSON.stringify(buildRewards(C, registry(() => true)))).not.toMatch(/runner|second place|2nd/i);
  });
});
