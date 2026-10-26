/**
 * The plain shape of one championship reward as the event page shows it: the
 * pack, who earns it, its print, and its guaranteed cards and random slots in
 * slot order. TYPES ONLY.
 *
 * It lives here, in the championship, so `components/championship` can render
 * rewards without importing the event hall (`app/fright-fest/hall/props.ts`
 * builds these from the config, the registry and the catalogue). The hall imports
 * the theme; the championship must not reach the theme, not even through types
 * (`app/lib/events/events.test.ts`).
 */
import type { Rarity } from "@/app/lib/collectibles/catalogue";

export interface RewardSlotProps {
  kind: "fixed" | "random";
  /** Fixed slots: the card's name and rarity. */
  card?: string;
  rarity?: Rarity;
}

export interface RewardProps {
  packId: string;
  name: string;
  /** Who earns it, in a few words. */
  who: string;
  print: string;
  /** Guaranteed cards and random slots, in slot order. */
  slots: RewardSlotProps[];
}
