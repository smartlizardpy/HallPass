/**
 * /packs: the Pack Room. STATIC. The room is drawn here; the player's sealed
 * packs and recent pulls arrive in the `PrizeCounter` client island over
 * `/api/`. The odds below are the catalogue's own, so the page prints the same
 * numbers the server rolls with.
 */
import type { Metadata } from "next";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";
import { PackContents } from "@/app/components/collectibles/PackContents";
import { PrizeCounter } from "@/app/components/collectibles/room/PrizeCounter";

export const metadata: Metadata = {
  title: "Pack Room",
  description: "Open your HallPass packs and see exactly what is inside each one.",
  alternates: { canonical: "/packs" },
};

export default function PacksPage() {
  return (
    <CollectiblesShell wide>
      <PrizeCounter />
      <section id="pack-odds" aria-labelledby="hc-contents-h" className="mx-auto w-full max-w-4xl scroll-mt-24 px-3 pt-8 sm:px-8">
        <h2 id="hc-contents-h" className="text-lg font-black">
          What&apos;s in each pack
        </h2>
        <p className="mb-3 mt-1 text-sm text-foreground-2">
          These are the odds for every slot. They are the same for every player, and within a rarity every card is equally likely. You can get a card you already have.
        </p>
        <PackContents />
      </section>
    </CollectiblesShell>
  );
}
