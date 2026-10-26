/**
 * /packs: the Pack Room. STATIC. Sealed packs and recent openings arrive in the
 * `PackRoom` client island over `/api/`; the odds below are the catalogue's own,
 * so the page prints the same numbers the server rolls with.
 */
import type { Metadata } from "next";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";
import { PackContents } from "@/app/components/collectibles/PackContents";
import { PackRoom } from "@/app/components/collectibles/PackRoom";

export const metadata: Metadata = {
  title: "Pack Room",
  description: "Open your HallPass packs and see exactly what is inside each one.",
  alternates: { canonical: "/packs" },
};

export default function PacksPage() {
  return (
    <CollectiblesShell>
      <header>
        <h1 className="text-3xl font-black">Pack Room</h1>
        <p className="mt-1 text-sm text-foreground-2">Packs are free. You earn them by playing, and you never have to buy anything.</p>
      </header>
      <PackRoom />
      <section aria-labelledby="hc-contents-h">
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
