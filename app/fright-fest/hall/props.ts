/**
 * The plain props the hall's client islands receive. SERVER-SIDE ONLY: this
 * file imports the championship config (whose games carry anti-cheat
 * validators), the registry and the collectibles catalogue, and none of them
 * may reach a browser bundle. `page.tsx` calls these builders at build time and
 * passes the results down as serialisable data; the islands import only the
 * TYPES below.
 *
 * THE RULE THAT SHAPES IT: a game that is not `announced` in
 * `components/events/fright-fest/registry.ts` is never named. Not its title, its
 * mode, its slug, its cover, its cabinet art, its champion pack. The builders
 * start from the registry and keep only announced games, so an unannounced game
 * is dropped here and nothing downstream can leak it (props.test.ts proves it
 * on the serialised output). A mystery cabinet carries no data at all.
 */

import { getPack, packPrintSrc } from "@/app/lib/collectibles/catalogue";
import { packViews } from "@/app/lib/collectibles/pages";
import type { RewardProps } from "@/app/lib/championship/reward-view";
import type { ChampionshipConfig } from "@/app/lib/championship/types";
import type { GamePlatform } from "@/app/lib/games";
import type { FrightFestGame } from "@/app/components/events/fright-fest/registry";

export type { RewardProps, RewardSlotProps } from "@/app/lib/championship/reward-view";

/** One cabinet. A mystery cabinet is `{ open: false }`: there is nothing to say about it. */
export type CabinetProps =
  | { open: false }
  | {
      open: true;
      slug: string;
      /** Which sprite set to draw: `cab-<art>-off.png` and so on. */
      art: string;
      /** "Last Bell". */
      title: string;
      /** "The Halloween Shift". */
      mode: string;
      /** "Halloween Shift". */
      modeShort: string;
      /** The ranking rule, one sentence, from the config the server ranks with. */
      rankingRule: string;
      /** The game's page, the same link the game cards and the homepage use. */
      playHref: string;
      /** Which devices the catalogue says it plays on, or null while nobody has checked. */
      platform: GamePlatform | null;
    };

/**
 * The sprite set for each announced game. A game with no entry here has no
 * cabinet art on the site yet (public/events/fright-fest/hall/ART.md), so it
 * gets the mystery cabinet's body but is still named: add its art and its key
 * in the same change that flips `announced`.
 */
const ART_KEYS: Readonly<Record<string, string>> = {
  "last-bell": "lastbell",
};

export const MYSTERY_ART = "mystery";

/** The three cabinets, in the registry's order. Unannounced games, and any game missing from the config, become mystery cabinets. */
export function buildCabinets(
  config: Pick<ChampionshipConfig, "games">,
  registry: readonly FrightFestGame[],
  catalogue: readonly { slug: string; platform?: GamePlatform }[],
): CabinetProps[] {
  return registry.map((entry): CabinetProps => {
    if (!entry.announced) return { open: false };
    const game = config.games.find((g) => g.slug === entry.slug);
    if (!game) return { open: false };
    return {
      open: true,
      slug: game.slug,
      art: ART_KEYS[game.slug] ?? MYSTERY_ART,
      title: game.title,
      mode: game.mode,
      modeShort: game.modeShort,
      rankingRule: game.rankingRule,
      playHref: `/game/${game.slug}`,
      platform: catalogue.find((g) => g.slug === game.slug)?.platform ?? null,
    };
  });
}

const WHO = {
  participation: "A result on every game in the championship.",
  gameChampion: "1st place on this game's board when the results are final.",
  overallChampion: "The Fright Fest champion, with a commemorative card only they can get.",
} as const;

function rewardFor(packId: string, who: string): RewardProps | null {
  const view = packViews().find((v) => v.pack.id === packId);
  const pack = getPack(packId);
  if (!view || !pack) return null;
  return {
    packId,
    name: pack.name,
    who,
    print: packPrintSrc(packId),
    slots: view.slots.map((s) =>
      s.kind === "fixed" && s.card ? { kind: "fixed", card: s.card.name, rarity: s.card.rarity } : { kind: "random" },
    ),
  };
}

/**
 * The packs the championship pays out, for the announced games only: the
 * participation pack, one champion pack per announced game, the overall
 * champion pack. A champion pack for a game that is not announced is left out
 * (its name and its print's file name would announce the game).
 */
export function buildRewards(
  config: Pick<ChampionshipConfig, "rewards">,
  registry: readonly FrightFestGame[],
): RewardProps[] {
  const announced = new Set(registry.filter((g) => g.announced).map((g) => g.slug));
  const out: (RewardProps | null)[] = [
    rewardFor(config.rewards.participation, WHO.participation),
    ...Object.entries(config.rewards.gameChampion)
      .filter(([slug]) => announced.has(slug))
      .map(([, packId]) => rewardFor(packId, WHO.gameChampion)),
    rewardFor(config.rewards.overallChampion, WHO.overallChampion),
  ];
  return out.filter((r): r is RewardProps => r !== null);
}
