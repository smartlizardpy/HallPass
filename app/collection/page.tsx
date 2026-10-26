/**
 * /collection: the binder. STATIC. The server output is the same for everyone;
 * the player's cards arrive in the `Binder` client island over `/api/`, because
 * a page that calls `auth()` stops being prerendered (see `ChallengedHere`).
 */
import type { Metadata } from "next";
import { Binder } from "@/app/components/collectibles/Binder";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";

export const metadata: Metadata = {
  title: "My collection",
  description: "Your HallPass stickers and cards, collection by collection.",
  alternates: { canonical: "/collection" },
};

export default function CollectionPage() {
  return (
    <CollectiblesShell>
      <header>
        <h1 className="text-3xl font-black">My collection</h1>
        <p className="mt-1 text-sm text-foreground-2">Stickers and cards you have collected. Free to earn, yours to keep.</p>
      </header>
      <Binder />
    </CollectiblesShell>
  );
}
