/**
 * /packs/open?pack=<public id>: the old address for opening a pack, kept so
 * existing links (notifications, the championship page, bookmarks) still work.
 * STATIC. It shows the Pack Room with that pack's opening already playing over
 * it; closing the opening lands on `/packs`. The id rides in the query string
 * and only the client reads it, so an unknown id cannot fill a cache.
 */
import type { Metadata } from "next";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";
import { PrizeCounter } from "@/app/components/collectibles/room/PrizeCounter";

export const metadata: Metadata = {
  title: "Open a pack",
  description: "Tear open a HallPass pack and see what is inside.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/packs" },
};

export default function OpenPackPage() {
  return (
    <CollectiblesShell wide>
      <PrizeCounter />
    </CollectiblesShell>
  );
}
