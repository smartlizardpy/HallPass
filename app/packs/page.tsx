/**
 * /packs: the Pack Room. STATIC. The room is drawn here; the player's sealed
 * packs and recent pulls arrive in the `PrizeCounter` client island over
 * `/api/`. The odds below are the catalogue's own, so the page prints the same
 * numbers the server rolls with. "What's in each pack" continues the room in
 * its own fixed palette (pack-odds.css, loaded by `PackContents`).
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
      <section id="pack-odds" aria-labelledby="hc-contents-h" className="po">
        <div className="po-in">
          <h2 id="hc-contents-h" className="po-h">
            What&apos;s in each pack
          </h2>
          <p className="po-intro">
            These are the odds for every slot. They are the same for every player, and within a rarity every card is equally likely. You can get a card you already have.
          </p>
          <PackContents />
        </div>
      </section>
    </CollectiblesShell>
  );
}
